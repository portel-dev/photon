import * as fs from 'fs';
import * as path from 'path';

export interface DaemonOwnerRecord {
  pid: number;
  socketPath: string;
  claimedAt: number;
}

export function getOwnerFilePath(socketPath: string): string {
  return path.join(path.dirname(socketPath), 'daemon.owner.json');
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readOwnerRecord(ownerFile: string): DaemonOwnerRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerFile, 'utf-8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.socketPath === 'string' &&
      typeof parsed.claimedAt === 'number'
    ) {
      return parsed as DaemonOwnerRecord;
    }
  } catch {
    // Missing or invalid owner record
  }
  return null;
}

export function writeOwnerRecord(ownerFile: string, record: DaemonOwnerRecord): void {
  fs.writeFileSync(ownerFile, JSON.stringify(record, null, 2));
}

export function removeOwnerRecord(ownerFile: string, pid?: number): boolean {
  const record = readOwnerRecord(ownerFile);
  if (record && pid !== undefined && record.pid !== pid) return false;

  try {
    fs.unlinkSync(ownerFile);
    return true;
  } catch {
    return false;
  }
}

export async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidAlive(pid);
}
