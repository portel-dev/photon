/**
 * Persistent Audit Log
 *
 * Append-only JSONL writer to ~/.photon/audit.jsonl
 * Silent failure — never blocks execution for audit I/O
 * Size-based rotation: rotates at 5MB, keeps 3 archived files
 */

import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { getAuditPath } from '@portel/photon-core';

const AUDIT_FILE = getAuditPath();
const AUDIT_DIR = dirname(AUDIT_FILE);

/** Rotate when file exceeds this size (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;
/** Number of rotated archives to keep */
const MAX_ROTATED_FILES = 3;
/** Check file size every N writes to avoid stat() on every append */
const ROTATION_CHECK_INTERVAL = 100;

export interface AuditEntry {
  ts: string;
  event: string;
  photon?: string;
  method?: string;
  instance?: string;
  client?: string;
  sessionId?: string;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

let dirEnsured = false;
let writeCount = 0;

/**
 * Rotate audit log files: audit.jsonl → audit.1.jsonl → audit.2.jsonl → audit.3.jsonl
 * Oldest file beyond MAX_ROTATED_FILES is deleted.
 */
function rotateIfNeeded(): void {
  try {
    const stats = statSync(AUDIT_FILE);
    if (stats.size < MAX_FILE_SIZE) return;

    // Shift existing rotated files: .3 → delete, .2 → .3, .1 → .2
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const src = i === 1 ? AUDIT_FILE : join(AUDIT_DIR, `audit.${i - 1}.jsonl`);
      const dst = join(AUDIT_DIR, `audit.${i}.jsonl`);
      if (i === MAX_ROTATED_FILES && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
    // AUDIT_FILE has been renamed to audit.1.jsonl — next append creates a fresh file
  } catch {
    // Silent failure — rotation is best-effort
  }
}

export function audit(entry: AuditEntry): void {
  try {
    if (!dirEnsured) {
      mkdirSync(AUDIT_DIR, { recursive: true });
      dirEnsured = true;
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');

    writeCount++;
    if (writeCount >= ROTATION_CHECK_INTERVAL) {
      writeCount = 0;
      rotateIfNeeded();
    }
  } catch {
    // Never block execution for audit failures
  }
}

/** Force a rotation check (used by CLI clear/rotate commands) */
export function forceRotate(): boolean {
  try {
    if (!existsSync(AUDIT_FILE)) return false;
    // Shift existing rotated files
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const src = i === 1 ? AUDIT_FILE : join(AUDIT_DIR, `audit.${i - 1}.jsonl`);
      const dst = join(AUDIT_DIR, `audit.${i}.jsonl`);
      if (i === MAX_ROTATED_FILES && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const AUDIT_FILE_PATH = AUDIT_FILE;
export const AUDIT_DIR_PATH = AUDIT_DIR;
export { MAX_FILE_SIZE, MAX_ROTATED_FILES };
