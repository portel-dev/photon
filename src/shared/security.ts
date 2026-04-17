/**
 * Central security helpers for Photon runtime.
 * Covers path validation, request authentication, input sanitization,
 * rate limiting, body size limits, and security headers.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

// ─── Path Validation ────────────────────────────────────────────────

/**
 * Returns true if `candidate` resolves to a location within `root`.
 * Uses realpath-style resolution and ensures trailing separator check
 * to prevent prefix-matching attacks (e.g. /tmp/foo vs /tmp/foobar).
 */
export function isPathWithin(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  // Exact match or starts with root + separator
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep)
  );
}

/**
 * Validates that an asset path does not contain traversal sequences
 * or absolute path components. Returns the sanitized path or throws.
 */
export function validateAssetPath(assetPath: string): string {
  // Reject absolute paths
  if (path.isAbsolute(assetPath)) {
    throw new Error(`Absolute asset paths are not allowed: ${assetPath}`);
  }
  // Reject path traversal
  const normalized = path.normalize(assetPath);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error(`Path traversal detected in asset path: ${assetPath}`);
  }
  return normalized;
}

// ─── Request Authentication ─────────────────────────────────────────

/**
 * Returns true if the request originates from localhost.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress;
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid short-circuiting leaking length info
    const buf = Buffer.from(a);
    crypto.timingSafeEqual(buf, buf);
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Input Validation ───────────────────────────────────────────────

/**
 * Validates an npm package name. Allows scoped packages and optional version specifier.
 * Rejects any input that could be used for command injection.
 */
const NPM_PACKAGE_NAME_RE =
  /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*(@[a-z0-9\-._^~>=<| ]+)?$/;

export function validateNpmPackageName(input: string): boolean {
  return NPM_PACKAGE_NAME_RE.test(input);
}

// ─── HTML / XSS Prevention ──────────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

// ─── Template Safety ────────────────────────────────────────────────

const FORBIDDEN_IDENTIFIERS = new Set([
  'process',
  'require',
  'eval',
  'Function',
  'globalThis',
  'global',
  'import',
  'module',
  'exports',
  'child_process',
  'execSync',
  'exec',
  'spawn',
  'spawnSync',
]);

/**
 * Checks if a template expression contains forbidden identifiers
 * that could be used for code injection. Returns the forbidden token or null.
 */
export function findForbiddenIdentifier(expr: string): string | null {
  for (const id of FORBIDDEN_IDENTIFIERS) {
    // Match as a word boundary to avoid false positives (e.g. "processing")
    const re = new RegExp(`\\b${id}\\b`);
    if (re.test(expr)) return id;
  }
  return null;
}

// ─── Body Size Limits ───────────────────────────────────────────────

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MB

/**
 * Reads the request body with a size limit. Rejects if the body exceeds maxBytes.
 */
export function readBody(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error(`Request body too large (limit: ${maxBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

// ─── CORS Origin Validation ─────────────────────────────────────────

/**
 * Returns true if the given Origin header value is a localhost address.
 * Same-origin requests (no Origin header) are considered safe.
 */
export function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin requests have no Origin header
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Returns the CORS origin to use in Access-Control-Allow-Origin, or undefined
 * if the request origin is not from localhost (in which case the header should be omitted).
 */
export function getCorsOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  if (isLocalhostOrigin(origin)) {
    return origin || 'http://localhost';
  }
  return undefined;
}

// ─── Security Headers ───────────────────────────────────────────────

/**
 * Sets standard security headers on an HTTP response.
 */
export function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

// ─── Rate Limiting ──────────────────────────────────────────────────

/**
 * Parse a CIDR notation string into a {base, prefix} pair. Returns null
 * for malformed input. Supports IPv4 only for now — IPv6 allowlists are
 * handled separately by exact-match since realistic webhook sources are
 * IPv4 in practice.
 */
function parseCidrV4(cidr: string): { base: number; prefix: number } | null {
  const [ip, prefixRaw] = cidr.trim().split('/');
  if (!ip) return null;
  const prefix = prefixRaw === undefined ? 32 : parseInt(prefixRaw, 10);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return null;
  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  let base = 0;
  for (const o of octets) {
    const n = parseInt(o, 10);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    base = ((base << 8) | n) >>> 0;
  }
  return { base, prefix };
}

function ipv4ToInt(ip: string): number | null {
  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  let n = 0;
  for (const o of octets) {
    const v = parseInt(o, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = ((n << 8) | v) >>> 0;
  }
  return n;
}

/**
 * Return true when `ip` is inside any of the given CIDR ranges or equals
 * any literal entry. Silently ignores malformed CIDRs (the caller should
 * log them at config-parse time).
 */
export function ipInAllowlist(ip: string, ranges: string[]): boolean {
  if (ranges.length === 0) return true; // no allowlist = allow all
  // Strip IPv6-mapped IPv4 prefix so "::ffff:10.0.0.1" matches "10.0.0.0/8".
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const addr = ipv4ToInt(normalized);
  for (const raw of ranges) {
    const entry = raw.trim();
    if (!entry) continue;
    // Exact-match fallback (covers IPv6 literals without CIDR math).
    if (entry === ip || entry === normalized) return true;
    if (addr === null) continue;
    const parsed = parseCidrV4(entry);
    if (!parsed) continue;
    const mask = parsed.prefix === 0 ? 0 : (~0 << (32 - parsed.prefix)) >>> 0;
    if ((addr & mask) === (parsed.base & mask)) return true;
  }
  return false;
}

/**
 * Parse a comma-separated list of CIDR ranges / literal IPs from env
 * config. Empty string → empty array (allow all). Malformed entries are
 * dropped (matching the ipInAllowlist tolerance).
 */
export function parseAllowlistEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Simple in-memory rate limiter using a sliding window.
 */
export class SimpleRateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number = 30,
    private readonly windowMs: number = 60_000
  ) {}

  /**
   * Returns true if the request is allowed, false if rate-limited.
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Remove expired entries
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Resets the rate limiter for a specific key or all keys.
   */
  reset(key?: string): void {
    if (key) {
      this.windows.delete(key);
    } else {
      this.windows.clear();
    }
  }
}

// ─── Content Integrity ──────────────────────────────────────────────

/**
 * Verifies that content matches an expected SHA-256 hash.
 */
export function verifyContentHash(content: string, expectedHash: string): boolean {
  const actual = crypto.createHash('sha256').update(content).digest('hex');
  return timingSafeEqual(actual, expectedHash);
}

// ─── Dangerous Module Detection ─────────────────────────────────────

const DANGEROUS_PATTERNS = [
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
  /\bimport\s+.*['"]child_process['"]/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bexecSync\s*\(/,
  /\bspawnSync\s*\(/,
];

/**
 * Scans JavaScript/TypeScript source code for dangerous patterns.
 * Returns a list of warnings (not blocking — informational only).
 */
export function warnIfDangerous(source: string): string[] {
  const warnings: string[] = [];
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(source)) {
      warnings.push(`Potentially dangerous pattern detected: ${pattern.source}`);
    }
  }
  return warnings;
}
