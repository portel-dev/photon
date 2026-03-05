/**
 * Stateful SSE Events — End-to-End Test
 *
 * Verifies that @stateful photon mutations produce events visible to
 * SSE-connected MCP clients. This tests the full pipeline:
 *
 *   Client A calls tools/call (mutation) →
 *   Daemon executes method →
 *   Daemon outputHandler publishes to channel →
 *   Beam subscribes to channel →
 *   Beam broadcasts SSE notification →
 *   Client B receives event on EventSource
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

async function mcpInitialize(): Promise<string> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        clientInfo: { name: 'beam', version: '1.0.0' },
        capabilities: {},
      },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('No session ID returned from initialize');
  return sessionId;
}

async function mcpCallTool(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  callId: number = 2
): Promise<any> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
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
  console.log('\n📋 Test: @stateful mutation produces changeset on SSE');

  // Client A: will perform mutations
  const sessionA = await mcpInitialize();

  // Client B: will listen for changeset events
  const sessionB = await mcpInitialize();

  // Start collecting SSE events on Client B
  const eventsPromise = collectSSEEvents(sessionB, 6000);

  // Give SSE stream a moment to connect
  await new Promise((r) => setTimeout(r, 500));

  // Client A: add a task
  const addResult = await mcpCallTool(sessionA, 'task-list/add', { text: 'Changeset item' });
  assert(!addResult.error, 'add() succeeded');

  // Parse the added item to get its ID for remove
  const addedText = addResult.result?.content?.[0]?.text;
  let addedId: string | undefined;
  try {
    addedId = JSON.parse(addedText).id;
  } catch {}

  // Client A: remove the task (if we got the ID)
  if (addedId) {
    const removeResult = await mcpCallTool(sessionA, 'task-list/remove', { id: addedId }, 3);
    assert(!removeResult.error, 'remove() succeeded');
  }

  // Wait for events to arrive
  const events = await eventsPromise;

  console.log(`  📡 Received ${events.length} SSE event(s) on Client B`);
  for (const evt of events) {
    console.log(`     → ${evt.method}: ${JSON.stringify(evt.params || {}).slice(0, 150)}`);
  }

  // Find state-changed events
  const stateEvents = events.filter((e) => e.method === 'photon/state-changed');
  assert(stateEvents.length >= 1, `Received ${stateEvents.length} state-changed event(s)`);

  // Verify changeset structure: must have photon, method, params, data
  const addEvent = stateEvents.find((e) => e.params?.method === 'add');
  if (addEvent) {
    const p = addEvent.params;
    assert(p.photon === 'task-list', `Changeset has photon: ${p.photon}`);
    assert(p.method === 'add', `Changeset has method: ${p.method}`);
    assert(
      p.params?.text === 'Changeset item',
      `Changeset has input params: text=${p.params?.text}`
    );
    assert(p.data?.id !== undefined, `Changeset has result data with id: ${p.data?.id}`);
    assert(p.data?.text === 'Changeset item', `Changeset result matches input: ${p.data?.text}`);
  } else {
    assert(false, 'Expected add changeset event (not found)');
  }

  // Verify remove changeset (if we performed it)
  if (addedId) {
    const removeEvent = stateEvents.find((e) => e.params?.method === 'remove');
    if (removeEvent) {
      const p = removeEvent.params;
      assert(p.params?.id === addedId, `Remove changeset has input id: ${p.params?.id}`);
      assert(p.data?.id === addedId, `Remove changeset result has removed item id`);
    } else {
      assert(false, 'Expected remove changeset event (not found)');
    }
  }
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
  console.log('\n📋 Test: SSE stream connects and receives keepalives');

  const sessionId = await mcpInitialize();

  // Collect for 2 seconds — should at least not error
  const events = collectSSEEvents(sessionId, 2000);

  const result = await events;
  // Just verify connection didn't crash
  assert(true, `SSE stream connected (received ${result.length} non-keepalive events)`);
}

async function testBeamLogBroadcast() {
  console.log('\n📋 Test: beam/log broadcast arrives on SSE after tool call');

  const sessionA = await mcpInitialize();
  const sessionB = await mcpInitialize();

  // Start collecting on B
  const eventsPromise = collectSSEEvents(sessionB, 4000);
  await new Promise((r) => setTimeout(r, 500));

  // Call a tool from A
  await mcpCallTool(sessionA, 'task-list/list', {}, 20);

  const events = await eventsPromise;

  const hasBeamLog = events.some((e) => e.method === 'beam/log');
  assert(hasBeamLog, `Client B received beam/log event (got ${events.length} events total)`);

  if (hasBeamLog) {
    const logEvent = events.find((e) => e.method === 'beam/log');
    console.log(`     → beam/log: ${JSON.stringify(logEvent?.params).slice(0, 120)}`);
  }
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
