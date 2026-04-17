/**
 * `photon ps` — list and control everything the daemon is running.
 *
 * The observability surface for the two-step scheduling model:
 *   - ACTIVE: cron timers currently registered
 *   - DECLARED: @scheduled tags discovered in registered bases but not
 *     enrolled in their base's active-schedules file
 *   - WEBHOOKS: HTTP routes the daemon is serving (auto-registered from
 *     @webhook tags)
 *   - SESSIONS: photons currently loaded in memory
 *
 * Subcommands: enable / disable / pause / resume take `<photon>:<method>`.
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';

async function ensureDaemonRunning(): Promise<void> {
  const { isGlobalDaemonReachable, ensureDaemon } = await import('../../daemon/manager.js');
  if (await isGlobalDaemonReachable()) return;
  await ensureDaemon(false);
}

function parseTarget(target: string): { photon: string; method: string } {
  const idx = target.indexOf(':');
  if (idx <= 0 || idx === target.length - 1) {
    throw new Error(`Expected <photon>:<method>, got "${target}"`);
  }
  return { photon: target.slice(0, idx), method: target.slice(idx + 1) };
}

function fmtWhen(ts: number | null | undefined): string {
  if (!ts) return '-';
  const delta = ts - Date.now();
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  const hrs = Math.round(mins / 60);
  if (abs < 60_000) return delta < 0 ? 'just now' : 'in <1m';
  if (mins < 90) return delta < 0 ? `${mins}m ago` : `in ${mins}m`;
  if (hrs < 48) return delta < 0 ? `${hrs}h ago` : `in ${hrs}h`;
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
}

function tilde(p: string | undefined): string {
  if (!p) return '-';
  const home = process.env.HOME || '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function renderTable(header: string[], rows: string[][]): string {
  if (rows.length === 0) return '  (none)\n';
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (s: string, w: number) => s + ' '.repeat(w - s.length);
  const lines: string[] = [];
  lines.push('  ' + header.map((h, i) => pad(h, widths[i])).join('  '));
  lines.push('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) {
    lines.push('  ' + r.map((c, i) => pad(c ?? '', widths[i])).join('  '));
  }
  return lines.join('\n') + '\n';
}

export function registerPsCommands(program: Command): void {
  const ps = program
    .command('ps')
    .description('List scheduled jobs, webhook routes, and active sessions the daemon is serving')
    .option('--json', 'Output structured JSON')
    .option('--base <dir>', 'Filter to one PHOTON_DIR')
    .option('--type <kind>', 'Show only "active" | "declared" | "webhooks" | "sessions"')
    .action(async (opts: { json?: boolean; base?: string; type?: string }) => {
      try {
        await ensureDaemonRunning();
        const { fetchPsSnapshot } = await import('../../daemon/client.js');
        const snap = await fetchPsSnapshot();

        // Filters
        const baseFilter = opts.base ? opts.base : undefined;
        const typeFilter = opts.type?.toLowerCase();
        const inBase = (workingDir?: string) => !baseFilter || workingDir === baseFilter;
        const active = snap.active.filter((a) => inBase(a.workingDir));
        const declared = snap.declared.filter((d) => inBase(d.workingDir));
        const webhooks = snap.webhooks.filter((w) => inBase(w.workingDir));
        const sessions = snap.sessions.filter((s) => inBase(s.workingDir));
        const filtered = { active, declared, webhooks, sessions };

        if (opts.json) {
          process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
          return;
        }

        const wantAll = !typeFilter;
        const show = {
          active: wantAll || typeFilter === 'active',
          declared: wantAll || typeFilter === 'declared',
          webhooks: wantAll || typeFilter === 'webhooks',
          sessions: wantAll || typeFilter === 'sessions',
        };

        if (show.active) {
          process.stdout.write(`\nACTIVE SCHEDULES (${active.length})\n`);
          process.stdout.write(
            renderTable(
              ['PHOTON_DIR', 'PHOTON', 'METHOD', 'CRON', 'NEXT RUN', 'LAST RUN', 'RUNS'],
              active.map((a) => [
                tilde(a.workingDir),
                a.photon,
                a.method,
                a.cron,
                fmtWhen(a.nextRun),
                fmtWhen(a.lastRun),
                String(a.runCount),
              ])
            )
          );
        }
        if (show.declared) {
          const dormant = declared.filter((d) => !d.active);
          process.stdout.write(`\nDECLARED (not enrolled) (${dormant.length})\n`);
          process.stdout.write(
            renderTable(
              ['PHOTON_DIR', 'PHOTON', 'METHOD', 'CRON', 'HINT'],
              dormant.map((d) => [
                tilde(d.workingDir),
                d.photon,
                d.method,
                d.cron,
                `photon ps enable ${d.photon}:${d.method}`,
              ])
            )
          );
        }
        if (show.webhooks) {
          process.stdout.write(`\nWEBHOOKS (${webhooks.length})\n`);
          process.stdout.write(
            renderTable(
              ['PHOTON_DIR', 'PHOTON', 'ROUTE', 'METHOD'],
              webhooks.map((w) => [tilde(w.workingDir), w.photon, w.route, w.method])
            )
          );
        }
        if (show.sessions) {
          process.stdout.write(`\nACTIVE SESSIONS (${sessions.length})\n`);
          process.stdout.write(
            renderTable(
              ['PHOTON_DIR', 'PHOTON', 'INSTANCES'],
              sessions.map((s) => [tilde(s.workingDir), s.photon, String(s.instanceCount)])
            )
          );
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`photon ps failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  ps.command('enable')
    .argument('<target>', 'Enroll a declared schedule: <photon>:<method>')
    .description('Activate a declared @scheduled method so its cron fires')
    .action(async (target: string) => {
      try {
        await ensureDaemonRunning();
        const { photon, method } = parseTarget(target);
        const { enableSchedule } = await import('../../daemon/client.js');
        const result = (await enableSchedule(photon, method)) as {
          photon: string;
          method: string;
          base: string;
          cron: string;
        };
        const { printSuccess } = await import('../../cli-formatter.js');
        printSuccess(
          `Enabled ${result.photon}:${result.method} (${result.cron}) under ${tilde(result.base)}`
        );
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`photon ps enable failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  ps.command('disable')
    .argument('<target>', 'Remove an active schedule: <photon>:<method>')
    .description('Drop a schedule from the active list and cancel its timer')
    .action(async (target: string) => {
      try {
        await ensureDaemonRunning();
        const { photon, method } = parseTarget(target);
        const { disableSchedule } = await import('../../daemon/client.js');
        await disableSchedule(photon, method);
        const { printSuccess } = await import('../../cli-formatter.js');
        printSuccess(`Disabled ${photon}:${method}`);
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`photon ps disable failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  ps.command('pause')
    .argument('<target>', '<photon>:<method>')
    .description('Keep the enrollment record but stop firing until resumed')
    .action(async (target: string) => {
      try {
        await ensureDaemonRunning();
        const { photon, method } = parseTarget(target);
        const { pauseSchedule } = await import('../../daemon/client.js');
        await pauseSchedule(photon, method);
        const { printSuccess } = await import('../../cli-formatter.js');
        printSuccess(`Paused ${photon}:${method}`);
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`photon ps pause failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  ps.command('resume')
    .argument('<target>', '<photon>:<method>')
    .description('Re-enable a paused schedule')
    .action(async (target: string) => {
      try {
        await ensureDaemonRunning();
        const { photon, method } = parseTarget(target);
        const { resumeSchedule } = await import('../../daemon/client.js');
        await resumeSchedule(photon, method);
        const { printSuccess } = await import('../../cli-formatter.js');
        printSuccess(`Resumed ${photon}:${method}`);
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`photon ps resume failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  ps.command('history')
    .argument('<target>', '<photon>:<method>')
    .option('--limit <n>', 'Show at most N most-recent entries', '20')
    .option('--since <iso>', 'Only entries at or after this ISO timestamp')
    .option('--json', 'Output structured JSON')
    .description('Show recent firings of a scheduled method')
    .action(
      async (
        target: string,
        opts: { limit?: string; since?: string; json?: boolean },
        cmd: Command
      ) => {
        try {
          await ensureDaemonRunning();
          const { photon, method } = parseTarget(target);
          const { fetchExecutionHistory } = await import('../../daemon/client.js');
          const limit = opts.limit ? Math.max(1, parseInt(opts.limit, 10) || 20) : 20;
          const sinceTs = opts.since ? Date.parse(opts.since) : undefined;
          if (opts.since && (!sinceTs || Number.isNaN(sinceTs))) {
            throw new Error(`Invalid --since value "${opts.since}" (expected ISO 8601)`);
          }
          const resp = await fetchExecutionHistory(photon, method, { limit, sinceTs });

          // Parent `ps` also defines --json; commander resolves the flag on
          // whichever command matches first, so check both.
          const parentOpts: Record<string, unknown> = cmd.parent?.opts() ?? {};
          const wantJson = Boolean(opts.json || parentOpts.json);
          if (wantJson) {
            process.stdout.write(JSON.stringify(resp, null, 2) + '\n');
            return;
          }

          process.stdout.write(
            `\nHISTORY for ${resp.photon}:${resp.method} (${resp.entries.length})\n`
          );
          if (resp.entries.length === 0) {
            process.stdout.write('  (no firings recorded)\n');
            return;
          }
          process.stdout.write(
            renderTable(
              ['WHEN', 'STATUS', 'DURATION', 'DETAIL'],
              resp.entries.map((e) => [
                fmtWhen(e.ts),
                e.status.toUpperCase(),
                `${e.durationMs}ms`,
                e.status === 'success'
                  ? (e.outputPreview ?? '').slice(0, 80)
                  : (e.errorMessage ?? '').slice(0, 80),
              ])
            )
          );
        } catch (error) {
          const { printError } = await import('../../cli-formatter.js');
          printError(`photon ps history failed: ${getErrorMessage(error)}`);
          process.exit(1);
        }
      }
    );
}
