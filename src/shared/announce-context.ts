/**
 * CLI context transparency helper.
 *
 * Agent-first output: default is minimal (just the command result), so
 * tool-calling agents don't see a wall of prose. When the user passes
 * `-v` / `--verbose` (or sets `PHOTON_VERBOSE=1`), commands emit `→`
 * prefixed context lines showing PHOTON_DIR, the resolved photon, and
 * the target path. When the user passes `--json`, the command includes
 * a structured `context` envelope in its output.
 *
 * Rule of thumb for adopters: any command whose behavior depends on
 * which PHOTON_DIR is resolved should call `announceContext()` once at
 * entry so a user running `-v` can audit the decision. Commands that
 * already support `--json` should merge `contextEnvelope()` into their
 * response envelope.
 *
 * See docs/internals/PHOTON-DIR-AND-NAMESPACE.md and the codebase audit
 * (§10) for the full list of PHOTON_DIR-sensitive commands and the
 * migration status.
 */

import { getDefaultContext } from '../context.js';

export interface AnnounceOptions {
  /** Photon this operation targets, if applicable. */
  photon?: string;
  /** Verb for the primary action, e.g. "Creating", "Loading". */
  action?: string;
  /** Absolute path being acted on (created, loaded, written, etc.). */
  target?: string;
  /** Short hint line shown after the context. */
  hint?: string;
  /** Override verbosity detection (defaults to scanning argv / env). */
  verbose?: boolean;
}

export interface ContextEnvelope {
  /** Resolved PHOTON_DIR for this invocation. */
  photonDir: string;
  /** Data root for this invocation ({PHOTON_DIR}/.data/). */
  dataDir: string;
  photon?: string;
  action?: string;
  target?: string;
}

function argvHas(flag: string, short?: string): boolean {
  return process.argv.includes(flag) || (short !== undefined && process.argv.includes(short));
}

/** True when the caller opted into transparency via argv or env. */
export function isVerbose(): boolean {
  if (argvHas('--quiet', '-q')) return false;
  if (process.env.PHOTON_VERBOSE === '1') return true;
  if (argvHas('--verbose', '-v')) return true;
  return false;
}

/** Build the structured context envelope for `--json` mode. */
export function contextEnvelope(opts: AnnounceOptions = {}): ContextEnvelope {
  const ctx = getDefaultContext();
  const env: ContextEnvelope = {
    photonDir: ctx.baseDir,
    dataDir: ctx.dataDir,
  };
  if (opts.photon !== undefined) env.photon = opts.photon;
  if (opts.action !== undefined) env.action = opts.action;
  if (opts.target !== undefined) env.target = opts.target;
  return env;
}

/**
 * Print transparency lines to stderr when verbose is enabled. No-op
 * otherwise so default output stays clean for agents and scripts.
 */
export function announceContext(opts: AnnounceOptions = {}): void {
  const verbose = opts.verbose ?? isVerbose();
  if (!verbose) return;
  const ctx = getDefaultContext();
  const lines: string[] = [];
  lines.push(`→ PHOTON_DIR: ${ctx.baseDir}`);
  if (opts.photon) lines.push(`→ Photon:     ${opts.photon}`);
  if (opts.action && opts.target) {
    lines.push(`→ ${opts.action}: ${opts.target}`);
  } else if (opts.target) {
    lines.push(`→ Target:     ${opts.target}`);
  }
  if (opts.hint) lines.push(`  ${opts.hint}`);
  process.stderr.write(lines.join('\n') + '\n');
}
