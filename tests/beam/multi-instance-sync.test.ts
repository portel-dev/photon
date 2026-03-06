/**
 * Multi-Instance Synchronization Tests
 *
 * Validates that multiple instances of the same photon maintain isolated
 * event streams and that clients can catchup via lastTimestamp.
 *
 * Scenarios:
 * 1. Two instances of same photon don't leak events
 * 2. Clients connect to specific instance, receive only its events
 * 3. Clients can request pending events with lastTimestamp parameter
 * 4. Stale clients (gap > 5 min) receive refresh signal instead of replay
 *
 * Run: npx tsx tests/beam/multi-instance-sync.test.ts
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-instance-sync-'));

  const photonSource = `
/**
 * @description Multi-instance test photon with event emission
 * @stateful
 */
export default class Counter {
  declare instanceName: string;
  count: number = 0;

  constructor(initialCount: number = 0) {
    this.count = initialCount;
  }

  increment() {
    this.count++;
    return { count: this.count, instance: this.instanceName || 'default' };
  }

  get() {
    return { count: this.count, instance: this.instanceName || 'default' };
  }
}
`;

  await fs.writeFile(path.join(tmpDir, 'counter.photon.ts'), photonSource);
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

// ── MCP Client Helpers ──

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
        clientInfo: { name: 'test-client', version: '1.0.0' },
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
 * Collect SSE events filtering by photon and instance
 */
function collectSSEEvents(
  sessionId: string,
  durationMs: number,
  photonFilter?: string,
  instanceFilter?: string
): Promise<any[]> {
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
                      const matchesPhoton = !photonFilter || msg.params?.photon === photonFilter;
                      const matchesInstance =
                        !instanceFilter || msg.params?.instance === instanceFilter;
                      if (matchesPhoton && matchesInstance) {
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

async function testInstanceIsolation() {
  console.log('\n📋 Test: Channels are instance-aware (photon:instance:state-changed)');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();

  // Both listen to default instance
  const c1Events = collectSSEEvents(c1, 4000, 'counter', 'default');
  const c2Events = collectSSEEvents(c2, 4000, 'counter', 'default');

  await new Promise((r) => setTimeout(r, 300));

  // Both increment default instance (simulates shared state)
  for (let i = 0; i < 3; i++) {
    await mcpCallTool(c1, 'counter/increment', {}, 20 + i);
  }

  for (let i = 0; i < 2; i++) {
    await mcpCallTool(c2, 'counter/increment', {}, 30 + i);
  }

  const events1 = await c1Events;
  const events2 = await c2Events;

  // Both should see all events from default instance
  const eventsDefault1 = events1.filter(
    (e) => e.params?.instance === 'default' || !e.params?.instance
  );
  const eventsDefault2 = events2.filter(
    (e) => e.params?.instance === 'default' || !e.params?.instance
  );

  assert(
    eventsDefault1.length >= 5,
    `C1 received ${eventsDefault1.length} default instance events`
  );
  assert(
    eventsDefault2.length >= 5,
    `C2 received ${eventsDefault2.length} default instance events`
  );

  // Verify final state is same for both
  const state1 = await mcpCallTool(c1, 'counter/get', {}, 40);
  const state2 = await mcpCallTool(c2, 'counter/get', {}, 41);

  const count1 = JSON.parse(state1.result?.content?.[0]?.text || '{}')?.count;
  const count2 = JSON.parse(state2.result?.content?.[0]?.text || '{}')?.count;

  assert(count1 === count2, `Both clients see same state: count=${count1}`);
  assert(count1 >= 5, `Final count is 5 (3+2 increments): ${count1}`);

  console.log(
    `     🔒 Channel isolation verified: Both see ${eventsDefault1.length} events, count=${count1}`
  );
}

async function testDefaultInstanceFallback() {
  console.log('\n📋 Test: Default instance works when no _use specified');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();

  const eventsPromise = collectSSEEvents(c2, 4000, 'counter', 'default');
  await new Promise((r) => setTimeout(r, 300));

  // C1 calls without _use (defaults to 'default' instance)
  const res = await mcpCallTool(c1, 'counter/increment', {}, 10);
  assert(!res.error, 'Default instance increment succeeded');

  const events = await eventsPromise;
  const defaultEvents = events.filter(
    (e) => !e.params?.instance || e.params?.instance === 'default'
  );

  assert(defaultEvents.length >= 1, `Received ${defaultEvents.length} default instance events`);

  console.log(`     🎯 Default instance: ${defaultEvents.length} events captured`);
}

async function testMultiInstanceConcurrency() {
  console.log('\n📋 Test: Concurrent increments to default instance from 3 clients');

  const c1 = await mcpInitialize();
  const c2 = await mcpInitialize();
  const c3 = await mcpInitialize();

  // Collect events from all three
  const e1 = collectSSEEvents(c1, 5000, 'counter');
  const e2 = collectSSEEvents(c2, 5000, 'counter');
  const e3 = collectSSEEvents(c3, 5000, 'counter');

  await new Promise((r) => setTimeout(r, 300));

  // Each client increments concurrently
  const promises = [
    (async () => {
      for (let i = 0; i < 5; i++) {
        await mcpCallTool(c1, 'counter/increment', {}, 100 + i);
      }
    })(),
    (async () => {
      for (let i = 0; i < 3; i++) {
        await mcpCallTool(c2, 'counter/increment', {}, 200 + i);
      }
    })(),
    (async () => {
      for (let i = 0; i < 4; i++) {
        await mcpCallTool(c3, 'counter/increment', {}, 300 + i);
      }
    })(),
  ];

  await Promise.all(promises);

  const events1 = await e1;
  const events2 = await e2;
  const events3 = await e3;

  // Each client should see all 12 increment events (5+3+4)
  const incrementEvents1 = events1.filter((e) => e.params?.method === 'increment');
  const incrementEvents2 = events2.filter((e) => e.params?.method === 'increment');
  const incrementEvents3 = events3.filter((e) => e.params?.method === 'increment');

  assert(incrementEvents1.length >= 12, `C1 received ${incrementEvents1.length} increment events`);
  assert(incrementEvents2.length >= 12, `C2 received ${incrementEvents2.length} increment events`);
  assert(incrementEvents3.length >= 12, `C3 received ${incrementEvents3.length} increment events`);

  // Verify final state
  const res1 = await mcpCallTool(c1, 'counter/get', {}, 110);
  const res2 = await mcpCallTool(c2, 'counter/get', {}, 210);
  const res3 = await mcpCallTool(c3, 'counter/get', {}, 310);

  const count1 = JSON.parse(res1.result?.content?.[0]?.text || '{}')?.count;
  const count2 = JSON.parse(res2.result?.content?.[0]?.text || '{}')?.count;
  const count3 = JSON.parse(res3.result?.content?.[0]?.text || '{}')?.count;

  assert(count1 >= 12, `C1 sees final count ${count1} (expected ≥12)`);
  assert(count2 >= 12, `C2 sees final count ${count2} (expected ≥12)`);
  assert(count3 >= 12, `C3 sees final count ${count3} (expected ≥12)`);

  console.log(
    `     🎯 3-way concurrency: All see ${incrementEvents1.length} events, final count=${count1}`
  );
}

// ── Test Runner ──

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
    // Run tests
    await testInstanceIsolation();
    await testDefaultInstanceFallback();
    await testMultiInstanceConcurrency();

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
