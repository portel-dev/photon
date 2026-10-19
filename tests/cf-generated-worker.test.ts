/** Execute the deploy generator's real output in workerd, without a Cloudflare account. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { deployToCloudflare } from '../src/deploy/cloudflare.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('generated Cloudflare Worker', () => {
  let root: string;
  let runtime: Miniflare | undefined;
  let scriptPath: string;
  let requestId = 0;
  let progressGate = Promise.resolve();

  async function start() {
    const config = await fs.readFile(path.join(root, 'out/wrangler.toml'), 'utf8');
    const className = config.match(/class_name = "([^"]+)"/)![1];
    runtime = new Miniflare({
      modules: true,
      scriptPath,
      modulesRoot: path.dirname(scriptPath),
      compatibilityDate: config.match(/compatibility_date = "([^"]+)"/)![1],
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { PHOTON: { className, useSQLite: true } },
      durableObjectsPersist: path.join(root, 'state'),
      bindings: { PHOTON_MCP_BEARER: 'integration-secret' },
      outboundService: async () => {
        await progressGate;
        return new Response('released');
      },
    });
    await runtime.ready;
  }

  async function rpc(
    method: string,
    params = {},
    instance = 'alice',
    token = 'integration-secret'
  ) {
    return runtime!.dispatchFetch('https://worker.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
        'X-Photon-Instance': instance,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    });
  }

  async function message(response: Awaited<ReturnType<typeof rpc>>) {
    expect(response.status).toBe(200);
    const body = await response.text();
    if (!response.headers.get('content-type')?.includes('text/event-stream'))
      return JSON.parse(body);
    const messages = body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    return messages.find(
      (entry) => entry.id !== undefined && ('result' in entry || 'error' in entry)
    );
  }

  async function call(name: string, args = {}, instance = 'alice') {
    const reply = await message(await rpc('tools/call', { name, arguments: args }, instance));
    expect(reply.error).toBeUndefined();
    expect(reply.result.isError).not.toBe(true);
    return JSON.parse(reply.result.content[0].text);
  }

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-worker-integration-'));
    const photonPath = path.join(root, 'counter.photon.ts');
    await fs.writeFile(
      photonPath,
      `
export default class Counter {
  async increment(n: number = 1) {
    const value = await this.memory.update('count', current => (current ?? 0) + n);
    return { value };
  }
  async current() { return { value: (await this.memory.get('count')) ?? 0 }; }
  async streaming() {
    this.emit({ emit: 'progress', value: 0.5, message: 'working' });
    await fetch('https://progress-gate.test/release');
    return { done: true };
  }
  /** @get /health */
  async health() { return new Response('healthy', { headers: { 'X-Photon-Test': 'route' } }); }
  /** @internal */
  async maintenance() { return 'private'; }
}
`
    );
    const project = await deployToCloudflare({
      photonPath,
      outputDir: path.join(root, 'out'),
      dryRun: true,
      mcpAuth: 'bearer',
    });
    scriptPath = path.join(project.outputDir, 'worker.mjs');
    await build({
      entryPoints: [path.join(project.outputDir, 'src/worker.ts')],
      outfile: scriptPath,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      conditions: ['workerd', 'worker', 'browser'],
      nodePaths: [path.join(repoRoot, 'node_modules')],
      external: ['cloudflare:workers', 'node:*'],
      plugins: [
        {
          name: 'workers-node-compat',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path: specifier }) =>
              builtinModules.includes(specifier)
                ? {
                    path: specifier.startsWith('node:') ? specifier : `node:${specifier}`,
                    external: true,
                  }
                : undefined
            );
          },
        },
      ],
    });
    await start();
  }, 60_000);

  afterAll(async () => {
    await runtime?.dispose();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('initializes and discovers public tools without exposing HTTP-only/internal methods', async () => {
    const init = await message(
      await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'integration', version: '1' },
      })
    );
    expect(init.result.serverInfo).toBeDefined();
    const list = await message(await rpc('tools/list'));
    expect(list.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      'current',
      'increment',
      'streaming',
    ]);
  });

  it('rejects unauthenticated calls and executes authenticated calls', async () => {
    const denied = await rpc(
      'tools/call',
      { name: 'increment', arguments: { n: 99 } },
      'alice',
      ''
    );
    expect(denied.status).toBe(401);
    await denied.text();
    expect(await call('increment', { n: 3 })).toEqual({ value: 3 });
  });

  it('keeps named instances separate and persists state across runtime restarts', async () => {
    expect(await call('increment', { n: 3 }, 'persistent-a')).toEqual({ value: 3 });
    expect(await call('increment', { n: 7 }, 'persistent-b')).toEqual({ value: 7 });
    expect(await call('current', {}, 'persistent-a')).toEqual({ value: 3 });
    await runtime!.dispose();
    runtime = undefined;
    await start();
    expect(await call('current', {}, 'persistent-a')).toEqual({ value: 3 });
    expect(await call('current', {}, 'persistent-b')).toEqual({ value: 7 });
  }, 30_000);

  it('flushes progress with the client token before the tool can complete', async () => {
    let release!: () => void;
    progressGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decoder = new TextDecoder();
    let body = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const events = () =>
      body
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)));
    try {
      const progress = async () => {
        const response = await rpc('tools/call', {
          name: 'streaming',
          arguments: {},
          _meta: { progressToken: 'client-progress' },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        reader = response.body!.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('Stream ended before progress');
          body += decoder.decode(chunk.value, { stream: true });
          // Parse only complete SSE events; a JSON payload can span read chunks.
          const complete = body.slice(0, body.lastIndexOf('\n\n') + 2);
          const notification = complete
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => JSON.parse(line.slice(6)))
            .find((event) => event.method === 'notifications/progress');
          if (notification) return notification;
        }
      };
      const notification = await Promise.race([
        progress(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Progress buffered until completion')), 10000);
        }),
      ]);
      expect(notification.params).toMatchObject({
        progressToken: 'client-progress',
        progress: 50,
        total: 100,
        message: 'working',
      });
      expect(events().some((event) => event.result)).toBe(false);
    } finally {
      release();
      clearTimeout(timer);
    }
    while (true) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }
    const result = events().find((event) => event.result);
    expect(result.result.isError).not.toBe(true);
    expect(JSON.parse(result.result.content[0].text)).toEqual({ done: true });
  }, 15000);

  it('serves HTTP routes, generated UI, and its browser runtime assets', async () => {
    const health = await runtime!.dispatchFetch('https://worker.test/health');
    expect(health.headers.get('X-Photon-Test')).toBe('route');
    expect(await health.text()).toBe('healthy');
    const web = await runtime!.dispatchFetch('https://worker.test/');
    expect(web.status).toBe(200);
    expect(await web.text()).toContain("fetch('/mcp'");
    const asset = await runtime!.dispatchFetch('https://worker.test/photon-form.bundle.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect((await asset.text()).length).toBeGreaterThan(100);
  });
});
