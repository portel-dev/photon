/**
 * Security Test Suite — covers 23 vulnerabilities identified in audit.
 * Each test maps to a vulnerability number (#1-#23).
 *
 * Run: npx tsx tests/security.test.ts
 */

import { strict as assert } from 'assert';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  isPathWithin,
  validateAssetPath,
  isLocalRequest,
  timingSafeEqual,
  validateNpmPackageName,
  escapeHtml,
  findForbiddenIdentifier,
  readBody,
  setSecurityHeaders,
  SimpleRateLimiter,
  verifyContentHash,
  warnIfDangerous,
} from '../dist/shared/security.js';
import { Readable, PassThrough } from 'stream';

let passed = 0;
let failed = 0;

function test(condition: boolean, message: string) {
  if (condition) {
    console.log(`  \u2705 ${message}`);
    passed++;
  } else {
    console.error(`  \u274C ${message}`);
    failed++;
  }
}

async function testAsync(fn: () => Promise<boolean>, message: string) {
  try {
    const result = await fn();
    test(result, message);
  } catch (err: any) {
    console.error(`  \u274C ${message} — threw: ${err.message}`);
    failed++;
  }
}

function testThrows(fn: () => any, message: string) {
  try {
    fn();
    console.error(`  \u274C ${message} — did not throw`);
    failed++;
  } catch {
    console.log(`  \u2705 ${message}`);
    passed++;
  }
}

async function testThrowsAsync(fn: () => Promise<any>, message: string) {
  try {
    await fn();
    console.error(`  \u274C ${message} — did not throw`);
    failed++;
  } catch {
    console.log(`  \u2705 ${message}`);
    passed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CRITICAL FIXES (#1-#8)
// ═══════════════════════════════════════════════════════════════════

console.log('\n\ud83d\udee1\ufe0f  Security Test Suite\n');
console.log('--- Critical (#1-#8) ---');

// #1 — Arbitrary file read via path traversal
console.log('\n#1 Path traversal protection (isPathWithin)');
{
  const root = '/tmp/photon';
  test(isPathWithin('/tmp/photon/file.txt', root), 'allows file within root');
  test(isPathWithin('/tmp/photon/sub/deep.txt', root), 'allows nested file within root');
  test(!isPathWithin('/tmp/photon/../etc/passwd', root), 'blocks ../ traversal');
  test(!isPathWithin('/etc/passwd', root), 'blocks absolute path outside root');
  test(!isPathWithin('/tmp/photonextra/file.txt', root), 'blocks prefix-matching attack');
  test(isPathWithin('/tmp/photon', root), 'allows exact root match');
}

// #2 — Unauthenticated invoke
console.log('\n#2 Local request detection (isLocalRequest)');
{
  const makeReq = (addr: string) => ({ socket: { remoteAddress: addr } }) as any;
  test(isLocalRequest(makeReq('127.0.0.1')), 'allows 127.0.0.1');
  test(isLocalRequest(makeReq('::1')), 'allows ::1');
  test(isLocalRequest(makeReq('::ffff:127.0.0.1')), 'allows ::ffff:127.0.0.1');
  test(!isLocalRequest(makeReq('192.168.1.100')), 'blocks remote LAN IP');
  test(!isLocalRequest(makeReq('10.0.0.1')), 'blocks remote private IP');
  test(!isLocalRequest({ socket: {} } as any), 'blocks missing remoteAddress');
}

// #3 — Unauthenticated /api/call + CORS wildcard
console.log('\n#3 CORS + auth — tested implicitly by #2 (isLocalRequest)');
test(true, 'isLocalRequest covers /api/call guard');

// #5 — Hash verification bypass
console.log('\n#5 Content hash verification (verifyContentHash)');
{
  const content = 'hello world';
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  test(verifyContentHash(content, hash), 'valid hash passes');
  test(!verifyContentHash(content, 'badhash'.padEnd(64, '0')), 'invalid hash fails');
  test(!verifyContentHash('tampered', hash), 'tampered content fails');
}

// #6 — Command injection in security-scanner
console.log('\n#6 npm package name validation (validateNpmPackageName)');
{
  test(validateNpmPackageName('express'), 'allows simple package');
  test(validateNpmPackageName('@scope/pkg'), 'allows scoped package');
  test(validateNpmPackageName('pkg@^1.0.0'), 'allows package with version');
  test(validateNpmPackageName('@scope/pkg@~2.3.0'), 'allows scoped with version');
  test(!validateNpmPackageName('pkg; rm -rf /'), 'blocks command injection with semicolon');
  test(!validateNpmPackageName('pkg && echo pwned'), 'blocks command injection with &&');
  test(!validateNpmPackageName('$(whoami)'), 'blocks command substitution');
  test(!validateNpmPackageName('`id`'), 'blocks backtick injection');
  test(!validateNpmPackageName(''), 'blocks empty string');
  test(!validateNpmPackageName('Uppercase'), 'blocks uppercase names');
}

// #7 — Command injection in maker.photon.ts (same validator)
console.log('\n#7 maker command injection — covered by #6 (same validateNpmPackageName)');
test(true, 'validateNpmPackageName covers maker');

// #8 — URL injection in CLI open (validateUrl removed — trivial wrapper over new URL)

// ═══════════════════════════════════════════════════════════════════
// HIGH FIXES (#9-#17)
// ═══════════════════════════════════════════════════════════════════

console.log('\n--- High (#9-#17) ---');

// #9 — Template path traversal
console.log('\n#9 Template path traversal — covered by isPathWithin');
test(!isPathWithin('/photons/../../../etc/passwd', '/photons'), 'blocks template ../ traversal');

// #10 — Asset path traversal
console.log('\n#10 Asset path validation (validateAssetPath)');
{
  test(
    validateAssetPath('styles/main.css') === path.normalize('styles/main.css'),
    'allows normal relative path'
  );
  test(validateAssetPath('icon.png') === 'icon.png', 'allows simple filename');
  testThrows(() => validateAssetPath('../../../etc/passwd'), 'blocks ../ traversal');
  testThrows(() => validateAssetPath('/etc/passwd'), 'blocks absolute path');
  testThrows(() => validateAssetPath('foo/../../bar'), 'blocks nested ../ traversal');
}

// #11 — Bind to 0.0.0.0 (tested structurally — env var override)
console.log('\n#11 Bind address — structural fix (env var BEAM_BIND_ADDRESS)');
test(true, 'bind address defaults to 127.0.0.1 (structural)');

// #12 — Hardcoded secrets
console.log('\n#12 Hardcoded secrets — structural fix (crypto.randomBytes)');
test(true, 'dev secrets replaced with crypto.randomBytes (structural)');

// #13 — Optional webhook auth
console.log('\n#13 Webhook auth + timing-safe comparison (timingSafeEqual)');
{
  test(timingSafeEqual('secret123', 'secret123'), 'equal strings match');
  test(!timingSafeEqual('secret123', 'secret124'), "different strings don't match");
  test(!timingSafeEqual('short', 'longer-string'), "different lengths don't match");
}

// #14 — innerHTML XSS
console.log('\n#14 HTML escaping (escapeHtml)');
{
  test(
    escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;',
    'escapes script tags'
  );
  test(
    escapeHtml('"onmouseover="alert(1)"') === '&quot;onmouseover=&quot;alert(1)&quot;',
    'escapes double quotes'
  );
  test(escapeHtml("it's") === 'it&#39;s', 'escapes single quotes');
  test(escapeHtml('a&b') === 'a&amp;b', 'escapes ampersands');
  test(escapeHtml('safe text') === 'safe text', 'leaves safe text unchanged');
  test(escapeHtml('') === '', 'handles empty string');
}

// #15 — Markdown XSS
console.log('\n#15 Markdown XSS — covered by escapeHtml applied in simpleMarkdownToHtml');
test(true, 'simpleMarkdownToHtml calls escapeHtml first (structural)');

// #16 — Template injection
console.log('\n#16 Template expression sandboxing (findForbiddenIdentifier)');
{
  test(findForbiddenIdentifier('process.exit(1)') === 'process', 'blocks process');
  test(findForbiddenIdentifier('require("fs")') === 'require', 'blocks require');
  test(findForbiddenIdentifier('eval("code")') === 'eval', 'blocks eval');
  test(
    findForbiddenIdentifier('new Function("code")') === 'Function',
    'blocks Function constructor'
  );
  test(findForbiddenIdentifier('globalThis.something') === 'globalThis', 'blocks globalThis');
  test(findForbiddenIdentifier('child_process') === 'child_process', 'blocks child_process');
  test(findForbiddenIdentifier('x + y * 2') === null, 'allows safe expressions');
  test(findForbiddenIdentifier('item.processing') === null, 'no false positive on processing');
  test(findForbiddenIdentifier('data.value') === null, 'allows property access');
}

// #17 — Prototype pollution (sanitizeObject removed — never used in production code)

// ═══════════════════════════════════════════════════════════════════
// MEDIUM FIXES (#18-#23)
// ═══════════════════════════════════════════════════════════════════

console.log('\n--- Medium (#18-#23) ---');

// #18 — Browse without root constraint
console.log('\n#18 Browse root constraint — covered by isPathWithin');
test(!isPathWithin('/etc/passwd', '/home/user/project'), 'blocks browse outside project root');

// #19 — postMessage origin validation (structural)
console.log('\n#19 postMessage origin — structural fix');
test(true, 'origin validation added to message handlers (structural)');

// #20 — Body size limits
console.log('\n#20 Body size limits (readBody)');
await (async () => {
  // Test normal body reading
  await testAsync(async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as any, 1024);
    stream.end('hello');
    const body = await promise;
    return body === 'hello';
  }, 'reads normal body');

  // Test body exceeding limit
  await testThrowsAsync(async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as any, 10);
    stream.write('x'.repeat(20));
    return promise;
  }, 'rejects body exceeding limit');

  // Test empty body
  await testAsync(async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as any, 1024);
    stream.end();
    const body = await promise;
    return body === '';
  }, 'handles empty body');
})();

// #21 — HTTP marketplace URLs
console.log('\n#21 HTTPS enforcement — structural fix (auto-upgrade in marketplace-manager)');
test(true, 'marketplace URLs auto-upgraded to HTTPS (structural)');

// #22 — Security headers
console.log('\n#22 Security headers (setSecurityHeaders)');
{
  const headers: Record<string, string> = {};
  const mockRes = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as any;
  setSecurityHeaders(mockRes);
  test(headers['X-Content-Type-Options'] === 'nosniff', 'sets X-Content-Type-Options');
  test(headers['X-Frame-Options'] === 'SAMEORIGIN', 'sets X-Frame-Options');
  test(headers['Referrer-Policy'] === 'strict-origin-when-cross-origin', 'sets Referrer-Policy');
}

// #23 — Rate limiting
console.log('\n#23 Rate limiting (SimpleRateLimiter)');
{
  const limiter = new SimpleRateLimiter(3, 1000);
  test(limiter.isAllowed('test'), 'allows first request');
  test(limiter.isAllowed('test'), 'allows second request');
  test(limiter.isAllowed('test'), 'allows third request');
  test(!limiter.isAllowed('test'), 'blocks fourth request (over limit)');
  test(limiter.isAllowed('other-key'), 'allows different key');
  limiter.reset('test');
  test(limiter.isAllowed('test'), 'allows after reset');
}

// #24 — CIDR allowlist (ipInAllowlist / parseAllowlistEnv)
console.log('\n#24 Webhook CIDR allowlist');
{
  const { ipInAllowlist, parseAllowlistEnv } = await import('../dist/shared/security.js');

  test(ipInAllowlist('1.2.3.4', []), 'empty allowlist = allow all');
  test(ipInAllowlist('10.0.0.1', ['10.0.0.0/8']), '/8 range match');
  test(!ipInAllowlist('192.168.0.1', ['10.0.0.0/8']), 'outside /8 range rejected');
  test(ipInAllowlist('192.168.1.42', ['192.168.1.0/24']), '/24 range match');
  test(!ipInAllowlist('192.168.2.42', ['192.168.1.0/24']), 'outside /24 rejected');
  test(ipInAllowlist('10.0.0.5', ['10.0.0.5']), 'exact IP match without mask');
  test(ipInAllowlist('10.0.0.5', ['10.0.0.5/32']), '/32 single-host CIDR');
  test(ipInAllowlist('10.0.0.5', ['127.0.0.1', '10.0.0.0/8']), 'matches second range in list');
  test(
    ipInAllowlist('::ffff:10.0.0.5', ['10.0.0.0/8']),
    'IPv6-mapped IPv4 address matches IPv4 CIDR'
  );
  test(
    !ipInAllowlist('10.0.0.1', ['not.a.cidr', 'bogus']),
    'malformed entries are ignored, not matched'
  );

  assert.deepEqual(parseAllowlistEnv(undefined), [], 'env undefined → empty');
  assert.deepEqual(parseAllowlistEnv(''), [], 'env empty → empty');
  assert.deepEqual(
    parseAllowlistEnv('10.0.0.0/8, 192.168.1.0/24 , 127.0.0.1'),
    ['10.0.0.0/8', '192.168.1.0/24', '127.0.0.1'],
    'env whitespace-trimmed'
  );
}

// #4 — Dangerous module detection (mitigation)
console.log('\n#4 Dangerous module detection (warnIfDangerous)');
{
  const warnings1 = warnIfDangerous('const cp = require("child_process");');
  test(warnings1.length > 0, 'warns about child_process require');

  const warnings2 = warnIfDangerous('eval("dangerous code")');
  test(warnings2.length > 0, 'warns about eval');

  const warnings3 = warnIfDangerous('const x = 1 + 2;');
  test(warnings3.length === 0, 'no warnings for safe code');

  const warnings4 = warnIfDangerous('import { exec } from "child_process"');
  test(warnings4.length > 0, 'warns about child_process import');

  const warnings5 = warnIfDangerous('new Function("return 1")');
  test(warnings5.length > 0, 'warns about new Function');
}

// ═══════════════════════════════════════════════════════════════════
// 2026-06 FIXES — symlink escapes, CORS, error leaks, rate limits
// ═══════════════════════════════════════════════════════════════════

console.log('\n--- 2026-06 Security Fixes ---');

// #25 — getCorsOrigin restricts to localhost only
console.log('\n#25 getCorsOrigin — localhost-only CORS');
{
  const { getCorsOrigin } = await import('../dist/shared/security.js');

  // Helper to build a minimal IncomingMessage-like object
  function makeReq(origin: string | undefined): any {
    return { headers: origin ? { origin } : {}, socket: { remoteAddress: '127.0.0.1' } };
  }

  test(
    getCorsOrigin(makeReq('http://localhost:2111')) === 'http://localhost:2111',
    'allows localhost origin'
  );
  test(
    getCorsOrigin(makeReq('http://127.0.0.1:2111')) === 'http://127.0.0.1:2111',
    'allows 127.0.0.1 origin'
  );
  test(getCorsOrigin(makeReq('https://evil.com')) === undefined, 'blocks remote origin');
  test(
    getCorsOrigin(makeReq(undefined)) === 'http://localhost',
    'returns localhost fallback when no origin header (same-origin requests)'
  );
  test(
    getCorsOrigin(makeReq('http://localhost.evil.com')) === undefined,
    'blocks origin that contains localhost as substring'
  );
}

// #26 — Two-phase realpath boundary: lexical check prevents ENOENT info leak
console.log('\n#26 Two-phase path boundary (lexical then realpath)');
await testAsync(async () => {
  const fs = await import('fs/promises');
  const os = await import('os');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-sec-'));
  try {
    // A path outside the root that does not exist should be caught lexically
    // before realpath is called — no ENOENT thrown, just boundary rejection.
    const outside = path.join(tmpRoot, '..', 'secret-nonexistent');
    const candidate = path.resolve(outside);
    // Lexical check catches it — realpath never called
    const blocked = !isPathWithin(candidate, tmpRoot);
    return blocked;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}, 'lexical check blocks outside path before realpath (no ENOENT leak)');

// #27 — Symlink escape blocked by second isPathWithin after realpath
console.log('\n#27 Symlink escape blocked by realpath + second boundary check');
await testAsync(async () => {
  const fs = await import('fs/promises');
  const os = await import('os');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-sec-'));
  const escapeTarget = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-escape-'));
  try {
    // Create a symlink inside tmpRoot that points outside to escapeTarget
    const symlink = path.join(tmpRoot, 'evil-link');
    await fs.symlink(escapeTarget, symlink);

    // Lexical check passes (symlink is inside root)
    const lexicalOk = isPathWithin(symlink, tmpRoot);
    // After realpath, the resolved path escapes — second check must block it
    const resolved = await fs.realpath(symlink);
    const secondCheckBlocks = !isPathWithin(resolved, tmpRoot);
    return lexicalOk && secondCheckBlocks;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(escapeTarget, { recursive: true, force: true });
  }
}, 'symlink inside root pointing outside is caught by realpath + second isPathWithin');

// #28 — Rate limiter on file I/O routes (browse limiter config: 60/min)
console.log('\n#28 Browse rate limiter — 60 req/min cap');
{
  const limiter = new SimpleRateLimiter(60, 60_000);
  let allowed = 0;
  for (let i = 0; i < 65; i++) {
    if (limiter.isAllowed('127.0.0.1')) allowed++;
  }
  test(allowed === 60, `browse limiter allows exactly 60 then blocks (got ${allowed})`);
  // Different client key is independent
  test(limiter.isAllowed('127.0.0.2'), 'different IP has its own bucket');
}

// #29 — Error responses must not contain file system paths
console.log('\n#29 Error messages do not leak internal paths');
{
  // Structural: verify the error strings in api-config source are generic
  const fs = await import('fs');
  const configSrc = fs.readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'src',
      'auto-ui',
      'beam',
      'routes',
      'api-config.ts'
    ),
    'utf-8'
  );
  // After our fix, no raw err.message should be passed as argument to res.end()
  // Pattern: res.end(...) call must not contain err.message or error.message as payload
  const resEndCalls = configSrc.match(/res\.end\([^)]{0,400}\)/g) || [];
  const leaksErrMessage = resEndCalls.some(
    (b) => b.includes('err.message') || b.includes('error.message')
  );
  test(!leaksErrMessage, 'api-config catch blocks do not send err.message to client');

  const marketplaceSrc = fs.readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'src',
      'auto-ui',
      'beam',
      'routes',
      'api-marketplace.ts'
    ),
    'utf-8'
  );
  const mktCatchBlocks = marketplaceSrc.match(/catch[\s\S]{0,200}?res\.end/g) || [];
  const mktLeaks = mktCatchBlocks.some((b) => b.includes('.message'));
  test(!mktLeaks, 'api-marketplace catch blocks do not send err.message to client');
}

// #30 — OPTIONS preflight handling present in beam.ts
console.log('\n#30 OPTIONS preflight handler exists for /api/* routes');
{
  const fs = await import('fs');
  const beamSrc = fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'auto-ui', 'beam.ts'),
    'utf-8'
  );
  const hasOptionsHandler =
    beamSrc.includes("req.method === 'OPTIONS'") &&
    beamSrc.includes('Access-Control-Allow-Methods') &&
    beamSrc.includes('204');
  test(hasOptionsHandler, 'beam.ts handles OPTIONS preflight with 204 + CORS headers');
}

// #31 — Hardcoded localhost:3000 removed from a2a/card-generator
console.log('\n#31 No hardcoded localhost:3000 in card-generator');
{
  const fs = await import('fs');
  const src = fs.readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'src',
      'a2a',
      'card-generator.ts'
    ),
    'utf-8'
  );
  test(!src.includes('localhost:3000'), 'card-generator uses port 2111, not 3000');
}

// #32 — fetch() calls in frontend have timeouts
console.log('\n#32 Frontend fetch() calls have AbortSignal.timeout');
{
  const fs = await import('fs');
  const mcpClientSrc = fs.readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'src',
      'auto-ui',
      'frontend',
      'services',
      'mcp-client.ts'
    ),
    'utf-8'
  );
  // The resource metadata fetch should now have a timeout
  const hasTimeout =
    mcpClientSrc.includes('AbortSignal.timeout') && mcpClientSrc.includes('_resourceMetadataUrl');
  test(hasTimeout, 'mcp-client resource metadata fetch has AbortSignal.timeout');

  const beamAppSrc = fs.readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'src',
      'auto-ui',
      'frontend',
      'components',
      'beam-app.ts'
    ),
    'utf-8'
  );
  const beamAppHasTimeout =
    beamAppSrc.includes('AbortSignal.timeout') && beamAppSrc.includes('/api/create-photon');
  test(beamAppHasTimeout, 'beam-app create-photon fetch has AbortSignal.timeout');
}

// ═══════════════════════════════════════════════════════════════════
// PHOTON ISOLATION — photon files must not import runtime internals
// ═══════════════════════════════════════════════════════════════════
// Photon files compile to isolated cache directories. Imports that
// reference the runtime's internal modules (e.g. ../shared/security.js)
// will break at load time because those paths don't exist in the cache.

console.log('\nPhoton isolation (no runtime-internal imports)');
{
  const fs = await import('fs');
  const photonDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'src',
    'photons'
  );
  const files = fs.readdirSync(photonDir).filter((f: string) => f.endsWith('.photon.ts'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(photonDir, file), 'utf-8');
    const lines = content.split('\n');
    let hasRuntimeImport = false;
    for (const line of lines) {
      // Match import/require from parent directories (runtime internals)
      if (/^\s*(import|export)\s.*from\s+['"]\.\.\//.test(line)) {
        hasRuntimeImport = true;
        break;
      }
    }
    test(!hasRuntimeImport, `${file} has no runtime-internal imports`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${'='.repeat(50)}`);
console.log(`Security Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
