/**
 * MCP 2026 observability, propagation, and deprecated-feature migration gate.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { handleStreamableHTTP } from '../dist/auto-ui/streamable-http-transport.js';
import {
  MAX_BAGGAGE_BYTES,
  normalizeBaggage,
  normalizeTracestate,
  parseTraceparent,
  validateTracePropagation,
} from '../dist/telemetry/propagation.js';
import { runWithRequestContext } from '../dist/telemetry/context.js';
import { buildOtelLogAttributes } from '../dist/telemetry/logs.js';
import {
  AnthropicProvider,
  OpenAICompatibleProvider,
  generateText,
} from '../dist/model-providers.js';
import { buildModernMCPServerCapabilities } from '../dist/mcp/protocol/capabilities.js';
import { createTask, getTask } from '../dist/tasks/store.js';
import { toLegacyTaskWire, toModernTaskWire } from '../dist/tasks/types.js';
import { spawnDaemonPG, stopDaemonPG } from './helpers/daemon-pg.js';

const TRACEPARENT = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
const TRACESTATE = 'vendor=value,tenant=blue';
const BAGGAGE = 'account=demo;region=apac,workflow=review';
const VERSION = '2026-07-28';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-observability-2026-'));
process.env.PHOTON_DIR = root;

let passed = 0;
let failed = 0;

async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function modernMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'observability-conformance',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/clientCapabilities': {
      extensions: { 'dev.portel.photon': {} },
    },
    ...extra,
  };
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
  };
}

function postJSON(
  port: number,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          try {
            const contentType = String(response.headers['content-type'] ?? '');
            const body = contentType.includes('text/event-stream')
              ? raw
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith('data: '))
                  .map((line) => JSON.parse(line.slice(6)))
                  .at(-1)
              : raw
                ? JSON.parse(raw)
                : null;
            resolve({ status: response.statusCode ?? 0, body });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function context(overrides: Record<string, unknown> = {}): any {
  return {
    photons: [],
    photonMCPs: new Map(),
    externalMCPs: [],
    externalMCPClients: new Map(),
    externalMCPSDKClients: new Map(),
    reconnectExternalMCP: async () => false,
    loadUIAsset: async () => null,
    configurePhoton: async () => ({ success: false }),
    reloadPhoton: async () => ({ success: false }),
    removePhoton: async () => ({ success: false }),
    updateMetadata: () => undefined,
    generatePhotonHelp: () => '',
    loader: undefined,
    broadcast: () => undefined,
    workingDir: process.cwd(),
    ...overrides,
  };
}

async function withHTTPServer(ctx: any, run: (port: number) => Promise<void>): Promise<void> {
  const server = http.createServer(async (request, response) => {
    if (!(await handleStreamableHTTP(request, response, ctx))) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    await run(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function waitForSocket(socketPath: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${socketPath}`));
        return;
      }
      const socket = net.createConnection(socketPath);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => setTimeout(probe, 50));
    };
    probe();
  });
}

function daemonRequest(
  socketPath: string,
  request: Record<string, unknown>
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Daemon request timed out'));
    }, 20_000);
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.destroy();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.once('error', reject);
  });
}

async function assertStdioStdoutPurity(): Promise<void> {
  const cli = path.join(process.cwd(), 'dist', 'cli.js');
  const fixtures = path.join(process.cwd(), 'tests', 'fixtures');
  const child = spawn(process.execPath, [cli, 'mcp', 'content'], {
    env: { ...process.env, PHOTON_DIR: fixtures, PHOTON_DEBUG: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'stdout-purity', version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];
  for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    if (parsed.some((value) => value.id === 2)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', () => resolve());
  });

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 2, `expected protocol responses, stderr=${stderr}`);
  const messages = lines.map((line) => JSON.parse(line));
  assert(messages.some((value) => value.id === 1));
  assert(messages.some((value) => value.id === 2));
}

console.log('MCP 2026 observability and migration:');

await test('strictly validates and bounds W3C propagation fields', () => {
  assert(parseTraceparent(TRACEPARENT));
  for (const invalid of [
    TRACEPARENT.toUpperCase(),
    `ff-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`,
    `00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`,
    ` ${TRACEPARENT}`,
  ]) {
    assert.equal(parseTraceparent(invalid), null);
  }
  assert.equal(normalizeTracestate(' vendor=value , tenant=blue '), TRACESTATE);
  assert.equal(normalizeTracestate('1vendor=value'), null);
  assert.equal(normalizeTracestate('vendor=value,vendor=again'), null);
  assert.equal(normalizeTracestate('vendor=value\r\nx=bad'), null);
  assert.equal(normalizeBaggage(BAGGAGE), BAGGAGE);
  assert.equal(normalizeBaggage('key=one,key=two'), null);
  assert.equal(normalizeBaggage('key=bad\\value'), null);
  assert.equal(normalizeBaggage(`key=${'a'.repeat(MAX_BAGGAGE_BYTES)}`), null);
  assert.equal(validateTracePropagation({ tracestate: TRACESTATE }).ok, false);
  assert.deepEqual(validateTracePropagation({ traceparent: TRACEPARENT, baggage: BAGGAGE }), {
    ok: true,
    context: { traceparent: TRACEPARENT, baggage: BAGGAGE },
  });
});

await test('correlates OTel logs without converting baggage into metric labels', async () => {
  const attributes = await runWithRequestContext(
    {
      photon: 'trace',
      tool: 'inspect',
      parentTraceparent: TRACEPARENT,
      tracestate: TRACESTATE,
      baggage: BAGGAGE,
      startedAt: Date.now(),
    },
    async () => buildOtelLogAttributes()
  );
  assert.equal(attributes['photon.trace_id'], 'a'.repeat(32));
  assert.equal(attributes['photon.traceparent'], TRACEPARENT);
  assert.equal(attributes['photon.tracestate'], TRACESTATE);
  assert.equal(attributes['photon.baggage'], BAGGAGE);
  const metricsSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'telemetry', 'metrics.ts'),
    'utf8'
  );
  assert(!metricsSource.includes('getRequestContext'));
  assert(!metricsSource.includes('baggage'));
});

await test('provides direct OpenAI-compatible and Anthropic model adapters', async () => {
  let openAIRequest: any;
  const openAI = new OpenAICompatibleProvider({
    apiKey: async () => 'secret',
    model: 'test-openai',
    baseUrl: 'https://models.example/v1/',
    fetch: async (url, init) => {
      openAIRequest = { url, init, body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          model: 'test-openai',
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  });
  assert.equal(
    await generateText(openAI, { prompt: 'Hi', systemPrompt: 'Concise', maxTokens: 10 }),
    'hello'
  );
  assert.equal(openAIRequest.url, 'https://models.example/v1/chat/completions');
  assert.equal(openAIRequest.body.messages[0].role, 'system');
  assert.equal(openAIRequest.body.max_tokens, 10);

  let anthropicRequest: any;
  const anthropic = new AnthropicProvider({
    apiKey: 'secret',
    model: 'test-anthropic',
    fetch: async (url, init) => {
      anthropicRequest = { url, init, body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          model: 'test-anthropic',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
          ],
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  });
  const result = await anthropic.complete({ prompt: 'Hi', temperature: 0 });
  assert.equal(result.text, 'hello world');
  assert.equal(anthropicRequest.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicRequest.body.temperature, 0);
});

await test('describes all deprecated compatibility features in capability metadata', () => {
  const capabilities = buildModernMCPServerCapabilities({
    photonVersion: 'test',
    aguiEventTypes: [],
  });
  const compatibility = (capabilities.extensions as any)['dev.portel.photon'].compatibilityFeatures;
  assert.equal(compatibility.roots.status, 'deprecated');
  assert.equal(compatibility.sampling.status, 'deprecated');
  assert.equal(compatibility.logging.status, 'deprecated');
});

await test('propagates HTTP trace context to native loader and external MCP calls', async () => {
  let loaderContext: any;
  const native = context({
    photons: [
      {
        id: 'native',
        name: 'native',
        path: '/native.photon.ts',
        configured: true,
        methods: [{ name: 'inspect', params: { type: 'object', properties: {} } }],
      },
    ],
    photonMCPs: new Map([['native', { instance: { inspect() {} } }]]),
    loader: {
      executeTool: async (_mcp: any, _method: string, _args: any, options: any) => {
        loaderContext = options.requestContext;
        return { ok: true };
      },
    },
  });
  await withHTTPServer(native, async (port) => {
    const response = await postJSON(
      port,
      {
        jsonrpc: '2.0',
        id: 'native-trace',
        method: 'tools/call',
        params: {
          name: 'native.inspect',
          arguments: {},
          _meta: modernMeta({
            traceparent: TRACEPARENT,
            tracestate: TRACESTATE,
            baggage: BAGGAGE,
          }),
        },
      },
      modernHeaders('tools/call', 'native.inspect')
    );
    assert.equal(response.status, 200);
    assert.equal(loaderContext.traceparent, TRACEPARENT);
    assert.equal(loaderContext.tracestate, TRACESTATE);
    assert.equal(loaderContext.baggage, BAGGAGE);

    const mismatch = await postJSON(
      port,
      {
        jsonrpc: '2.0',
        id: 'trace-mismatch',
        method: 'tools/call',
        params: {
          name: 'native.inspect',
          arguments: {},
          _meta: modernMeta({ traceparent: TRACEPARENT }),
        },
      },
      {
        ...modernHeaders('tools/call', 'native.inspect'),
        traceparent: TRACEPARENT.replace(/a/g, 'c'),
      }
    );
    assert.equal(mismatch.status, 400);
    assert.match(mismatch.body.error.message, /traceparent/i);
  });

  let externalRequest: any;
  const external = context({
    externalMCPs: [
      {
        name: 'upstream',
        methods: [{ name: 'inspect', outputSchema: { type: 'object' } }],
      },
    ],
    externalMCPSDKClients: new Map([
      [
        'upstream',
        {
          callTool: async (request: any) => {
            externalRequest = request;
            return { content: [], structuredContent: { ok: true } };
          },
        },
      ],
    ]),
  });
  await withHTTPServer(external, async (port) => {
    const response = await postJSON(
      port,
      {
        jsonrpc: '2.0',
        id: 'external-trace',
        method: 'tools/call',
        params: {
          name: 'upstream.inspect',
          arguments: {},
          _meta: modernMeta({
            traceparent: TRACEPARENT,
            tracestate: TRACESTATE,
            baggage: BAGGAGE,
          }),
        },
      },
      modernHeaders('tools/call', 'upstream.inspect')
    );
    assert.equal(response.status, 200);
    assert.deepEqual(externalRequest._meta, {
      traceparent: TRACEPARENT,
      tracestate: TRACESTATE,
      baggage: BAGGAGE,
    });
  });
});

await test('persists bounded task trace context without leaking it on either wire era', () => {
  const task = createTask('trace', 'background', {}, 10_000, {
    protocol: 'extension-2026',
    traceContext: { traceparent: TRACEPARENT, tracestate: TRACESTATE, baggage: BAGGAGE },
  });
  const persisted = getTask(task.id);
  assert.deepEqual(persisted?.traceContext, {
    traceparent: TRACEPARENT,
    tracestate: TRACESTATE,
    baggage: BAGGAGE,
  });
  assert(!('traceContext' in toModernTaskWire(task)));
  assert(!('traceContext' in toLegacyTaskWire(task)));
});

await test('preserves trace continuity through daemon IPC execution', async () => {
  // Unix-domain socket paths are short (104 bytes on macOS), so keep this
  // fixture directly under /tmp instead of the already-long test root.
  const daemonRoot = fs.mkdtempSync('/tmp/po26-');
  const socketPath = path.join(daemonRoot, 'daemon.sock');
  const photonPath = path.join(daemonRoot, 'trace.photon.ts');
  fs.writeFileSync(
    photonPath,
    `export default class Trace {
      async inspect() { return (this as any).request; }
    }\n`
  );
  const child = spawnDaemonPG(
    [path.join(process.cwd(), 'dist', 'daemon', 'server.js'), socketPath],
    {
      cwd: daemonRoot,
      env: {
        ...process.env,
        PHOTON_DIR: daemonRoot,
        PHOTON_BASES_REGISTRY: path.join(daemonRoot, 'bases.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  try {
    await waitForSocket(socketPath);
    const response = await daemonRequest(socketPath, {
      type: 'command',
      id: 'daemon-trace',
      photonName: 'trace',
      photonPath,
      workingDir: daemonRoot,
      clientType: 'mcp',
      method: 'inspect',
      args: {},
      traceContext: {
        traceparent: TRACEPARENT,
        tracestate: TRACESTATE,
        baggage: BAGGAGE,
      },
    });
    assert.equal(response.success, true, response.error);
    assert.equal(response.data.traceparent, TRACEPARENT);
    assert.equal(response.data.tracestate, TRACESTATE);
    assert.equal(response.data.baggage, BAGGAGE);
    assert.equal(response.data.transport, 'daemon-ipc');

    const invalid = await daemonRequest(socketPath, {
      type: 'command',
      id: 'daemon-invalid-trace',
      photonName: 'trace',
      method: 'inspect',
      args: {},
      traceContext: { traceparent: 'invalid' },
    });
    assert.equal(invalid.type, 'error');
    assert.match(invalid.error, /traceparent/i);
  } finally {
    await stopDaemonPG(child);
    fs.rmSync(daemonRoot, { recursive: true, force: true });
  }
});

await test('keeps stdio stdout as protocol JSON only', assertStdioStdoutPurity);

await test('documents migrations and lifecycle gates for all three features', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'docs', 'guides', 'MCP-DEPRECATED-FEATURES.md'),
    'utf8'
  );
  for (const required of [
    'Roots: make location an explicit input',
    'Sampling: call a model provider directly',
    'Logging: stderr locally, OpenTelemetry operationally',
    'separate MCP removal SEP',
  ]) {
    assert(migration.includes(required), required);
  }
});

try {
  fs.rmSync(root, { recursive: true, force: true });
} catch {
  // Windows can retain recently closed daemon handles briefly.
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
