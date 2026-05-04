/**
 * Bridge fetch fallback (Track D1)
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track D1.
 *
 * The MCP-Apps bridge must work in three contexts:
 *   1. Inside a host iframe that speaks postMessage (Beam, Claude Apps).
 *   2. Standalone browser tab (no host).
 *   3. Iframe inside a host that doesn't speak our protocol.
 *
 * window.parent === window only discriminates (2). The runtime contract is:
 * post `{type: 'photon:hello', id}` to the parent on load, wait 200ms for
 * `{type: 'photon:ack'}`. Without an ack the bridge switches to fetch.
 *
 * These tests evaluate the generated bridge in a sandboxed VM so we can
 * inject a fake `window.parent.postMessage`, fake `fetch`, and observe the
 * transport selection without a real browser.
 */
import { describe, it, expect } from 'vitest';
import * as vm from 'node:vm';

// The bridge generator lives on a per-photon instance method, so we can't
// import it directly in the same shape v1.28 used. The inline source is
// stable enough that we extract it from a freshly constructed
// ResourceServer instance.
async function getBridgeSource(): Promise<string> {
  const { ResourceServer } = await import('../dist/resource-server.js');
  const server = new ResourceServer(
    {
      executeTool: async () => undefined,
      getLoadedPhotons: () => new Map(),
    },
    { filePath: '/tmp/test.photon.ts' }
  );
  // Pretend to be a photon — only `name` is read by the bridge generator.
  const fakeMcp = { name: 'test-photon', injectedPhotons: [] };
  const html = (
    server as { generateMcpAppsBridge: (mcp: unknown) => string }
  ).generateMcpAppsBridge(fakeMcp);
  // Strip the <script> wrapper.
  const inner = html.replace(/^<script>\n?/, '').replace(/\n?<\/script>\s*$/, '');
  return inner;
}

interface SandboxState {
  postMessages: unknown[];
  fetchCalls: { url: string; init?: RequestInit }[];
  fetchResponse: { ok: boolean; status: number; body: unknown };
  messageListener: ((event: { data: unknown }) => void) | null;
  windowProxy: Record<string, unknown>;
}

function buildSandbox(state: SandboxState): vm.Context {
  const window = {
    photon: undefined,
    parent: {
      postMessage: (msg: unknown) => {
        state.postMessages.push(msg);
      },
    },
    addEventListener: (type: string, handler: (event: { data: unknown }) => void) => {
      if (type === 'message') state.messageListener = handler;
    },
    dispatchEvent: () => true,
    location: { origin: 'http://test.local' },
    document: {
      documentElement: {
        classList: { add: () => undefined, remove: () => undefined },
        setAttribute: () => undefined,
        style: {} as Record<string, string>,
      },
      body: { style: {} as Record<string, string> },
    },
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
    Promise,
    Object,
    Math,
    Error,
    JSON,
    Array,
    Proxy,
    CustomEvent: class {
      constructor(
        public name: string,
        public init?: { detail?: unknown }
      ) {}
    },
    fetch: (url: string, init?: RequestInit) => {
      state.fetchCalls.push({ url, init });
      const r = state.fetchResponse;
      return Promise.resolve({
        ok: r.ok,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    },
  };
  state.windowProxy = window as Record<string, unknown>;
  // Self-references so `window` and `globalThis` work the same.
  (window as Record<string, unknown>).window = window;
  (window as Record<string, unknown>).globalThis = window;
  return vm.createContext(window);
}

async function deliver(state: SandboxState, msg: unknown, delayMs = 0): Promise<void> {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  if (state.messageListener) state.messageListener({ data: msg });
}

describe('bridge fetch fallback', () => {
  it('switches to fetch transport after 200ms with no parent ack', async () => {
    const source = await getBridgeSource();
    const state: SandboxState = {
      postMessages: [],
      fetchCalls: [],
      fetchResponse: { ok: true, status: 200, body: { success: true, data: { greeting: 'hi' } } },
      messageListener: null,
      windowProxy: {},
    };
    const ctx = buildSandbox(state);
    vm.runInContext(source, ctx);

    // Hello message gets posted on load.
    expect(
      state.postMessages.find((m) => (m as { type?: string })?.type === 'photon:hello'),
      'bridge should announce itself with photon:hello'
    ).toBeDefined();

    // Wait past the 200ms handshake window.
    await new Promise((r) => setTimeout(r, 250));

    const photon = state.windowProxy.photon as {
      callTool: (name: string, args?: unknown) => Promise<unknown>;
    };
    const result = await photon.callTool('greet', { name: 'world' });

    expect(state.fetchCalls.length).toBe(1);
    expect(state.fetchCalls[0].url).toBe('/api/call');
    expect(state.fetchCalls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(state.fetchCalls[0].init?.body))).toEqual({
      tool: 'greet',
      args: { name: 'world' },
    });
    expect(result).toEqual({ greeting: 'hi' });
  });

  it('routes via postMessage when host acks before the timeout', async () => {
    const source = await getBridgeSource();
    const state: SandboxState = {
      postMessages: [],
      fetchCalls: [],
      fetchResponse: { ok: true, status: 200, body: null },
      messageListener: null,
      windowProxy: {},
    };
    const ctx = buildSandbox(state);
    vm.runInContext(source, ctx);

    // Host acks within the 200ms window.
    await deliver(state, { type: 'photon:ack', id: 'init-1' }, 20);

    const photon = state.windowProxy.photon as {
      callTool: (name: string, args?: unknown) => Promise<unknown>;
    };
    const callPromise = photon.callTool('greet', { name: 'world' });

    // Wait long enough for transportReady to settle and callTool to post.
    await new Promise((r) => setTimeout(r, 30));

    // No fetch path was taken.
    expect(state.fetchCalls.length).toBe(0);
    // postMessage carries a JSON-RPC tools/call.
    const rpc = state.postMessages.find(
      (m) => (m as { method?: string })?.method === 'tools/call'
    ) as { id: string; params: { name: string; arguments: unknown } } | undefined;
    expect(rpc).toBeDefined();
    expect(rpc?.params.name).toBe('greet');

    // Echo a JSON-RPC response so the call resolves and the test cleanly exits.
    await deliver(state, {
      jsonrpc: '2.0',
      id: rpc!.id,
      result: { structuredContent: { greeting: 'via-postmessage' } },
    });
    const result = await callPromise;
    expect(result).toEqual({ greeting: 'via-postmessage' });
  });

  it('rejects when the fetch endpoint reports failure', async () => {
    const source = await getBridgeSource();
    const state: SandboxState = {
      postMessages: [],
      fetchCalls: [],
      fetchResponse: { ok: false, status: 500, body: { success: false, error: 'boom' } },
      messageListener: null,
      windowProxy: {},
    };
    const ctx = buildSandbox(state);
    vm.runInContext(source, ctx);

    await new Promise((r) => setTimeout(r, 250));
    const photon = state.windowProxy.photon as {
      callTool: (name: string, args?: unknown) => Promise<unknown>;
    };
    await expect(photon.callTool('greet', {})).rejects.toThrow(/boom|HTTP 500/);
  });
});
