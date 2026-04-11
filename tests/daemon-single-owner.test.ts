import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { getOwnerFilePath, readOwnerRecord } from '../src/daemon/ownership.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-single-owner-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const ownerFile = getOwnerFilePath(socketPath);
const pidFile = path.join(tmpDir, 'daemon.pid');
const photonFile = path.join(tmpDir, 'telegram.photon.ts');
const eagerLog = path.join(tmpDir, 'eager.log');
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

const photonSource = `
export default class TelegramTest {
  async onInitialize() {
    const fs = await import('node:fs');
    fs.appendFileSync(${JSON.stringify(eagerLog)}, String(process.pid) + "\\n");
  }

  ping() {
    return { ok: true };
  }
}
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForLines(
  filePath: string,
  expected: number,
  timeoutMs = 10000
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length >= expected) return lines;
    }
    await wait(50);
  }

  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
}

async function waitForOwnerPid(expectedPid: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const owner = readOwnerRecord(ownerFile);
    if (owner?.pid === expectedPid) return;
    await wait(50);
  }

  const owner = readOwnerRecord(ownerFile);
  throw new Error(`Timed out waiting for owner PID ${expectedPid}; last owner=${owner?.pid}`);
}

async function waitForSocketReady(target: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) {
      const connected = await new Promise<boolean>((resolve) => {
        const client = net.createConnection(target);
        client.on('connect', () => {
          client.destroy();
          resolve(true);
        });
        client.on('error', () => resolve(false));
      });
      if (connected) return;
    }
    await wait(50);
  }
  throw new Error('Timed out waiting for daemon socket');
}

async function waitForExit(child: ChildProcess, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(child.pid)) return;
    await wait(50);
  }
  throw new Error(`Process ${child.pid} did not exit in time`);
}

function startDaemon(label: string): { child: ChildProcess; logs: string[] } {
  const logs: string[] = [];
  const child = spawn(process.execPath, [serverPath, socketPath], {
    cwd: tmpDir,
    env: { ...process.env, PHOTON_DIR: tmpDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  child.stderr?.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  child.on('exit', (code, signal) => {
    logs.push(`[${label}] exit code=${code} signal=${signal}`);
  });

  return { child, logs };
}

async function stopDaemon(child: ChildProcess | null): Promise<void> {
  if (!child) return;
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  try {
    await waitForExit(child, 5000);
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Ignore
    }
  }
}

(async () => {
  fs.writeFileSync(photonFile, photonSource);

  let first: ChildProcess | null = null;
  let second: ChildProcess | null = null;

  try {
    const firstRun = startDaemon('first');
    first = firstRun.child;
    await waitForSocketReady(socketPath);
    await wait(1500);

    const firstOwner = readOwnerRecord(ownerFile);
    assert.equal(firstOwner?.pid, first.pid, 'first daemon should claim ownership');

    const secondRun = startDaemon('second');
    second = secondRun.child;
    await waitForOwnerPid(second.pid!, 10000);
    await waitForSocketReady(socketPath);
    await waitForExit(first, 10000);
    const eagerEntries = await waitForLines(eagerLog, 1, 10000);

    const secondOwner = readOwnerRecord(ownerFile);
    assert.equal(secondOwner?.pid, second.pid, 'second daemon should replace owner record');
    assert.equal(fs.readFileSync(pidFile, 'utf-8').trim(), String(second.pid));
    assert.equal(
      eagerEntries[0],
      String(first.pid),
      'first daemon should eager-load after claiming'
    );
    assert(
      secondRun.logs.some((line) => line.includes('Sibling daemon detected for socket')),
      'second daemon should log sibling detection'
    );
    assert(
      secondRun.logs.some((line) => line.includes('Daemon ownership claimed')),
      'second daemon should log ownership claim'
    );
    assert(
      !secondRun.logs.some((line) =>
        line.includes('Skipping eager lifecycle load before exclusive ownership confirmation')
      ),
      'second daemon should not attempt eager-load before ownership confirmation'
    );

    console.log('✅ daemon single-owner regression test passed');
  } finally {
    await stopDaemon(second);
    await stopDaemon(first);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
