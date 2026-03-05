/**
 * Event Log (JSONL) — Unit Test
 *
 * Tests the event log infrastructure that appends JSONL entries
 * after each @stateful mutation. Starts a daemon process and sends
 * commands via Unix socket.
 *
 * Run: npx tsx tests/daemon/event-log.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let daemonProcess: ChildProcess | null = null;
let tmpDir: string;
let socketPath: string;
let photonDir: string;

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

// ── Setup ──

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-log-test-'));
  socketPath = path.join(tmpDir, 'daemon.sock');
  photonDir = path.join(tmpDir, 'photons');
  await fs.mkdir(photonDir, { recursive: true });

  // Create a minimal @stateful photon
  const photonSource = `
/**
 * @description Event log test photon
 * @stateful
 */
export default class LogTest {
  items: { id: string; text: string }[];

  constructor(items: { id: string; text: string }[] = []) {
    this.items = items;
  }

  add(text: string) {
    const item = { id: String(Date.now()), text };
    this.items.push(item);
    return item;
  }

  remove(id: string) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return { error: 'not found' };
    return this.items.splice(idx, 1)[0];
  }
}
`;
  await fs.writeFile(path.join(photonDir, 'log-test.photon.ts'), photonSource);
}

async function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Daemon startup timeout')), 15000);

    daemonProcess = spawn(
      'node',
      [path.join(__dirname, '../../dist/daemon/server.js'), socketPath],
      {
        env: { ...process.env, PHOTON_DIR: photonDir, NODE_ENV: 'test', NODE_OPTIONS: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    daemonProcess.stderr?.on('data', () => {}); // Drain stderr
    daemonProcess.stdout?.on('data', () => {}); // Drain stdout

    daemonProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Wait for socket to become available
    const check = () => {
      const client = net.createConnection(socketPath, () => {
        // Send a ping to verify daemon is responding
        client.write(JSON.stringify({ type: 'ping', id: 'startup' }) + '\n');
        client.on('data', () => {
          client.destroy();
          clearTimeout(timeout);
          resolve();
        });
      });
      client.on('error', () => setTimeout(check, 300));
    };
    setTimeout(check, 800);
  });
}

function sendDaemonRequest(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Daemon request timeout')), 30000);
    const client = net.createConnection(socketPath);
    let buffer = '';

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      // Daemon sends newline-delimited JSON — parse first complete line
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx);
        clearTimeout(timeout);
        client.destroy();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`Invalid JSON response: ${line}`));
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Send request + newline (daemon reads newline-delimited)
    client.write(JSON.stringify(req) + '\n');
  });
}

function cleanup() {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
  }
}

// ── Tests ──

async function testEventLogCreated() {
  console.log('\n📋 Test: Event log JSONL file created after mutation');

  // Execute a mutation via daemon command protocol
  const addRes = await sendDaemonRequest({
    type: 'command',
    id: 'add-1',
    photonName: 'log-test',
    photonPath: path.join(photonDir, 'log-test.photon.ts'),
    method: 'add',
    args: { text: 'First item' },
    workingDir: tmpDir,
  });
  assert(addRes.success === true, `add() succeeded`);

  // Check that the log file exists
  const logPath = path.join(tmpDir, 'state', 'log-test', 'default.log');

  // Give a moment for async write
  await new Promise((r) => setTimeout(r, 500));

  let logContent: string;
  try {
    logContent = await fs.readFile(logPath, 'utf-8');
    assert(true, `Log file exists at expected path`);
  } catch {
    assert(false, `Log file should exist at ${logPath}`);
    return;
  }

  // Parse JSONL lines
  const lines = logContent.trim().split('\n').filter(Boolean);
  assert(lines.length >= 1, `Log has ${lines.length} entry/entries`);

  const entry = JSON.parse(lines[0]);
  assert(entry.seq === 1, `First entry has seq=1, got ${entry.seq}`);
  assert(entry.method === 'add', `Entry method is 'add', got ${entry.method}`);
  assert(typeof entry.timestamp === 'string', `Entry has timestamp`);
  assert(entry.params?.text === 'First item', `Entry has correct params`);
  assert(Array.isArray(entry.patch), `Entry has patch array`);
  assert(entry.patch.length > 0, `Patch has ${entry.patch.length} operation(s)`);
  assert(Array.isArray(entry.inversePatch), `Entry has inversePatch array`);
  assert(
    entry.inversePatch.length > 0,
    `InversePatch has ${entry.inversePatch.length} operation(s)`
  );

  // Verify patch op structure
  const firstOp = entry.patch[0];
  assert(
    ['add', 'remove', 'replace'].includes(firstOp?.op),
    `Patch op is valid RFC 6902: op=${firstOp?.op}`
  );
  assert(typeof firstOp?.path === 'string', `Patch op has path: ${firstOp?.path}`);

  console.log(`     → patch: ${JSON.stringify(entry.patch).slice(0, 200)}`);
}

async function testSequentialEntries() {
  console.log('\n📋 Test: Sequential log entries with incrementing seq numbers');

  // Add another mutation
  await sendDaemonRequest({
    type: 'command',
    id: 'add-2',
    photonName: 'log-test',
    photonPath: path.join(photonDir, 'log-test.photon.ts'),
    method: 'add',
    args: { text: 'Second item' },
    workingDir: tmpDir,
  });

  await new Promise((r) => setTimeout(r, 500));

  const logPath = path.join(tmpDir, 'state', 'log-test', 'default.log');
  const logContent = await fs.readFile(logPath, 'utf-8');
  const lines = logContent.trim().split('\n').filter(Boolean);
  assert(lines.length >= 2, `Log has ${lines.length} entries after second mutation`);

  const entry2 = JSON.parse(lines[lines.length - 1]);
  assert(entry2.seq > 1, `Latest entry has seq > 1, got ${entry2.seq}`);
  assert(entry2.method === 'add', `Latest entry method is 'add'`);
  assert(entry2.params?.text === 'Second item', `Latest entry has correct params`);
}

async function testRemoveGeneratesPatch() {
  console.log('\n📋 Test: Remove mutation generates correct patch ops');

  // Get current items to find an ID
  const listRes = await sendDaemonRequest({
    type: 'command',
    id: 'list-1',
    photonName: 'log-test',
    photonPath: path.join(photonDir, 'log-test.photon.ts'),
    method: 'add',
    args: { text: 'To remove' },
    workingDir: tmpDir,
  });

  const addedId = listRes.data?.id;
  if (!addedId) {
    assert(false, 'Could not get added item ID for remove test');
    return;
  }

  await sendDaemonRequest({
    type: 'command',
    id: 'remove-1',
    photonName: 'log-test',
    photonPath: path.join(photonDir, 'log-test.photon.ts'),
    method: 'remove',
    args: { id: addedId },
    workingDir: tmpDir,
  });

  await new Promise((r) => setTimeout(r, 500));

  const logPath = path.join(tmpDir, 'state', 'log-test', 'default.log');
  const logContent = await fs.readFile(logPath, 'utf-8');
  const lines = logContent.trim().split('\n').filter(Boolean);

  const removeEntry = lines.map((l) => JSON.parse(l)).find((e) => e.method === 'remove');
  if (removeEntry) {
    assert(removeEntry.patch.length > 0, `Remove has ${removeEntry.patch.length} patch op(s)`);
    assert(removeEntry.inversePatch.length > 0, `Remove has inversePatch ops`);
    console.log(`     → remove patch: ${JSON.stringify(removeEntry.patch).slice(0, 200)}`);
    console.log(`     → remove inverse: ${JSON.stringify(removeEntry.inversePatch).slice(0, 200)}`);
  } else {
    assert(false, 'Expected remove entry in log');
  }
}

// ── Main ──

async function main() {
  console.log('🔧 Setting up test photon...');
  await setup();

  console.log('🚀 Starting daemon...');
  try {
    await startDaemon();
    console.log('✅ Daemon started');
  } catch (err) {
    console.error('❌ Failed to start daemon:', err);
    cleanup();
    process.exit(1);
  }

  try {
    await testEventLogCreated();
    await testSequentialEntries();
    await testRemoveGeneratesPatch();
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
