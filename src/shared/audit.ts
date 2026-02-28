/**
 * Persistent Audit Log
 *
 * Append-only JSONL writer to ~/.photon/audit.jsonl
 * Silent failure — never blocks execution for audit I/O
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AUDIT_DIR = join(homedir(), '.photon');
const AUDIT_FILE = join(AUDIT_DIR, 'audit.jsonl');

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

export function audit(entry: AuditEntry): void {
  try {
    if (!dirEnsured) {
      mkdirSync(AUDIT_DIR, { recursive: true });
      dirEnsured = true;
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch {
    // Never block execution for audit failures
  }
}

export const AUDIT_FILE_PATH = AUDIT_FILE;
