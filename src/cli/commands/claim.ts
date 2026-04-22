/**
 * Claim-code CLI commands.
 *
 *   photon claim                     # create a claim for the current dir
 *   photon claim --scope /path       # create for a specific dir
 *   photon claim --ttl 1h            # custom expiry (default 24h)
 *   photon claim --label "phone"     # human-readable note
 *   photon claim list                # show active claims
 *   photon claim revoke <code>       # remove a claim
 *
 * See `src/daemon/claims.ts` for the store and the feature write-up.
 */

import type { Command } from 'commander';
import * as path from 'path';

import { getErrorMessage } from '../../shared/error-handler.js';
import { getDefaultContext } from '../../context.js';
import {
  createClaim,
  formatCode,
  listClaims,
  revokeClaim,
  DEFAULT_TTL_MS,
  type ClaimRecord,
} from '../../daemon/claims.js';

/** Parse `--ttl` values like `15m`, `2h`, `7d`, or raw seconds into ms. */
function parseTtl(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d)?$/.exec(raw.trim().toLowerCase());
  if (!m) {
    throw new Error(`Invalid --ttl value: "${raw}". Expected e.g. 30m, 2h, 7d.`);
  }
  const n = parseFloat(m[1]);
  const unit = m[2] ?? 's';
  const factor: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Math.round(n * factor[unit]);
}

function humanRemaining(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function registerClaimCommands(program: Command): void {
  const claim = program
    .command('claim')
    .description('Scope a remote MCP session to a subset of photons via a short-lived claim code')
    .option('--scope <dir>', 'Directory prefix the claim grants access to (default: cwd)')
    .option('--ttl <duration>', 'Lifetime of the code (e.g. 30m, 2h, 7d). Default: 24h')
    .option('--label <text>', 'Human-readable note shown in `photon claim list`')
    .action(async (options: { scope?: string; ttl?: string; label?: string }) => {
      try {
        const { printInfo, printSuccess } = await import('../../cli-formatter.js');
        const workingDir = getDefaultContext().baseDir;
        const scopeDir = path.resolve(options.scope || process.cwd());
        const ttlMs = options.ttl ? parseTtl(options.ttl) : DEFAULT_TTL_MS;

        const rec = await createClaim({ scopeDir, ttlMs, label: options.label }, workingDir);
        printSuccess(`Claim code: ${formatCode(rec.code)}`);
        printInfo(`  Scope:      ${rec.scopeDir}`);
        printInfo(`  Expires in: ${humanRemaining(rec.expiresAt)}`);
        if (rec.label) printInfo(`  Label:      ${rec.label}`);
        printInfo('');
        printInfo('To use this code, set the Mcp-Claim-Code header on your');
        printInfo('MCP client connection (Streamable HTTP transports such as Beam):');
        printInfo(`  Mcp-Claim-Code: ${rec.code}`);
      } catch (err) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(err));
        process.exit(1);
      }
    });

  claim
    .command('list')
    .description('List active (non-expired) claim codes')
    .action(async () => {
      try {
        const { printInfo, printHeader } = await import('../../cli-formatter.js');
        const workingDir = getDefaultContext().baseDir;
        const claims = await listClaims(workingDir);
        if (claims.length === 0) {
          printInfo('No active claims.');
          return;
        }
        printHeader('Active claims');
        for (const c of claims) {
          const parts = [
            formatCode(c.code),
            `→ ${c.scopeDir}`,
            `expires ${humanRemaining(c.expiresAt)}`,
          ];
          if (c.label) parts.push(`"${c.label}"`);
          printInfo('  ' + parts.join('  '));
        }
      } catch (err) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(err));
        process.exit(1);
      }
    });

  claim
    .command('revoke')
    .argument('<code>', 'Claim code to revoke (with or without dashes)')
    .description('Remove a claim code so any session using it loses access immediately')
    .action(async (code: string) => {
      try {
        const { printSuccess, printInfo } = await import('../../cli-formatter.js');
        const workingDir = getDefaultContext().baseDir;
        const ok = await revokeClaim(code, workingDir);
        if (ok) {
          printSuccess(`Revoked ${formatCode(code)}`);
        } else {
          printInfo(`No claim matches ${formatCode(code)} — it may already be expired or revoked.`);
        }
      } catch (err) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(err));
        process.exit(1);
      }
    });
}

// Re-export for tests that want to exercise the command wiring.
export type { ClaimRecord };
