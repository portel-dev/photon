/**
 * Undo / Redo — Unit Test
 *
 * Tests the auto-injected _undo and _redo tools on @stateful photons.
 * Verifies state reversal, redo cycle, empty stack behavior, and
 * new mutations clearing the redo future.
 *
 * Run: npx tsx tests/daemon/undo-redo.test.ts
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'undo-redo-test-'));
  socketPath = path.join(tmpDir, 'daemon.sock');
  photonDir = path.join(tmpDir, 'photons');
  await fs.mkdir(photonDir, { recursive: true });

  const photonSource = `
/**
 * @description Undo/redo test photon
 * @stateful
 */
export default class UndoTest {
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
    return [...this.items];
  }
}
`;
  await fs.writeFile(path.join(photonDir, 'undo-test.photon.ts'), photonSource);
}

async function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Daemon startup timeout')), 15000);

    daemonProcess = spawn(
      'node',
      [path.join(__dirname, '../../dist/daemon/server.js'), socketPath],
      {
        env: { ...process.env, PHOTON_DIR: photonDir, NODE_ENV: 'test' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    daemonProcess.stderr?.on('data', () => {}); // Drain
    daemonProcess.stdout?.on('data', () => {}); // Drain

    daemonProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    const check = () => {
      const client = net.createConnection(socketPath, () => {
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
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx);
        clearTimeout(timeout);
        client.destroy();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`Invalid JSON: ${line}`));
        }
      }
    });
    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    client.write(JSON.stringify(req) + '\n');
  });
}

function cleanup() {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
  }
}

const photonPath = () => path.join(photonDir, 'undo-test.photon.ts');

function cmd(method: string, args: any = {}, id: string = `cmd-${Date.now()}`) {
  return sendDaemonRequest({
    type: 'command',
    id,
    photonName: 'undo-test',
    photonPath: photonPath(),
    method,
    args,
    workingDir: tmpDir,
  });
}

async function getItems(): Promise<any[]> {
  const res = await cmd('list');
  return res.data || [];
}

// ── Tests ──

async function testUndoRevertsLastMutation() {
  console.log('\n📋 Test: _undo reverts the last mutation');

  // Add two items
  await cmd('add', { text: 'First' });
  await cmd('add', { text: 'Second' });

  let items = await getItems();
  assert(items.length === 2, `Have 2 items before undo`);

  // Undo last add
  const undoRes = await cmd('_undo');
  assert(undoRes.success === true, `_undo succeeded`);
  assert(undoRes.data?.action === 'undo', `Response confirms undo action`);
  assert(undoRes.data?.method === 'add', `Undid 'add' method`);

  items = await getItems();
  assert(items.length === 1, `Have 1 item after undo (was 2)`);
  assert(items[0]?.text === 'First', `Remaining item is 'First'`);
}

async function testRedoRestoresUndone() {
  console.log('\n📋 Test: _redo restores undone mutation');

  let items = await getItems();
  const beforeCount = items.length;

  // Add an item
  await cmd('add', { text: 'Redo item' });

  // Undo it
  await cmd('_undo');

  items = await getItems();
  assert(items.length === beforeCount, `Back to ${beforeCount} items after undo`);

  // Redo it
  const redoRes = await cmd('_redo');
  assert(redoRes.success === true, `_redo succeeded`);
  assert(redoRes.data?.action === 'redo', `Response confirms redo action`);

  items = await getItems();
  assert(items.length === beforeCount + 1, `Back to ${beforeCount + 1} items after redo`);
  assert(items[items.length - 1]?.text === 'Redo item', `Redo restored 'Redo item'`);
}

async function testEmptyUndoStack() {
  console.log('\n📋 Test: _undo on empty stack returns error message');

  // Undo everything until stack is empty
  let maxAttempts = 20;
  while (maxAttempts-- > 0) {
    const res = await cmd('_undo');
    if (res.data?.error?.includes('Nothing to undo')) {
      assert(true, `Got "Nothing to undo" error`);
      return;
    }
  }
  assert(false, 'Should have hit empty stack');
}

async function testEmptyRedoStack() {
  console.log('\n📋 Test: _redo on empty stack returns error message');

  // Exhaust redo stack first (previous test filled it via undos)
  let maxAttempts = 20;
  while (maxAttempts-- > 0) {
    const r = await cmd('_redo');
    if (r.data?.error?.includes('Nothing to redo')) break;
  }
  // Now a new add + no undo means redo should be empty
  await cmd('add', { text: 'No undo done' });
  const res = await cmd('_redo');
  assert(
    res.data?.error?.includes('Nothing to redo'),
    `Got "Nothing to redo" error: ${res.data?.error}`
  );
}

async function testNewMutationClearsFuture() {
  console.log('\n📋 Test: New mutation after undo clears redo future');

  // Start fresh: add, undo, add new
  await cmd('add', { text: 'Will be undone' });
  await cmd('_undo');

  // New mutation should clear redo future
  await cmd('add', { text: 'New after undo' });

  // Redo should fail (future was cleared)
  const redoRes = await cmd('_redo');
  assert(
    redoRes.data?.error?.includes('Nothing to redo'),
    `Redo fails after new mutation: ${redoRes.data?.error}`
  );
}

async function testMultipleUndos() {
  console.log('\n📋 Test: Multiple sequential undos');

  // Clear state by undoing everything
  let maxAttempts = 20;
  while (maxAttempts-- > 0) {
    const res = await cmd('_undo');
    if (res.data?.error) break;
  }

  // Add 3 items
  await cmd('add', { text: 'A' });
  await cmd('add', { text: 'B' });
  await cmd('add', { text: 'C' });

  let items = await getItems();
  assert(items.length === 3, `Start with 3 items`);

  // Undo all 3
  await cmd('_undo'); // remove C
  await cmd('_undo'); // remove B
  await cmd('_undo'); // remove A

  items = await getItems();
  assert(items.length === 0, `All undone, 0 items`);

  // Redo all 3
  await cmd('_redo'); // restore A
  await cmd('_redo'); // restore B
  await cmd('_redo'); // restore C

  items = await getItems();
  assert(items.length === 3, `All redone, back to 3 items`);
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
    await testUndoRevertsLastMutation();
    await testRedoRestoresUndone();
    await testEmptyUndoStack();
    await testEmptyRedoStack();
    await testNewMutationClearsFuture();
    await testMultipleUndos();
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
