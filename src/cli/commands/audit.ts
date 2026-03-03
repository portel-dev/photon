/**
 * Audit CLI Command
 *
 * View and filter the persistent audit log at ~/.photon/audit.jsonl
 * Supports reading rotated archives for historical queries.
 */

import type { Command } from 'commander';
import { createReadStream, existsSync, statSync, watchFile } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createInterface } from 'readline';
import {
  AUDIT_FILE_PATH,
  AUDIT_DIR_PATH,
  MAX_ROTATED_FILES,
  MAX_FILE_SIZE,
  forceRotate,
  type AuditEntry,
} from '../../shared/audit.js';

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

function formatDashboard(entries: AuditEntry[]): string {
  if (entries.length === 0) return 'No audit entries to summarize.';

  const lines: string[] = [];
  const calls = entries.filter((e) => e.event === 'tool_call');
  const errors = entries.filter((e) => e.event === 'tool_error');
  const durations = calls.filter((e) => e.durationMs != null).map((e) => e.durationMs!);
  const avgMs =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxMs = durations.length > 0 ? Math.max(...durations) : 0;
  const p95Ms =
    durations.length > 0 ? durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)] : 0;

  // Time range
  const first = new Date(entries[0].ts);
  const last = new Date(entries[entries.length - 1].ts);

  lines.push('Audit Dashboard');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`  Period:      ${first.toLocaleString()} → ${last.toLocaleString()}`);
  lines.push(`  Total calls: ${calls.length}`);
  lines.push(
    `  Errors:      ${errors.length}${errors.length > 0 ? ` (${((errors.length / (calls.length + errors.length)) * 100).toFixed(1)}%)` : ''}`
  );
  lines.push('');

  if (durations.length > 0) {
    lines.push('Latency');
    lines.push('─'.repeat(30));
    lines.push(`  Avg:  ${avgMs}ms`);
    lines.push(`  P95:  ${p95Ms}ms`);
    lines.push(`  Max:  ${maxMs}ms`);
    lines.push('');
  }

  // Per-photon breakdown
  const byPhoton = new Map<
    string,
    { calls: number; errors: number; totalMs: number; count: number }
  >();
  for (const e of entries) {
    const name = e.photon || 'unknown';
    const stat = byPhoton.get(name) || { calls: 0, errors: 0, totalMs: 0, count: 0 };
    if (e.event === 'tool_call') {
      stat.calls++;
      if (e.durationMs != null) {
        stat.totalMs += e.durationMs;
        stat.count++;
      }
    } else if (e.event === 'tool_error') {
      stat.errors++;
    }
    byPhoton.set(name, stat);
  }

  if (byPhoton.size > 0) {
    lines.push('By Photon');
    lines.push('─'.repeat(50));
    const sorted = [...byPhoton.entries()].sort(
      (a, b) => b[1].calls + b[1].errors - (a[1].calls + a[1].errors)
    );
    for (const [name, stat] of sorted) {
      const avg = stat.count > 0 ? Math.round(stat.totalMs / stat.count) : 0;
      const errStr = stat.errors > 0 ? `, ${stat.errors} err` : '';
      const avgStr = stat.count > 0 ? `, avg ${avg}ms` : '';
      lines.push(`  ${name.padEnd(20)} ${stat.calls} calls${errStr}${avgStr}`);
    }
    lines.push('');
  }

  // Per-client breakdown
  const byClient = new Map<string, number>();
  for (const e of entries) {
    const client = e.client || 'unknown';
    byClient.set(client, (byClient.get(client) || 0) + 1);
  }

  if (byClient.size > 0) {
    lines.push('By Client');
    lines.push('─'.repeat(30));
    const sorted = [...byClient.entries()].sort((a, b) => b[1] - a[1]);
    for (const [client, count] of sorted) {
      lines.push(`  ${client.padEnd(12)} ${count}`);
    }
    lines.push('');
  }

  // Top methods by call count
  const byMethod = new Map<string, { calls: number; totalMs: number; count: number }>();
  for (const e of calls) {
    const key = `${e.photon || '?'}/${e.method || '?'}`;
    const stat = byMethod.get(key) || { calls: 0, totalMs: 0, count: 0 };
    stat.calls++;
    if (e.durationMs != null) {
      stat.totalMs += e.durationMs;
      stat.count++;
    }
    byMethod.set(key, stat);
  }

  if (byMethod.size > 0) {
    lines.push('Top Methods');
    lines.push('─'.repeat(50));
    const sorted = [...byMethod.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 10);
    for (const [method, stat] of sorted) {
      const avg = stat.count > 0 ? Math.round(stat.totalMs / stat.count) : 0;
      const avgStr = stat.count > 0 ? `, avg ${avg}ms` : '';
      lines.push(`  ${method.padEnd(30)} ${stat.calls} calls${avgStr}`);
    }
    lines.push('');
  }

  // Recent errors
  if (errors.length > 0) {
    lines.push('Recent Errors');
    lines.push('─'.repeat(50));
    const recentErrors = errors.slice(-5);
    for (const e of recentErrors) {
      const time = new Date(e.ts).toLocaleTimeString();
      lines.push(
        `  ${time}  ${e.photon || '-'}/${e.method || '-'}  ${(e.error || '').slice(0, 60)}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ══════════════════════════════════════════════════════════════════════════════
// READ LOG (with rotated archive support)
// ══════════════════════════════════════════════════════════════════════════════

async function readJSONLFile(path: string): Promise<AuditEntry[]> {
  if (!existsSync(path)) return [];

  const entries: AuditEntry[] = [];
  const rl = createInterface({
    input: createReadStream(path),
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

/**
 * Read audit entries, optionally including rotated archives.
 * Archives are read oldest-first so entries are in chronological order.
 */
async function readAuditLog(includeArchives = false): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];

  if (includeArchives) {
    // Read rotated files oldest-first: audit.3.jsonl → audit.2.jsonl → audit.1.jsonl
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const archivePath = join(AUDIT_DIR_PATH, `audit.${i}.jsonl`);
      entries.push(...(await readJSONLFile(archivePath)));
    }
  }

  // Current file is always read
  entries.push(...(await readJSONLFile(AUDIT_FILE_PATH)));
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

  watchFile(AUDIT_FILE_PATH, { interval: 500 }, () => {
    void (async () => {
      try {
        const content = await readFile(AUDIT_FILE_PATH, 'utf-8');
        const currentSize = Buffer.byteLength(content);
        if (currentSize <= fileSize) {
          // File was rotated (smaller now) — reset offset
          fileSize = 0;
          if (currentSize === 0) return;
        }

        // Read new content
        const newContent = Buffer.from(content).subarray(fileSize).toString();
        fileSize = currentSize;

        const lines = newContent.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const entry: AuditEntry = JSON.parse(line);
            if (matchesFilters(entry, filters)) {
              const time = new Date(entry.ts).toLocaleTimeString();
              const dur = entry.durationMs != null ? ` ${entry.durationMs}ms` : '';
              const err = entry.error ? ` ERROR: ${entry.error}` : '';
              console.log(
                `${time}  ${entry.event}  ${entry.photon || '-'}/${entry.method || '-'}  [${entry.client || '-'}]${dur}${err}`
              );
            }
          } catch {
            // Skip malformed
          }
        }
      } catch {
        // Ignore read errors
      }
    })();
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
    .option('--all', 'Include rotated archive files')
    .option('--json', 'Output raw JSONL')
    .option('--rotate', 'Force log rotation now')
    .option('--stats', 'Show audit log file statistics')
    .option('--dashboard', 'Show aggregate dashboard with latency, breakdown, and errors')
    .action(async (opts) => {
      // --rotate: force rotation
      if (opts.rotate) {
        const rotated = forceRotate();
        if (rotated) {
          console.log('Audit log rotated. Current log archived to audit.1.jsonl');
        } else {
          console.log('Nothing to rotate (no audit log file found).');
        }
        return;
      }

      // --stats: show file info
      if (opts.stats) {
        const files: { name: string; size: number; entries: number }[] = [];

        if (existsSync(AUDIT_FILE_PATH)) {
          const s = statSync(AUDIT_FILE_PATH);
          const entries = await readJSONLFile(AUDIT_FILE_PATH);
          files.push({ name: 'audit.jsonl (current)', size: s.size, entries: entries.length });
        }

        for (let i = 1; i <= MAX_ROTATED_FILES; i++) {
          const p = join(AUDIT_DIR_PATH, `audit.${i}.jsonl`);
          if (existsSync(p)) {
            const s = statSync(p);
            const entries = await readJSONLFile(p);
            files.push({ name: `audit.${i}.jsonl`, size: s.size, entries: entries.length });
          }
        }

        if (files.length === 0) {
          console.log('No audit log files found.');
          return;
        }

        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        const totalEntries = files.reduce((sum, f) => sum + f.entries, 0);

        console.log('Audit Log Files:');
        for (const f of files) {
          console.log(
            `  ${f.name.padEnd(28)} ${formatBytes(f.size).padStart(8)}  ${f.entries} entries`
          );
        }
        console.log(`  ${''.padEnd(28)} ${'-'.repeat(8)}  ${'─'.repeat(10)}`);
        console.log(
          `  ${'Total'.padEnd(28)} ${formatBytes(totalSize).padStart(8)}  ${totalEntries} entries`
        );
        console.log(
          `\nRotation: at ${formatBytes(MAX_FILE_SIZE)}, keeping ${MAX_ROTATED_FILES} archives`
        );
        return;
      }

      // --dashboard: aggregate view
      if (opts.dashboard) {
        const includeArchives = opts.all || !!opts.since;
        const entries = await readAuditLog(includeArchives);
        const sinceDate = opts.since ? parseSince(opts.since) : undefined;

        const filtered = entries.filter((e) =>
          matchesFilters(e, { photon: opts.photon, client: opts.client, since: sinceDate })
        );

        console.log(formatDashboard(filtered));
        return;
      }

      // --tail: live mode
      if (opts.tail) {
        await tailAuditLog({ photon: opts.photon, client: opts.client });
        return;
      }

      // Default: read and display
      const includeArchives = opts.all || !!opts.since;
      const entries = await readAuditLog(includeArchives);
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
