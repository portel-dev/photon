/**
 * Claim-code store — scoped remote access for Photon MCP sessions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * What problem this solves
 * ──────────────────────────────────────────────────────────────────────────
 * By default a Photon daemon exposes every installed photon to every
 * connected MCP client. That is fine on a developer's own machine, but
 * breaks down the moment you want to give a *remote* agent access to a
 * subset of photons — say, pairing a phone-side Claude Code session with
 * Beam running on your laptop but only letting that session see photons
 * under a single project directory.
 *
 * A "claim code" is a short opaque token the owner generates locally
 * (`photon claim`), prints, and gives to the remote agent. The agent
 * includes the code in the initialize handshake of its MCP connection
 * (`Mcp-Claim-Code` header on Streamable HTTP) and from that point on
 * the server's `tools/list` is filtered to the photons that live under
 * the claim's `scopeDir`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Design
 * ──────────────────────────────────────────────────────────────────────────
 * - Codes are **6 chars, base32 (Crockford) without lookalikes** → looks
 *   like `R3K9QZ`. Formatted for display as `R3K-9QZ` but stored raw.
 * - Codes are **disk-persisted** under `{baseDir}/.data/claims.json` so
 *   daemon restarts don't invalidate them.
 * - Codes carry a **ttl** (default 24h). Expired codes are garbage-
 *   collected on every read — lazy cleanup, no background timer.
 * - Scope is a **directory prefix**. Photons whose source file resolves
 *   under this dir are visible; everything else is filtered out.
 * - Validation is a pure function of the on-disk file, so Beam (in a
 *   separate process from the daemon) can validate without IPC.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * What this module is NOT
 * ──────────────────────────────────────────────────────────────────────────
 * - Not an authentication system. Claim codes are bearer tokens; anyone
 *   holding a valid code gets the scoped access. Treat them like API
 *   keys: short ttls, revoke when done.
 * - Not a per-tool authorization layer. Scope is directory-based; a
 *   claim grants access to *all* photons under that directory or none.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

import { getDataRoot } from '@portel/photon-core';

// ──────────────────────────────────────────────────────────────────────────

/**
 * Base32-like alphabet with confusing characters (0/O, 1/I/L) removed.
 * 30 symbols; a 6-char code gives 30^6 ≈ 7.3×10^8 possibilities, enough
 * for short-lived local codes without needing 128-bit entropy.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXY';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Resolve symlinks so a symlinked photon can't escape its claim
 * scope (a lexical compare would follow the link's parent, not its
 * target). Falls back to lexical resolve when the path doesn't
 * exist yet.
 */
function canonicalizePath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export interface ClaimRecord {
  /** 6-char code, uppercase, no dashes when stored */
  code: string;
  /** Absolute path — only photons whose source resolves under this are visible */
  scopeDir: string;
  /** ISO timestamp */
  createdAt: string;
  /** Unix ms — compared against Date.now() */
  expiresAt: number;
  /** Optional human-readable label, shown in `photon claim list` */
  label?: string;
}

export interface CreateClaimParams {
  scopeDir: string;
  ttlMs?: number;
  label?: string;
}

export interface ValidationResult {
  ok: true;
  claim: ClaimRecord;
}

export interface ValidationFailure {
  ok: false;
  reason: 'unknown' | 'expired' | 'malformed';
}

/** Path to the claims file, derived from the active base dir. */
export function getClaimsFilePath(baseDir?: string): string {
  return path.join(getDataRoot(baseDir), 'claims.json');
}

/** Generate a new 6-char code using the restricted alphabet. */
export function generateCode(): string {
  // crypto.randomInt gives uniform distribution over [0, max) — no modulo bias.
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/** Format a code for display: `ABC-123`. */
export function formatCode(code: string): string {
  const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (clean.length !== 6) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

/** Normalize a user-entered code: strip dashes/whitespace, uppercase. */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

// ──────────────────────────────────────────────────────────────────────────
// DISK I/O
// ──────────────────────────────────────────────────────────────────────────

async function readAll(baseDir?: string): Promise<ClaimRecord[]> {
  const file = getClaimsFilePath(baseDir);
  try {
    const raw = await fsPromises.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        typeof r.code === 'string' &&
        typeof r.scopeDir === 'string' &&
        typeof r.expiresAt === 'number'
    ) as ClaimRecord[];
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

function readAllSync(baseDir?: string): ClaimRecord[] {
  const file = getClaimsFilePath(baseDir);
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        typeof r.code === 'string' &&
        typeof r.scopeDir === 'string' &&
        typeof r.expiresAt === 'number'
    ) as ClaimRecord[];
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(records: ClaimRecord[], baseDir?: string): Promise<void> {
  const file = getClaimsFilePath(baseDir);
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsPromises.writeFile(tmp, JSON.stringify(records, null, 2));
  await fsPromises.rename(tmp, file);
}

function purgeExpired(records: ClaimRecord[]): ClaimRecord[] {
  const now = Date.now();
  return records.filter((r) => r.expiresAt > now);
}

// ──────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────────────────

/** Create and persist a new claim. Returns the stored record. */
export async function createClaim(
  params: CreateClaimParams,
  baseDir?: string
): Promise<ClaimRecord> {
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
  if (!params.scopeDir || !path.isAbsolute(params.scopeDir)) {
    throw new Error(`createClaim: scopeDir must be an absolute path, got ${params.scopeDir}`);
  }
  if (ttlMs < 60_000) {
    throw new Error('createClaim: ttlMs must be at least 60,000 (1 minute)');
  }
  const all = purgeExpired(await readAll(baseDir));
  // Tolerate a collision with an existing code by regenerating — 30^6
  // collision is a ~10^-8 event per creation, but still bounded.
  let code = generateCode();
  while (all.some((r) => r.code === code)) {
    code = generateCode();
  }
  const record: ClaimRecord = {
    code,
    scopeDir: canonicalizePath(params.scopeDir),
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
    label: params.label,
  };
  all.push(record);
  await writeAll(all, baseDir);
  return record;
}

/**
 * List all non-expired claims. Writes the purged list back if anything
 * was removed, so `photon claim list` also acts as a passive GC step.
 */
export async function listClaims(baseDir?: string): Promise<ClaimRecord[]> {
  const raw = await readAll(baseDir);
  const fresh = purgeExpired(raw);
  if (fresh.length !== raw.length) {
    await writeAll(fresh, baseDir);
  }
  return fresh;
}

/** Remove a claim by code. Returns true if something was deleted. */
export async function revokeClaim(rawCode: string, baseDir?: string): Promise<boolean> {
  const code = normalizeCode(rawCode);
  const all = await readAll(baseDir);
  const before = all.length;
  const next = all.filter((r) => r.code !== code);
  if (next.length === before) return false;
  await writeAll(next, baseDir);
  return true;
}

/**
 * Validate a code. Returns the record on success or a structured failure.
 * Synchronous so transport-layer code (HTTP init handler) can call it
 * without turning every request into a promise chain.
 */
export function validateClaimSync(
  rawCode: string,
  baseDir?: string
): ValidationResult | ValidationFailure {
  if (!rawCode || typeof rawCode !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const code = normalizeCode(rawCode);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return { ok: false, reason: 'malformed' };
  }
  const all = readAllSync(baseDir);
  const match = all.find((r) => r.code === code);
  if (!match) return { ok: false, reason: 'unknown' };
  if (match.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, claim: match };
}

/**
 * Does this photon source path fall under the claim's scopeDir?
 * Returns true if no claim is provided (unclaimed sessions have full access).
 */
export function isPhotonInScope(
  photonSourcePath: string | undefined,
  claim: ClaimRecord | undefined
): boolean {
  return isPathInScope(photonSourcePath, claim?.scopeDir);
}

/**
 * Lower-level helper that takes a bare scopeDir rather than a full
 * claim record — the transport layer only carries the dir on the
 * session, and loading the full record on every `tools/list` call
 * would be needless I/O.
 *
 * Returns true when `scopeDir` is unset (unclaimed sessions get full
 * access — the default, backward-compatible behavior).
 */
export function isPathInScope(
  photonSourcePath: string | undefined,
  scopeDir: string | undefined
): boolean {
  if (!scopeDir) return true;
  if (!photonSourcePath) return false;
  const resolved = canonicalizePath(photonSourcePath);
  const scope = canonicalizePath(scopeDir);
  return resolved === scope || resolved.startsWith(scope + path.sep);
}
