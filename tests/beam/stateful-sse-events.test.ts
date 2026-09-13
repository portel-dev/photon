/**
 * Stateful SSE Events — End-to-End Test
 *
 * Verifies that @stateful photon mutations remain visible across independent
 * stateless MCP requests. The old test asserted a durable legacy SSE session;
 * Beam now uses the official SDK v2 stateless HTTP handler, so cross-request
 * push streams are not part of this endpoint contract.
 *
 * Uses a minimal @stateful photon with an array property.
 *
 * Run: npx tsx tests/beam/stateful-sse-events.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BEAM_PORT = 3800 + Math.floor(Math.random() * 100);
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let tmpDir: string;

// ── Setup ──

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sse-events-test-'));

  // Minimal @stateful photon with array property
  const photonSource = `
/**
 * @description SSE events test photon
 * @stateful
 */
export default class TaskList {
  items: { id: string; text: string }[];

  constructor(items: { id: string; text: string }[] = []) {
    this.items = items;
  }

  add(text: string) {
    const item = { id: String(Date.now()), text };
    this.items.push(item);
    return item;
  }

  list() {
    return this.items;
  }

  remove(id: string) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return { error: 'not found' };
    const removed = this.items.splice(idx, 1)[0];
    return removed;
  }
}
`;
  await fs.writeFile(path.join(tmpDir, 'task-list.photon.ts'), photonSource);
}

async function startBeam(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Beam startup timeout')), 20000);

    beamProcess = spawn(
      'node',
      [path.join(__dirname, '../../dist/cli.js'), 'beam', '--port', String(BEAM_PORT)],
      {
        cwd: tmpDir,
        env: { ...process.env, PHOTON_DIR: tmpDir, NODE_ENV: 'test' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const checkReady = () => {
      fetch(`${BEAM_URL}/api/diagnostics`, { signal: AbortSignal.timeout(1000) })
        .then(async (res) => {
          if (res.ok) {
            const diag = await res.json();
            if (diag.photonCount >= 1) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkReady, 500);
            }
          } else {
            setTimeout(checkReady, 500);
          }
        })
        .catch(() => setTimeout(checkReady, 500));
    };

    beamProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    setTimeout(checkReady, 1000);
  });
}

function cleanup() {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }
}

// ── MCP Client helpers ──

type BeamSessionId = string;

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'beam', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function mcpHeaders(sessionId: BeamSessionId, method: string, name?: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': '2026-07-28',
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  };
}

async function mcpInitialize(): Promise<BeamSessionId> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: mcpHeaders('', 'server/discover'),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: {
        _meta: modernMeta,
      },
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Discovery failed: ${JSON.stringify(body)}`);
  return res.headers.get('mcp-session-id') || '';
}

async function mcpCallTool(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  callId: number = 2
): Promise<any> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: mcpHeaders(sessionId, 'tools/call', toolName),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: { name: toolName, arguments: args, _meta: modernMeta },
    }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

/**
 * Open an SSE stream on the given session and collect events for `durationMs`.
 * Returns all parsed SSE messages (excluding keepalives).
 */
function collectSSEEvents(sessionId: string, durationMs: number): Promise<any[]> {
  if (!sessionId) return Promise.resolve([]);
  return new Promise((resolve) => {
    const events: any[] = [];
    const url = `${BEAM_URL}/mcp?sessionId=${encodeURIComponent(sessionId)}`;

    // Use raw HTTP to read SSE stream (EventSource not available in Node)
    const controller = new AbortController();
    fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    })
      .then(async (res) => {
        const reader = res.body?.getReader();
        if (!reader) return resolve(events);

        const decoder = new TextDecoder();
        let buffer = '';

        const readLoop = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              // Parse SSE data lines
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const msg = JSON.parse(line.slice(6));
                    if (msg.type !== 'keepalive') {
                      events.push(msg);
                    }
                  } catch {
                    // Not JSON, ignore
                  }
                }
              }
            }
          } catch (e: any) {
            if (e.name !== 'AbortError') {
              console.warn('SSE read error:', e.message);
            }
          }
        };

        readLoop();
      })
      .catch(() => {});

    setTimeout(() => {
      controller.abort();
      resolve(events);
    }, durationMs);
  });
}

// ── Test runner ──

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

// ── Tests ──

async function testStatefulToolEmitsChangeset() {
  console.log('\n📋 Test: @stateful mutation remains visible across stateless requests');

  const sessionId = await mcpInitialize();
  assert(sessionId === '', 'stateless discovery does not create a durable session');

  const addResult = await mcpCallTool(sessionId, 'task-list/add', { text: 'Changeset item' });
  assert(!addResult.error && !addResult.result?.isError, 'add() succeeded');

  const listResult = await mcpCallTool(sessionId, 'task-list/list', {}, 3);
  const items = JSON.parse(listResult.result?.content?.[0]?.text || '[]');
  assert(
    items.some((item: { text?: string }) => item.text === 'Changeset item'),
    'a later stateless request sees the stateful mutation'
  );
}

async function testToolCallReturnsResult() {
  console.log('\n📋 Test: Basic tools/call works via MCP');

  const sessionId = await mcpInitialize();

  // Add a task
  const addResult = await mcpCallTool(sessionId, 'task-list/add', { text: 'Test task' }, 10);
  assert(!addResult.error, 'add() returned without error');

  const content = addResult.result?.content?.[0]?.text;
  assert(!!content, `add() returned content: ${(content || '').slice(0, 80)}`);

  // List tasks
  const listResult = await mcpCallTool(sessionId, 'task-list/list', {}, 11);
  assert(!listResult.error, 'list() returned without error');

  const listContent = listResult.result?.content?.[0]?.text;
  assert(
    listContent?.includes('Test task') || listContent?.includes('text'),
    `list() contains the added task`
  );
}

async function testSSEStreamConnects() {
  console.log('\n📋 Test: stateless MCP does not create a durable SSE session');

  const sessionId = await mcpInitialize();
  assert(sessionId === '', 'stateless discovery does not create a durable session stream');
}

async function testBeamLogBroadcast() {
  console.log('\n📋 Test: Beam tool result is returned on the stateless request');

  const sessionId = await mcpInitialize();
  const result = await mcpCallTool(sessionId, 'task-list/list', {}, 20);
  assert(!result.error && !result.result?.isError, 'task-list/list returned a tool result');
}

// ── Main ──

async function main() {
  console.log('🔧 Setting up test photon...');
  await setup();

  console.log(`🚀 Starting Beam on port ${BEAM_PORT}...`);
  try {
    await startBeam();
    console.log('✅ Beam started');
  } catch (err) {
    console.error('❌ Failed to start Beam:', err);
    cleanup();
    process.exit(1);
  }

  try {
    await testSSEStreamConnects();
    await testToolCallReturnsResult();
    await testBeamLogBroadcast();
    await testStatefulToolEmitsChangeset();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}`);

  cleanup();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main();
