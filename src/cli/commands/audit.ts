/**
 * Audit CLI Command
 *
 * View and filter the persistent audit log at ~/.photon/audit.jsonl
 */

import type { Command } from 'commander';
import { createReadStream, existsSync, watchFile, unwatchFile } from 'fs';
import { readFile } from 'fs/promises';
import { createInterface } from 'readline';
import { AUDIT_FILE_PATH, type AuditEntry } from '../../shared/audit.js';

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid --since format: "${since}". Use e.g. 30m, 2h, 1d`);
  }
  const [, num, unit] = match;
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return new Date(Date.now() - parseInt(num) * ms);
}

function matchesFilters(
  entry: AuditEntry,
  filters: { photon?: string; client?: string; since?: Date }
): boolean {
  if (filters.photon && entry.photon !== filters.photon) return false;
  if (filters.client && entry.client !== filters.client) return false;
  if (filters.since && new Date(entry.ts) < filters.since) return false;
  return true;
}

function formatTable(entries: AuditEntry[]): string {
  if (entries.length === 0) return 'No audit entries found.';

  const rows = entries.map((e) => ({
    time: new Date(e.ts).toLocaleTimeString(),
    event: e.event,
    photon: e.photon || '-',
    method: e.method || '-',
    instance: e.instance || '-',
    client: e.client || '-',
    duration: e.durationMs != null ? `${e.durationMs}ms` : '-',
    error: e.error ? e.error.slice(0, 40) : '',
  }));

  // Column widths
  const cols = {
    time: Math.max(4, ...rows.map((r) => r.time.length)),
    event: Math.max(5, ...rows.map((r) => r.event.length)),
    photon: Math.max(6, ...rows.map((r) => r.photon.length)),
    method: Math.max(6, ...rows.map((r) => r.method.length)),
    instance: Math.max(8, ...rows.map((r) => r.instance.length)),
    client: Math.max(6, ...rows.map((r) => r.client.length)),
    duration: Math.max(8, ...rows.map((r) => r.duration.length)),
  };

  const pad = (s: string, w: number) => s.padEnd(w);
  const header = [
    pad('TIME', cols.time),
    pad('EVENT', cols.event),
    pad('PHOTON', cols.photon),
    pad('METHOD', cols.method),
    pad('INSTANCE', cols.instance),
    pad('CLIENT', cols.client),
    pad('DURATION', cols.duration),
    'ERROR',
  ].join('  ');

  const sep = '-'.repeat(header.length);

  const lines = rows.map((r) =>
    [
      pad(r.time, cols.time),
      pad(r.event, cols.event),
      pad(r.photon, cols.photon),
      pad(r.method, cols.method),
      pad(r.instance, cols.instance),
      pad(r.client, cols.client),
      pad(r.duration, cols.duration),
      r.error,
    ].join('  ')
  );

  return [header, sep, ...lines].join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// READ LOG
// ══════════════════════════════════════════════════════════════════════════════

async function readAuditLog(): Promise<AuditEntry[]> {
  if (!existsSync(AUDIT_FILE_PATH)) return [];

  const entries: AuditEntry[] = [];
  const rl = createInterface({
    input: createReadStream(AUDIT_FILE_PATH),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAIL MODE
// ══════════════════════════════════════════════════════════════════════════════

async function tailAuditLog(filters: { photon?: string; client?: string }): Promise<void> {
  console.log(`Tailing ${AUDIT_FILE_PATH} (Ctrl+C to stop)\n`);

  let fileSize = 0;
  try {
    const content = await readFile(AUDIT_FILE_PATH, 'utf-8');
    fileSize = Buffer.byteLength(content);
  } catch {
    // File may not exist yet
  }

  watchFile(AUDIT_FILE_PATH, { interval: 500 }, async () => {
    try {
      const content = await readFile(AUDIT_FILE_PATH, 'utf-8');
      const currentSize = Buffer.byteLength(content);
      if (currentSize <= fileSize) return;

      // Read new content
      const newContent = Buffer.from(content).subarray(fileSize).toString();
      fileSize = currentSize;

      const lines = newContent.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry: AuditEntry = JSON.parse(line);
          if (matchesFilters(entry, filters)) {
            if (filters.photon || filters.client) {
              console.log(JSON.stringify(entry));
            } else {
              const time = new Date(entry.ts).toLocaleTimeString();
              const dur = entry.durationMs != null ? ` ${entry.durationMs}ms` : '';
              const err = entry.error ? ` ERROR: ${entry.error}` : '';
              console.log(
                `${time}  ${entry.event}  ${entry.photon || '-'}/${entry.method || '-'}  [${entry.client || '-'}]${dur}${err}`
              );
            }
          }
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Ignore read errors
    }
  });

  // Keep process alive
  await new Promise(() => {});
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('View the persistent tool execution audit log')
    .option('-n, --lines <count>', 'Number of entries to show', '20')
    .option('--tail', 'Live tail the audit log')
    .option('--photon <name>', 'Filter by photon name')
    .option('--client <type>', 'Filter by client type (cli, beam, mcp, stdio)')
    .option('--since <duration>', 'Show entries from last N (e.g. 30m, 2h, 1d)')
    .option('--json', 'Output raw JSONL')
    .action(async (opts) => {
      if (opts.tail) {
        await tailAuditLog({ photon: opts.photon, client: opts.client });
        return;
      }

      const entries = await readAuditLog();
      const sinceDate = opts.since ? parseSince(opts.since) : undefined;

      const filtered = entries.filter((e) =>
        matchesFilters(e, { photon: opts.photon, client: opts.client, since: sinceDate })
      );

      const count = parseInt(opts.lines);
      const last = filtered.slice(-count);

      if (opts.json) {
        for (const entry of last) {
          console.log(JSON.stringify(entry));
        }
      } else {
        console.log(formatTable(last));
      }
    });
}
