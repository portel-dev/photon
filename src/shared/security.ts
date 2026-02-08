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
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
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
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1'
  );
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

/**
 * Validates a URL string. Returns the parsed URL or throws on invalid/dangerous input.
 */
export function validateUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Invalid URL protocol: ${url.protocol}`);
  }
  return url;
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

// ─── Prototype Pollution Prevention ─────────────────────────────────

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Returns a shallow copy of `obj` with dangerous prototype-pollution keys removed.
 * Works recursively on nested objects.
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const val = obj[key];
    result[key] = val !== null && typeof val === 'object' && !Array.isArray(val)
      ? sanitizeObject(val)
      : val;
  }
  return result as T;
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
