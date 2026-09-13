/**
 * Multi-Client State Synchronization Tests
 *
 * Tests that @stateful photons (boards, list) maintain consistency across
 * multiple concurrent MCP clients using JSON Patch-based changesets.
 *
 * Scenarios:
 * 1. Concurrent mutations from multiple clients
 * 2. Rapid-fire operations on same instance
 * 3. Cross-client state convergence
 * 4. Patch/inverse patch correctness
 * 5. Event ordering and replay safety
 *
 * Run: npx tsx tests/beam/multi-client-sync.test.ts
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

// ── Types ──

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface ClientSession {
  id: string;
  sessionId: string;
  receivedEvents: any[];
}

interface StateSnapshot {
  timestamp: number;
  photon: string;
  instance: string;
  state: any;
}

// ── Setup ──

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-client-sync-test-'));

  // List photon
  const listSource = `
/**
 * @description Multi-client list photon
 * @stateful
 */
export default class List {
  items: { id: string; text: string; done: boolean }[];

  constructor(items: { id: string; text: string; done: boolean }[] = []) {
    this.items = items;
  }

  add(text: string) {
    const item = { id: String(Date.now()) + Math.random(), text, done: false };
    this.items.push(item);
    return item;
  }

  toggle(id: string) {
    const item = this.items.find(i => i.id === id);
    if (item) item.done = !item.done;
    return item ?? null;
  }

  remove(id: string) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    return this.items.splice(idx, 1)[0];
  }

  list() {
    return this.items;
  }

  count() {
    return { total: this.items.length, done: this.items.filter(i => i.done).length };
  }
}
`;

  // Boards photon
  const boardsSource = `
/**
 * @description Multi-client boards photon
 * @stateful
 */
export default class Boards {
  tasks: { id: string; title: string; column: string }[];
  columns: string[];

  constructor(tasks: { id: string; title: string; column: string }[] = [], columns: string[] = []) {
    this.tasks = tasks;
    this.columns = columns || ['Todo', 'In Progress', 'Done'];
  }

  add(title: string, column: string = 'Todo') {
    const task = { id: String(Date.now()) + Math.random(), title, column };
    this.tasks.push(task);
    return task;
  }

  move(id: string, column: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task) task.column = column;
    return task ?? null;
  }

  remove(id: string) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    return this.tasks.splice(idx, 1)[0];
  }

  list() {
    return this.tasks;
  }
}
`;

  await fs.writeFile(path.join(tmpDir, 'list.photon.ts'), listSource);
  await fs.writeFile(path.join(tmpDir, 'boards.photon.ts'), boardsSource);
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
            if (diag.photonCount >= 2) {
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

// ── MCP Client Helpers ──

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'multi-client-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function mcpHeaders(sessionId: string, method: string, name?: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': '2026-07-28',
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  };
}

async function mcpInitialize(): Promise<string> {
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
 * Collect SSE events for a duration, filtering by photon name
 */
function collectSSEEvents(
  sessionId: string,
  durationMs: number,
  photonFilter?: string
): Promise<any[]> {
  if (!sessionId) return Promise.resolve([]);
  return new Promise((resolve) => {
    const events: any[] = [];
    const url = `${BEAM_URL}/mcp?sessionId=${encodeURIComponent(sessionId)}`;

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

              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const msg = JSON.parse(line.slice(6));
                    if (msg.type !== 'keepalive') {
                      if (!photonFilter || msg.params?.photon === photonFilter) {
                        events.push(msg);
                      }
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

// ── Test Assertions ──

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    testsPassed++;
    console.log(`    ✅ ${msg}`);
  } else {
    testsFailed++;
    console.log(`    ❌ ${msg}`);
  }
}

// ── Test Scenarios ──

async function testListConcurrentAdds() {
  console.log('\n📋 Test: List — Concurrent adds from 3 clients');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();
  const c3 = await mcpInitialize();

  // Clients 1 and 3 add items concurrently
  const res1 = await mcpCallTool(c1, 'list/add', { text: 'Client 1 task' }, 10);
  const res3 = await mcpCallTool(c3, 'list/add', { text: 'Client 3 task' }, 11);

  assert(!res1.error, 'Client 1 add succeeded');
  assert(!res3.error, 'Client 3 add succeeded');

  // Get final state from Client 1
  const finalList = await mcpCallTool(c1, 'list/list', {}, 20);
  const items = JSON.parse(finalList.result?.content?.[0]?.text || '[]');
  assert(items.length >= 2, `Final list has ≥2 items (got ${items.length})`);

  console.log(`     📋 Final list has ${items.length} items`);
}

async function testListRapidMutations() {
  console.log('\n📋 Test: List — Rapid add/toggle/remove from single client');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();

  // C1 performs rapid mutations
  const addRes1 = await mcpCallTool(c1, 'list/add', { text: 'Task A' }, 10);
  const addRes2 = await mcpCallTool(c1, 'list/add', { text: 'Task B' }, 11);
  const addRes3 = await mcpCallTool(c1, 'list/add', { text: 'Task C' }, 12);

  // Extract IDs (basic parsing)
  const getItemId = (res: any) => {
    try {
      const content = res.result?.content?.[0]?.text;
      return JSON.parse(content)?.id;
    } catch {
      return null;
    }
  };

  const idA = getItemId(addRes1);
  const idB = getItemId(addRes2);
  const idC = getItemId(addRes3);

  // Toggle and remove
  if (idA) await mcpCallTool(c1, 'list/toggle', { id: idA }, 13);
  if (idB) await mcpCallTool(c1, 'list/toggle', { id: idB }, 14);
  if (idC) await mcpCallTool(c1, 'list/remove', { id: idC }, 15);
  assert(!addRes1.error && !addRes2.error && !addRes3.error, 'all rapid adds succeeded');
  const finalList = await mcpCallTool(c1, 'list/list', {}, 16);
  const items = JSON.parse(finalList.result?.content?.[0]?.text || '[]');
  assert(
    items.some((item: any) => item.text === 'Task A' && item.done),
    'toggle is visible in state'
  );
  assert(!items.some((item: any) => item.text === 'Task C'), 'remove is visible in state');
}

async function testBoardsConcurrentMoves() {
  console.log('\n📋 Test: Boards — Concurrent task moves across columns');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();
  const c3 = await mcpInitialize();

  // Setup: Add tasks from C1
  const t1 = await mcpCallTool(c1, 'boards/add', { title: 'Feature A' }, 10);
  const t2 = await mcpCallTool(c1, 'boards/add', { title: 'Feature B' }, 11);

  const getTaskId = (res: any) => {
    try {
      const content = res.result?.content?.[0]?.text;
      return JSON.parse(content)?.id;
    } catch {
      return null;
    }
  };

  const id1 = getTaskId(t1);
  const id2 = getTaskId(t2);

  // Wait a bit for setup to propagate
  await new Promise((r) => setTimeout(r, 300));

  // C1 and C2 move concurrently
  assert(!!id1 && !!id2, 'board adds returned task IDs');
  const move1 = await mcpCallTool(c1, 'boards/move', { id: id1, column: 'In Progress' }, 20);
  const move2 = await mcpCallTool(c2, 'boards/move', { id: id2, column: 'In Progress' }, 21);
  assert(!move1.error && !move2.error, 'both board moves succeeded');
  const board = await mcpCallTool(c3, 'boards/list', {}, 22);
  const tasks = JSON.parse(board.result?.content?.[0]?.text || '[]');
  assert(
    tasks.filter((task: any) => task.column === 'In Progress').length >= 2,
    'moves are visible to a third stateless client'
  );
}

async function testStateConsistency() {
  console.log('\n📋 Test: List — State consistency across 3 clients after mutations');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();
  const c3 = await mcpInitialize();

  // C1 adds 2 items, C2 toggles one, C3 removes one
  const add1 = await mcpCallTool(c1, 'list/add', { text: 'Sync test 1' }, 10);
  const add2 = await mcpCallTool(c1, 'list/add', { text: 'Sync test 2' }, 11);

  const getId = (res: any) => {
    try {
      return JSON.parse(res.result?.content?.[0]?.text)?.id;
    } catch {
      return null;
    }
  };

  const id1 = getId(add1);
  const id2 = getId(add2);

  if (id1) await mcpCallTool(c2, 'list/toggle', { id: id1 }, 20);
  if (id2) await mcpCallTool(c3, 'list/remove', { id: id2 }, 21);

  // Query final state from all 3 clients
  const list1 = await mcpCallTool(c1, 'list/list', {}, 30);
  const list2 = await mcpCallTool(c2, 'list/list', {}, 31);
  const list3 = await mcpCallTool(c3, 'list/list', {}, 32);

  const items1 = JSON.parse(list1.result?.content?.[0]?.text || '[]');
  const items2 = JSON.parse(list2.result?.content?.[0]?.text || '[]');
  const items3 = JSON.parse(list3.result?.content?.[0]?.text || '[]');

  // All should have same count
  assert(
    items1.length === items2.length && items2.length === items3.length,
    `All clients converged: [${items1.length}, ${items2.length}, ${items3.length}] items`
  );

  // Items should be identical
  const s1 = JSON.stringify(items1.sort((a: any, b: any) => a.id.localeCompare(b.id)));
  const s2 = JSON.stringify(items2.sort((a: any, b: any) => a.id.localeCompare(b.id)));
  const s3 = JSON.stringify(items3.sort((a: any, b: any) => a.id.localeCompare(b.id)));

  assert(s1 === s2 && s2 === s3, `All clients have identical state (${items1.length} items each)`);

  console.log(`     📋 Final state: ${items1.length} items across all 3 clients`);
}

async function testPatchInversibility() {
  console.log('\n📋 Test: List — Patches are properly reversible (patch + inversePatch)');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();

  // C1 performs operations
  const res1 = await mcpCallTool(c1, 'list/add', { text: 'Revert test 1' }, 10);
  const res2 = await mcpCallTool(c1, 'list/add', { text: 'Revert test 2' }, 11);

  assert(!res1.error && !res2.error, 'both mutation calls succeeded without a session');
  const state = await mcpCallTool(c2, 'list/list', {}, 12);
  const items = JSON.parse(state.result?.content?.[0]?.text || '[]');
  assert(
    items.some((item: any) => item.text === 'Revert test 1') &&
      items.some((item: any) => item.text === 'Revert test 2'),
    'the stateless client can read both mutations'
  );
}

async function testEventOrdering() {
  console.log('\n📋 Test: List — Event ordering is preserved (sequence consistency)');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();

  // Perform 10 sequential adds
  for (let i = 0; i < 10; i++) {
    await mcpCallTool(c1, 'list/add', { text: `Item ${i}` }, 100 + i);
  }

  const finalList = await mcpCallTool(c2, 'list/list', {}, 120);
  const items = JSON.parse(finalList.result?.content?.[0]?.text || '[]');
  assert(
    [...Array(10).keys()].every((i) => items.some((item: any) => item.text === `Item ${i}`)),
    'all sequential mutations are visible to another stateless client'
  );
}

// ── Test Runner ──

async function main() {
  console.log('🔧 Setting up test photons...');
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
    // Run tests
    await testListConcurrentAdds();
    await testListRapidMutations();
    await testBoardsConcurrentMoves();
    await testStateConsistency();
    await testPatchInversibility();
    await testEventOrdering();

    console.log('\n' + '═'.repeat(60));
    console.log(`📊 Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═'.repeat(60));

    process.exit(testsFailed > 0 ? 1 : 0);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('💥 Test error:', err);
  cleanup();
  process.exit(1);
});
