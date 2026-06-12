/**
 * Security posture contract — default-closed, pinned.
 *
 * Photon's security history is post-hoc: "restrict CORS", "sanitize error
 * messages", "rate-limit file I/O", "restrict playground to dev mode"
 * (twice). Each fix arrived after an audit because nothing asserted the
 * closed posture. This contract pins it so a loosened default fails CI the
 * day it's introduced:
 *
 *   1. CORS answers only localhost origins — unit-tested against the real
 *      getCorsOrigin, including lookalike-origin attacks, plus a source
 *      scan proving no wildcard header and no header set outside the
 *      getCorsOrigin policy.
 *   2. HTTP error responses never carry raw error text (absolute paths
 *      from ENOENT/EACCES, stack frames) — source scan over every
 *      res.end(JSON.stringify(...)) window in backend HTTP code.
 *   3. The four rate-limited surfaces (browse, beam API, MCP transport,
 *      webhooks) keep their limiters, and the limiter actually denies.
 *   4. The playground route stays inside the devMode gate.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getCorsOrigin, isLocalhostOrigin, SimpleRateLimiter } from '../../dist/shared/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/** All backend files that write HTTP responses. */
function backendHttpFiles(): string[] {
  const dirs = [
    'src',
    'src/auto-ui',
    'src/auto-ui/beam',
    'src/auto-ui/beam/routes',
    'src/serv',
    'src/serv/auth',
    'src/serv/middleware',
    'src/daemon',
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.ts') && fs.statSync(path.join(abs, f)).isFile()) {
        files.push(path.join(dir, f));
      }
    }
  }
  return files;
}

console.log('\n🔒 Security posture contract\n');

// ── 1. CORS: localhost-only, no wildcard ─────────────────────

test('getCorsOrigin echoes localhost origins only', () => {
  for (const ok of ['http://localhost:3000', 'http://127.0.0.1:8080', 'http://[::1]:4000']) {
    assert.equal(getCorsOrigin({ headers: { origin: ok } } as any), ok, `${ok} should be allowed`);
  }
});

test('getCorsOrigin rejects remote and lookalike origins', () => {
  const evil = [
    'http://evil.com',
    'https://photon.example.com',
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://evil.com/?localhost',
    'http://evil.com#localhost',
    'null',
    'file://localhost/etc',
  ];
  for (const origin of evil) {
    assert.equal(
      getCorsOrigin({ headers: { origin } } as any),
      undefined,
      `${origin} must NOT receive a CORS allow header`
    );
  }
});

test('isLocalhostOrigin treats absent Origin as same-origin (allowed)', () => {
  assert.equal(isLocalhostOrigin(undefined), true);
});

test('no wildcard Access-Control-Allow-Origin in backend source', () => {
  const offenders: string[] = [];
  for (const file of backendHttpFiles()) {
    const src = read(file);
    if (
      /Access-Control-Allow-Origin'\s*[,:]\s*'\*'/.test(src) ||
      /'Access-Control-Allow-Origin':\s*'\*'/.test(src)
    ) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `wildcard CORS found in: ${offenders.join(', ')}`);
});

test('every Access-Control-Allow-Origin header is fed by the getCorsOrigin policy', () => {
  const offenders: string[] = [];
  for (const file of backendHttpFiles()) {
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      if (!line.includes("'Access-Control-Allow-Origin'")) return;
      // The value on (or near) the setting line must come from a variable
      // produced by getCorsOrigin — by convention named corsOrigin/origin
      // guarded above. Accept any window that references getCorsOrigin or
      // a corsOrigin/preflightOrigin variable.
      const window = lines.slice(Math.max(0, i - 6), i + 2).join('\n');
      if (!/getCorsOrigin|corsOrigin|preflightOrigin/i.test(window)) {
        offenders.push(`${file}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `CORS header set outside the getCorsOrigin policy: ${offenders.join(', ')}`
  );
});

// ── 2. Error responses never carry raw error text ────────────

test('no raw error text in backend HTTP JSON responses', () => {
  const offenders: string[] = [];
  const leakPattern =
    /String\((?:e|err|error)\)|(?:\b(?:e|err|error)|\w*[Ee]rror)\.message|\.stack\b/;
  for (const file of backendHttpFiles()) {
    const src = read(file);
    // Inspect ONLY the JSON.stringify(...) payload expression (balanced
    // parens), not surrounding lines — server-side logger calls nearby
    // legitimately reference err.message.
    const re = /res\.end\(\s*JSON\.stringify\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      // Explicit, reasoned exemptions: a `posture-allow:` comment within
      // the 3 lines above the response marks error text as the product
      // (e.g. the dev test-runner returning assertion failures).
      const before = src.slice(0, m.index).split('\n');
      if (before.slice(-4).some((l) => l.includes('posture-allow:'))) {
        continue;
      }
      let depth = 1;
      let j = m.index + m[0].length;
      while (j < src.length && depth > 0) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
        j++;
      }
      const payload = src.slice(m.index + m[0].length, j - 1);
      if (leakPattern.test(payload)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `raw error text reaches HTTP clients (absolute paths/stacks leak via ENOENT messages) at: ${offenders.join(', ')}`
  );
});

// ── 3. Rate limiting on every exposed surface ────────────────

test('SimpleRateLimiter actually denies past the threshold', () => {
  const limiter = new SimpleRateLimiter(3, 60_000);
  assert.equal(limiter.isAllowed('ip'), true);
  assert.equal(limiter.isAllowed('ip'), true);
  assert.equal(limiter.isAllowed('ip'), true);
  assert.equal(limiter.isAllowed('ip'), false, '4th request within window must be denied');
  assert.equal(limiter.isAllowed('other-ip'), true, 'keys are independent');
});

test('all four exposed surfaces construct rate limiters', () => {
  const surfaces: Array<[string, string]> = [
    ['src/auto-ui/beam/routes/api-browse.ts', 'file-browse routes'],
    ['src/auto-ui/beam.ts', 'beam API'],
    ['src/auto-ui/streamable-http-transport.ts', 'MCP HTTP transport'],
    ['src/daemon/server.ts', 'webhook endpoint'],
  ];
  const missing = surfaces
    .filter(([file]) => !/new SimpleRateLimiter\(/.test(read(file)))
    .map(([file, label]) => `${label} (${file})`);
  assert.deepEqual(missing, [], `rate limiter removed from: ${missing.join(', ')}`);
});

// ── 4. Playground stays dev-only ─────────────────────────────

test('playground route is inside the devMode gate', () => {
  const src = read('src/server.ts');
  const idx = src.indexOf("'/playground'");
  assert.ok(idx > 0, 'playground route not found');
  // The devMode guard must open within the preceding ~400 chars of the
  // route match (same block). Moving the route out of the gate breaks this.
  const preceding = src.slice(Math.max(0, idx - 400), idx);
  assert.ok(
    /if\s*\(\s*this\.devMode\s*\)/.test(preceding),
    'playground route is no longer guarded by this.devMode'
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
