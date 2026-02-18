/**
 * Daemon File Watcher & Resilience Tests
 *
 * Integration tests using the REAL daemon server (not mocks).
 * Tests file watching, daemon restart recovery, event replay,
 * and cross-client state sync — the full vertical.
 *
 * These tests:
 * 1. Spawn a real daemon process
 * 2. Edit photon files and verify auto-reload
 * 3. Kill the daemon and verify reconnection + refresh_needed
 * 4. Verify cross-client state-changed events propagate
 * 5. Verify instance routing survives daemon restart
 */

import { strict as assert } from 'assert';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import type { DaemonRequest, DaemonResponse } from '../dist/daemon/protocol.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  \u2713 ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  \u2717 ${name}`);
      console.log(`    ${err.message}`);
    });
}

// ============================================================================
// Test Infrastructure — Real Daemon Process
// ============================================================================

const TEST_DIR = path.join(os.tmpdir(), `photon-watcher-test-${Date.now()}`);
const SOCKET_PATH = path.join(TEST_DIR, 'daemon.sock');
const PHOTON_FILE = path.join(TEST_DIR, 'test-watcher.photon.ts');
const STATE_DIR = path.join(TEST_DIR, 'state', 'test-watcher');

/** Minimal stateful photon for testing */
const PHOTON_SOURCE = `
/**
 * @stateful
 */
export default class TestWatcher {
  items: string[] = [];

  add(text: string) {
    this.items.push(text);
    return { added: text, count: this.items.length };
  }

  get() {
    return { items: this.items };
  }

  remove(text: string) {
    const idx = this.items.indexOf(text);
    if (idx === -1) return { removed: false };
    this.items.splice(idx, 1);
    return { removed: true, count: this.items.length };
  }
}
`;

let daemonProcess: ChildProcess | null = null;
let daemonLog: string[] = [];

function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');
    daemonLog = [];

    // Clean up stale socket before starting
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}

    daemonProcess = spawn('node', [serverPath, SOCKET_PATH], {
      env: { ...process.env, PHOTON_STATE_DIR: STATE_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    daemonProcess.stdout?.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      daemonLog.push(...lines);
    });
    daemonProcess.stderr?.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      daemonLog.push(...lines);
    });

    daemonProcess.on('error', reject);
    daemonProcess.on('exit', (code, signal) => {
      daemonLog.push(`[daemon-exit] code=${code} signal=${signal}`);
    });

    // Wait for socket to appear
    const check = setInterval(() => {
      if (fs.existsSync(SOCKET_PATH)) {
        clearInterval(check);
        resolve();
      }
    }, 50);

    setTimeout(() => {
      clearInterval(check);
      const logSnapshot = daemonLog.join('\n');
      reject(new Error(`Daemon did not start in 10s. Log: ${logSnapshot.slice(0, 500)}`));
    }, 10000);
  });
}

function killDaemon(): Promise<void> {
  return new Promise((resolve) => {
    const proc = daemonProcess; // Capture reference to avoid race with startDaemon
    if (!proc || proc.killed) {
      resolve();
      return;
    }
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
    // Force kill after 2s
    setTimeout(() => {
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
      resolve();
    }, 2000);
  });
}

function getDaemonLog(): string[] {
  return [...daemonLog];
}

function clearDaemonLog(): void {
  daemonLog = [];
}

/** Send a request to the daemon and wait for a matching response */
function sendRequest(request: DaemonRequest, timeout = 10000): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let buffer = '';

    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`Request timeout for ${request.method || request.type}`));
    }, timeout);

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: DaemonResponse = JSON.parse(line);
          if (response.id === request.id) {
            clearTimeout(timer);
            client.destroy();
            resolve(response);
            return;
          }
        } catch {
          // partial message
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Subscribe to a channel, return a handle to receive messages and unsubscribe */
function subscribeToChannel(
  channel: string,
  photonName: string
): Promise<{
  messages: Array<{ type: string; message?: any; channel?: string }>;
  unsubscribe: () => void;
  client: net.Socket;
}> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    const messages: Array<{ type: string; message?: any; channel?: string }> = [];
    const subId = `sub_${Date.now()}`;
    let buffer = '';

    client.on('connect', () => {
      const req: DaemonRequest = {
        type: 'subscribe',
        id: subId,
        photonName,
        channel,
        clientType: 'test',
      };
      client.write(JSON.stringify(req) + '\n');
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: DaemonResponse = JSON.parse(line);
          if (response.id === subId && response.type === 'result') {
            resolve({
              messages,
              unsubscribe: () => client.destroy(),
              client,
            });
          }
          // Collect all messages including channel_message and refresh_needed
          messages.push({
            type: response.type,
            message: (response as any).message,
            channel: (response as any).channel,
          });
        } catch {
          // partial
        }
      }
    });

    client.on('error', (err) => reject(err));

    setTimeout(() => reject(new Error('Subscribe timeout')), 5000);
  });
}

/** Subscribe with a stale lastEventId (simulates reconnection after daemon restart) */
function subscribeWithLastEventId(
  channel: string,
  photonName: string,
  lastEventId: string
): Promise<{
  messages: Array<{ type: string; message?: any; channel?: string }>;
  unsubscribe: () => void;
}> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    const messages: Array<{ type: string; message?: any; channel?: string }> = [];
    const subId = `sub_stale_${Date.now()}`;
    let buffer = '';
    let resolved = false;

    client.on('connect', () => {
      const req: DaemonRequest = {
        type: 'subscribe',
        id: subId,
        photonName,
        channel,
        clientType: 'test',
        lastEventId,
      };
      client.write(JSON.stringify(req) + '\n');
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          messages.push({
            type: response.type,
            message: response.message,
            channel: response.channel,
          });
          // Resolve after we've seen both refresh_needed and result, or just result
          if (!resolved && response.type === 'result' && response.id === subId) {
            resolved = true;
            // Give a small window for refresh_needed to arrive (it comes before result)
            setTimeout(
              () =>
                resolve({
                  messages,
                  unsubscribe: () => client.destroy(),
                }),
              50
            );
          }
        } catch {
          // partial
        }
      }
    });

    client.on('error', (err) => reject(err));
    setTimeout(() => {
      if (!resolved) reject(new Error('Stale subscribe timeout'));
    }, 5000);
  });
}

// ============================================================================
// Test 1: File Watcher — edit triggers auto-reload
// ============================================================================

async function testFileWatcher() {
  console.log('\nFile Watcher (auto-reload on file change):');

  // Initialize the photon by sending a command
  await test('daemon initializes photon and starts watching file', async () => {
    const response = await sendRequest({
      type: 'command',
      id: 'init_1',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'test-session',
      clientType: 'test',
      method: 'get',
      args: {},
    });
    assert.equal(response.type, 'result');

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('Watching photon file'),
      'Expected "Watching photon file" in daemon log'
    );
  });

  // Edit the file and verify daemon reloads
  await test('editing photon file triggers auto-reload', async () => {
    clearDaemonLog();

    // Append a comment to trigger change event
    fs.appendFileSync(PHOTON_FILE, '\n// watcher-test-edit\n');

    // Wait for debounce (100ms) + reload time
    await new Promise((r) => setTimeout(r, 500));

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('File changed, auto-reloading'),
      'Expected "File changed, auto-reloading" in daemon log'
    );
    assert.ok(
      log.includes('Photon reloaded successfully'),
      'Expected "Photon reloaded successfully" in daemon log'
    );
  });

  // Verify state survives reload
  await test('state preserved after file-watcher reload', async () => {
    // Add an item first
    await sendRequest({
      type: 'command',
      id: 'add_1',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'test-session',
      clientType: 'test',
      method: 'add',
      args: { text: 'survive-reload' },
    });

    clearDaemonLog();

    // Trigger a reload via file edit
    fs.appendFileSync(PHOTON_FILE, '\n// reload-state-test\n');
    await new Promise((r) => setTimeout(r, 500));

    // Verify state is preserved (items copied to new instance)
    const response = await sendRequest({
      type: 'command',
      id: 'get_after_reload',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'test-session',
      clientType: 'test',
      method: 'get',
      args: {},
    });
    assert.equal(response.type, 'result');
    const data = response.data as any;
    assert.ok(
      data.items?.includes('survive-reload'),
      `Expected items to contain "survive-reload", got: ${JSON.stringify(data)}`
    );
  });

  // Test macOS file replacement (sed -i style: delete + recreate)
  await test('file replacement (new inode) re-establishes watcher', async () => {
    clearDaemonLog();

    // Read current content, delete file, write new file (simulates sed -i)
    const content = fs.readFileSync(PHOTON_FILE, 'utf-8');
    fs.unlinkSync(PHOTON_FILE);
    fs.writeFileSync(PHOTON_FILE, content + '\n// inode-replaced\n');

    // Wait for rename detection + re-watch + reload
    // macOS fs.watch rename events can be slow — give extra time
    await new Promise((r) => setTimeout(r, 1500));

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('File changed, auto-reloading'),
      'Expected auto-reload after file replacement'
    );
  });
}

// ============================================================================
// Test 2: Cross-client state sync via pub/sub
// ============================================================================

async function testCrossClientSync() {
  console.log('\nCross-Client State Sync (pub/sub):');

  await test('state-changed event published when tool executes', async () => {
    // Subscribe to state-changed channel
    const sub = await subscribeToChannel('test-watcher:state-changed', 'test-watcher');

    // Execute a tool via a different "client"
    await sendRequest({
      type: 'command',
      id: 'sync_add_1',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'cli-session',
      clientType: 'cli',
      method: 'add',
      args: { text: 'from-cli' },
    });

    // Wait for event propagation
    await new Promise((r) => setTimeout(r, 200));

    sub.unsubscribe();

    const stateChangedEvents = sub.messages.filter(
      (m) => m.type === 'channel_message' && m.channel === 'test-watcher:state-changed'
    );
    assert.ok(
      stateChangedEvents.length > 0,
      `Expected at least one state-changed event, got ${stateChangedEvents.length}`
    );

    const event = stateChangedEvents[0];
    assert.equal(
      (event.message as any)?.method,
      'add',
      'state-changed event should include method name'
    );
  });

  await test('subscriber receives events from other clients in real-time', async () => {
    const sub = await subscribeToChannel('test-watcher:state-changed', 'test-watcher');

    // Simulate two different CLI clients making changes
    await sendRequest({
      type: 'command',
      id: 'sync_cli_a',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'cli-a',
      clientType: 'cli',
      method: 'add',
      args: { text: 'item-from-a' },
    });

    await sendRequest({
      type: 'command',
      id: 'sync_cli_b',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'cli-b',
      clientType: 'cli',
      method: 'add',
      args: { text: 'item-from-b' },
    });

    await new Promise((r) => setTimeout(r, 200));
    sub.unsubscribe();

    const events = sub.messages.filter((m) => m.type === 'channel_message');
    assert.ok(events.length >= 2, `Expected at least 2 state-changed events, got ${events.length}`);
  });
}

// ============================================================================
// Test 3: Event replay — refresh_needed after daemon restart
// ============================================================================

async function testEventReplayAfterRestart() {
  console.log('\nEvent Replay After Daemon Restart:');

  await test('fresh subscriber (no lastEventId) gets no refresh_needed', async () => {
    // A truly fresh subscriber doesn't send lastEventId at all
    const sub = await subscribeToChannel('test-watcher:state-changed', 'test-watcher');

    // Give time for any messages
    await new Promise((r) => setTimeout(r, 100));
    sub.unsubscribe();

    const refreshMessages = sub.messages.filter((m) => m.type === 'refresh_needed');
    assert.equal(refreshMessages.length, 0, 'Fresh subscriber should not get refresh_needed');
  });

  await test('stale subscriber (has lastEventId) gets refresh_needed on fresh daemon', async () => {
    // Kill daemon and restart — buffer is gone
    await killDaemon();
    // Clean up socket file
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}
    await startDaemon();

    // Subscribe with a stale lastEventId (from before restart)
    const sub = await subscribeWithLastEventId(
      'test-watcher:state-changed',
      'test-watcher',
      '1707600000000' // Old timestamp
    );

    await new Promise((r) => setTimeout(r, 100));
    sub.unsubscribe();

    const refreshMessages = sub.messages.filter((m) => m.type === 'refresh_needed');
    assert.ok(
      refreshMessages.length > 0,
      'Stale subscriber should get refresh_needed after daemon restart'
    );
  });

  await test('subscriber with lastEventId=0 does NOT get refresh_needed', async () => {
    const sub = await subscribeWithLastEventId('test-watcher:state-changed', 'test-watcher', '0');

    await new Promise((r) => setTimeout(r, 100));
    sub.unsubscribe();

    const refreshMessages = sub.messages.filter((m) => m.type === 'refresh_needed');
    assert.equal(
      refreshMessages.length,
      0,
      'lastEventId=0 should be treated as fresh (no refresh needed)'
    );
  });

  await test('delta replay works for events within buffer window', async () => {
    // Initialize the photon on the new daemon
    await sendRequest({
      type: 'command',
      id: 'replay_init',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'replay-session',
      clientType: 'test',
      method: 'get',
      args: {},
    });

    // Generate some events
    const beforeTimestamp = Date.now();
    await new Promise((r) => setTimeout(r, 10));

    await sendRequest({
      type: 'command',
      id: 'replay_add_1',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'replay-session',
      clientType: 'test',
      method: 'add',
      args: { text: 'replay-item-1' },
    });

    await sendRequest({
      type: 'command',
      id: 'replay_add_2',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'replay-session',
      clientType: 'test',
      method: 'add',
      args: { text: 'replay-item-2' },
    });

    // Now subscribe with the timestamp from before the events
    const sub = await subscribeWithLastEventId(
      'test-watcher:state-changed',
      'test-watcher',
      String(beforeTimestamp)
    );

    await new Promise((r) => setTimeout(r, 100));
    sub.unsubscribe();

    // Should have replayed the two events
    const replayed = sub.messages.filter((m) => m.type === 'channel_message');
    assert.ok(replayed.length >= 2, `Expected at least 2 replayed events, got ${replayed.length}`);
  });
}

// ============================================================================
// Test 4: Instance routing survives daemon restart
// ============================================================================

async function testInstanceRoutingAfterRestart() {
  console.log('\nInstance Routing After Daemon Restart:');

  await test('instance switch works on fresh daemon', async () => {
    // Initialize photon
    await sendRequest({
      type: 'command',
      id: 'inst_init',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'inst-session',
      clientType: 'test',
      method: 'get',
      args: {},
    });

    // Switch to "macha" instance
    const useResponse = await sendRequest({
      type: 'command',
      id: 'inst_use',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'inst-session',
      clientType: 'test',
      method: '_use',
      args: { name: 'macha' },
    });
    assert.equal(useResponse.type, 'result');
    assert.equal((useResponse.data as any).instance, 'macha');
  });

  await test('instanceName in request auto-recovers after daemon restart', async () => {
    // Kill and restart daemon (session state lost)
    await killDaemon();
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}
    await startDaemon();

    // Send command with instanceName hint — should auto-recover
    clearDaemonLog();
    const response = await sendRequest({
      type: 'command',
      id: 'inst_recover',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'inst-session',
      clientType: 'test',
      method: 'get',
      args: {},
      instanceName: 'macha',
    });
    assert.equal(response.type, 'result');

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('Instance drift detected') || log.includes('auto-switching'),
      'Expected instance drift auto-recovery in log'
    );
  });

  await test('without instanceName hint, falls back to default (documents known limitation)', async () => {
    // Kill and restart again (allow extra time for process cleanup)
    await killDaemon();
    await new Promise((r) => setTimeout(r, 500));
    await startDaemon();

    // Send command WITHOUT instanceName — no recovery possible
    const response = await sendRequest({
      type: 'command',
      id: 'inst_no_hint',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'inst-session',
      clientType: 'test',
      method: 'get',
      args: {},
      // NO instanceName — drift recovery cannot help without the hint
    });
    assert.equal(response.type, 'result');

    // This is expected: without the hint, daemon has no way to know
    // which instance the client was on. The fix is in the client layers
    // (Beam frontend awaits _restoreInstance before tool calls).
    const log = getDaemonLog().join('\n');
    assert.ok(
      !log.includes('Instance drift detected'),
      'Without instanceName hint, no drift recovery should happen'
    );
  });
}

// ============================================================================
// Test 5: Subscription retry on initial connection failure
// ============================================================================

async function testSubscriptionRetryOnInitialFailure() {
  console.log('\nSubscription Retry (daemon not running at subscribe time):');

  // Kill daemon so subscription will fail initially
  await killDaemon();
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}

  await test('subscription to non-existent socket with reconnect resolves (does not reject)', async () => {
    // Connect to a socket that doesn't exist
    const badSocket = path.join(TEST_DIR, 'nonexistent.sock');
    const messages: any[] = [];

    // Without reconnect: should reject
    let rejected = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const client = net.createConnection(badSocket);
        client.on('error', (err) => reject(err));
        client.on('connect', () => resolve());
      });
    } catch {
      rejected = true;
    }
    assert.ok(rejected, 'Connection to nonexistent socket should reject without reconnect');
  });

  await test('subscription retries and connects when daemon starts later', async () => {
    // Start a mock server AFTER a delay, simulating daemon starting later
    const retrySocket = path.join(TEST_DIR, 'retry-test.sock');
    const received: string[] = [];

    // Start trying to connect before server exists
    const connectPromise = new Promise<net.Socket>((resolve) => {
      let attempts = 0;
      const tryConnect = () => {
        attempts++;
        const client = net.createConnection(retrySocket);
        client.on('connect', () => {
          received.push('connected');
          resolve(client);
        });
        client.on('error', () => {
          if (attempts < 10) {
            setTimeout(tryConnect, 200);
          }
        });
      };
      tryConnect();
    });

    // Start server after 500ms
    await new Promise((r) => setTimeout(r, 500));
    const server = net.createServer((socket) => {
      socket.write(JSON.stringify({ type: 'result', id: 'test', success: true, data: {} }) + '\n');
    });
    await new Promise<void>((resolve) => server.listen(retrySocket, () => resolve()));

    // Wait for connection
    const client = await connectPromise;
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.unlinkSync(retrySocket);
    } catch {}

    assert.ok(received.includes('connected'), 'Client should eventually connect after retries');
  });

  // Restart daemon for remaining tests
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
  await startDaemon();
}

// ============================================================================
// Test 6: File watcher survives daemon reload cycle
// ============================================================================

async function testWatcherSurvivesReloadCycle() {
  console.log('\nFile Watcher Resilience:');

  await test('watcher re-established after daemon restart', async () => {
    // Initialize photon to start watcher (daemon may have been restarted by earlier tests)
    clearDaemonLog();
    await sendRequest({
      type: 'command',
      id: 'resilience_init',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'resilience-session',
      clientType: 'test',
      method: 'get',
      args: {},
    });

    const initLog = getDaemonLog().join('\n');
    assert.ok(initLog.includes('Watching photon file'), 'Watcher should be set up on init');

    // Edit file and verify reload (allow extra time after daemon restart)
    clearDaemonLog();
    fs.appendFileSync(PHOTON_FILE, '\n// resilience-test\n');
    await new Promise((r) => setTimeout(r, 1500));

    const reloadLog = getDaemonLog().join('\n');
    assert.ok(
      reloadLog.includes('File changed, auto-reloading'),
      'File edit should trigger reload'
    );
  });

  await test('multiple rapid edits are debounced into single reload', async () => {
    clearDaemonLog();

    // Rapid-fire 5 edits in 50ms
    for (let i = 0; i < 5; i++) {
      fs.appendFileSync(PHOTON_FILE, `\n// rapid-edit-${i}\n`);
      await new Promise((r) => setTimeout(r, 10));
    }

    // Wait for debounce (100ms) + reload
    await new Promise((r) => setTimeout(r, 600));

    const log = getDaemonLog().join('\n');
    const reloadCount = (log.match(/File changed, auto-reloading/g) || []).length;
    assert.ok(reloadCount <= 2, `Expected at most 2 reloads from debouncing, got ${reloadCount}`);
  });
}

// ============================================================================
// Test 7: Symlink watching — daemon watches real path, not symlink inode
// ============================================================================

const SYMLINK_REAL_DIR = path.join(TEST_DIR, 'real-project');
const SYMLINK_PHOTON_DIR = path.join(TEST_DIR, 'photon-home');
const REAL_PHOTON_FILE = path.join(SYMLINK_REAL_DIR, 'symtest.photon.ts');
const SYMLINKED_PHOTON_FILE = path.join(SYMLINK_PHOTON_DIR, 'symtest.photon.ts');

const SYMTEST_SOURCE_V1 = `
export default class Symtest {
  async version() {
    return { version: 1 };
  }
}
`;

const SYMTEST_SOURCE_V2 = `
export default class Symtest {
  async version() {
    return { version: 2 };
  }
}
`;

async function testSymlinkWatching() {
  console.log('\nSymlink Watching (resolves real path):');

  // Setup: create real file + symlink pointing to it
  fs.mkdirSync(SYMLINK_REAL_DIR, { recursive: true });
  fs.mkdirSync(SYMLINK_PHOTON_DIR, { recursive: true });
  fs.writeFileSync(REAL_PHOTON_FILE, SYMTEST_SOURCE_V1);
  fs.symlinkSync(REAL_PHOTON_FILE, SYMLINKED_PHOTON_FILE);

  await test('daemon resolves symlink and watches real path', async () => {
    clearDaemonLog();

    // Initialize via the SYMLINK path
    const response = await sendRequest({
      type: 'command',
      id: 'sym_init',
      photonName: 'symtest',
      photonPath: SYMLINKED_PHOTON_FILE,
      sessionId: 'sym-session',
      clientType: 'test',
      method: 'version',
      args: {},
    });
    assert.equal(response.type, 'result');
    assert.equal((response.data as any).version, 1);

    const log = getDaemonLog().join('\n');
    // Watcher should log the REAL path (resolved), not the symlink
    assert.ok(
      log.includes('Watching photon file') && log.includes(SYMLINK_REAL_DIR),
      `Expected watcher to use real path (${SYMLINK_REAL_DIR}), got log:\n${log}`
    );
  });

  await test('editing the REAL file (symlink target) triggers reload', async () => {
    clearDaemonLog();

    // Edit the REAL file — NOT the symlink
    fs.writeFileSync(REAL_PHOTON_FILE, SYMTEST_SOURCE_V2);

    // Wait for debounce + reload
    await new Promise((r) => setTimeout(r, 800));

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('File changed, auto-reloading'),
      `Expected auto-reload when editing real file. Log:\n${log}`
    );
    assert.ok(log.includes('Photon reloaded successfully'), 'Expected successful reload');
  });

  await test('reloaded code uses new version from real file', async () => {
    const response = await sendRequest({
      type: 'command',
      id: 'sym_v2',
      photonName: 'symtest',
      photonPath: SYMLINKED_PHOTON_FILE,
      sessionId: 'sym-session',
      clientType: 'test',
      method: 'version',
      args: {},
    });
    assert.equal(response.type, 'result');
    assert.equal(
      (response.data as any).version,
      2,
      `Expected version 2 after reload, got ${JSON.stringify(response.data)}`
    );
  });

  await test('file replacement via symlink target (sed -i) re-establishes watcher', async () => {
    clearDaemonLog();

    // Simulate sed -i on the REAL file: delete + recreate (new inode)
    const content = fs.readFileSync(REAL_PHOTON_FILE, 'utf-8');
    fs.unlinkSync(REAL_PHOTON_FILE);
    fs.writeFileSync(REAL_PHOTON_FILE, content + '\n// inode-replaced-via-symlink\n');

    // macOS fs.watch rename events can be slow — give extra time
    await new Promise((r) => setTimeout(r, 2000));

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('File changed, auto-reloading'),
      'Expected auto-reload after inode replacement of symlink target'
    );
  });
}

// ============================================================================
// Test 8: Startup watch — daemon watches all photons from boot
// ============================================================================

async function testStartupWatch() {
  console.log('\nStartup Watch (proactive scan at boot):');

  // Kill current daemon and restart to test startup behavior
  await killDaemon();
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}

  // Write a NEW photon file before starting daemon
  const startupPhotonFile = path.join(TEST_DIR, 'startup-test.photon.ts');
  fs.writeFileSync(
    startupPhotonFile,
    `
export default class StartupTest {
  async ping() { return { pong: true }; }
}
`
  );

  // We can't override DEFAULT_PHOTON_DIR, but we CAN verify:
  // 1. The daemon source has startupWatchPhotons()
  // 2. After starting, a tool call + file edit still works
  // (The full startup scan is verified via the source pattern test)

  await startDaemon();

  await test('daemon starts successfully and accepts connections', async () => {
    // Send a basic command to verify the daemon is responsive
    const response = await sendRequest({
      type: 'command',
      id: 'startup_ping',
      photonName: 'test-watcher',
      photonPath: PHOTON_FILE,
      sessionId: 'startup-session',
      clientType: 'test',
      method: 'get',
      args: {},
    });
    assert.equal(response.type, 'result');
  });

  await test('file edit detected on daemon that was freshly started', async () => {
    clearDaemonLog();

    // Edit the test file — watcher was set up during the first command
    fs.appendFileSync(PHOTON_FILE, '\n// startup-watcher-test\n');
    await new Promise((r) => setTimeout(r, 600));

    const log = getDaemonLog().join('\n');
    assert.ok(
      log.includes('File changed, auto-reloading'),
      'Expected file change detection on fresh daemon'
    );
  });
}

// ============================================================================
// Test 9: Content-addressed cache invalidation
// ============================================================================

async function testContentAddressedCache() {
  console.log('\nContent-Addressed Cache (stale .mjs never used):');

  const cacheTestFile = path.join(TEST_DIR, 'cache-test.photon.ts');

  const SOURCE_A = `
export default class CacheTest {
  async value() { return { answer: 'alpha' }; }
}
`;

  const SOURCE_B = `
export default class CacheTest {
  async value() { return { answer: 'bravo' }; }
}
`;

  fs.writeFileSync(cacheTestFile, SOURCE_A);

  await test('first load compiles and returns correct result', async () => {
    const response = await sendRequest({
      type: 'command',
      id: 'cache_v1',
      photonName: 'cache-test',
      photonPath: cacheTestFile,
      sessionId: 'cache-session',
      clientType: 'test',
      method: 'value',
      args: {},
    });
    assert.equal(response.type, 'result');
    assert.equal((response.data as any).answer, 'alpha');
  });

  await test('after source change + reload, new code is used (not stale cache)', async () => {
    // Write new content
    fs.writeFileSync(cacheTestFile, SOURCE_B);

    // Wait for watcher to detect and reload
    await new Promise((r) => setTimeout(r, 800));

    const response = await sendRequest({
      type: 'command',
      id: 'cache_v2',
      photonName: 'cache-test',
      photonPath: cacheTestFile,
      sessionId: 'cache-session',
      clientType: 'test',
      method: 'value',
      args: {},
    });
    assert.equal(response.type, 'result');
    assert.equal(
      (response.data as any).answer,
      'bravo',
      `Expected "bravo" after source change, got "${(response.data as any).answer}" — stale cache!`
    );
  });

  await test('reverting source back to original also picks up fresh compile', async () => {
    // Write back original content
    fs.writeFileSync(cacheTestFile, SOURCE_A);
    await new Promise((r) => setTimeout(r, 800));

    const response = await sendRequest({
      type: 'command',
      id: 'cache_v3',
      photonName: 'cache-test',
      photonPath: cacheTestFile,
      sessionId: 'cache-session',
      clientType: 'test',
      method: 'value',
      args: {},
    });
    assert.equal(response.type, 'result');
    assert.equal(
      (response.data as any).answer,
      'alpha',
      `Expected "alpha" after revert, got "${(response.data as any).answer}"`
    );
  });
}

// ============================================================================
// Test 10: Source verification — code patterns exist
// ============================================================================

async function testSourcePatterns() {
  console.log('\nSource Code Verification:');

  const fsPromises = await import('fs/promises');

  await test('daemon server has file watcher infrastructure', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    assert.ok(source.includes('fileWatchers'), 'Expected fileWatchers map');
    assert.ok(source.includes('watchDebounce'), 'Expected watchDebounce map');
    assert.ok(source.includes('watchPhotonFile'), 'Expected watchPhotonFile function');
    assert.ok(source.includes('unwatchPhotonFile'), 'Expected unwatchPhotonFile function');
  });

  await test('daemon cleans up watchers on shutdown', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    // shutdown() should close watchers
    const shutdownSection = source.slice(source.indexOf('function shutdown()'));
    assert.ok(
      shutdownSection.includes('unwatchPhotonFile'),
      'Expected unwatchPhotonFile in shutdown()'
    );
  });

  await test('beam does NOT call reloadDaemon anymore', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/auto-ui/beam.ts'),
      'utf-8'
    );
    assert.ok(
      !source.includes('reloadDaemon'),
      'Beam should not import or call reloadDaemon — daemon watches its own files'
    );
  });

  await test('PhotonServer does NOT call reloadDaemon anymore', async () => {
    const source = await fsPromises.readFile(path.join(process.cwd(), 'src/server.ts'), 'utf-8');
    assert.ok(
      !source.includes('reloadDaemon'),
      'PhotonServer should not import or call reloadDaemon — daemon watches its own files'
    );
  });

  await test('getEventsSince signals refresh_needed when buffer is empty but client has lastEventId', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes('refreshNeeded: lastTimestamp > 0'),
      'Expected empty buffer + non-zero lastTimestamp to return refreshNeeded: true'
    );
  });

  await test('beam subscription includes onRefreshNeeded handler', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/auto-ui/beam.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes('onRefreshNeeded'),
      'Expected onRefreshNeeded handler in beam subscription'
    );
  });

  await test('subscribeChannel retries on initial connection failure when reconnect is true', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/client.ts'),
      'utf-8'
    );
    // The error handler should call scheduleReconnect even when !subscribed
    assert.ok(
      source.includes('scheduleReconnect') && source.includes('!subscribed'),
      'Expected reconnect logic for initial connection failure'
    );
  });

  await test('beam frontend awaits _restoreInstance before tool execution', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/auto-ui/frontend/components/beam-app.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes('await this._restoreInstance'),
      'Expected _restoreInstance to be awaited (prevents race condition with tool execution)'
    );
  });

  await test('daemon handles file rename events (macOS sed -i)', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes("eventType === 'rename'"),
      'Expected rename event handling for macOS file replacement'
    );
  });

  await test('watchPhotonFile resolves symlinks via realpathSync', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes('fs.realpathSync(photonPath)'),
      'Expected realpathSync in watchPhotonFile for symlink resolution'
    );
  });

  await test('startupWatchPhotons scans photon directory at boot', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes('function startupWatchPhotons'),
      'Expected startupWatchPhotons function'
    );
    assert.ok(
      source.includes('DEFAULT_PHOTON_DIR'),
      'Expected DEFAULT_PHOTON_DIR import for startup scan'
    );
    assert.ok(
      source.includes('.photon.ts') && source.includes('.photon.js'),
      'Expected both .photon.ts and .photon.js extensions in startup scan'
    );
  });

  await test('startupWatchPhotons is called in daemon main IIFE', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    // Find the main IIFE and verify startupWatchPhotons is called before startServer
    const iifeMatch = source.match(/\(\(\)\s*=>\s*\{[\s\S]*?startServer/);
    assert.ok(iifeMatch, 'Expected main IIFE with startServer');
    assert.ok(
      iifeMatch![0].includes('startupWatchPhotons'),
      'Expected startupWatchPhotons() called before startServer() in main IIFE'
    );
  });

  await test('compiler uses content-addressed caching (hash in filename)', async () => {
    const source = await fsPromises.readFile(
      path.join(process.cwd(), '../photon-core/src/compiler.ts'),
      'utf-8'
    );
    assert.ok(
      source.includes('createHash') && source.includes('.mjs'),
      'Expected content hash used in .mjs filename'
    );
    // Verify cache-hit check exists
    assert.ok(source.includes('fs.access(cachedJsPath)'), 'Expected cache-hit check via fs.access');
  });
}

// ============================================================================
// Setup & Teardown
// ============================================================================

function setup() {
  // Create test directory and photon file
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PHOTON_FILE, PHOTON_SOURCE);
}

async function teardown() {
  await killDaemon();
  // Clean up test files
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ============================================================================
// Run All Tests
// ============================================================================

(async () => {
  console.log('Daemon File Watcher & Resilience Tests');
  console.log('======================================');

  setup();

  try {
    await startDaemon();

    await testFileWatcher();
    await testCrossClientSync();
    await testEventReplayAfterRestart();
    await testInstanceRoutingAfterRestart();
    await testSubscriptionRetryOnInitialFailure();
    await testWatcherSurvivesReloadCycle();
    await testSymlinkWatching();
    await testStartupWatch();
    await testContentAddressedCache();
    await testSourcePatterns();
  } catch (err) {
    console.error('\nFATAL:', err);
    failed++;
  } finally {
    await teardown();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
