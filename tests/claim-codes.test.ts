/**
 * Claim-code store contract tests.
 *
 * Exercises the public surface of `src/daemon/claims.ts`:
 *   - create / list / revoke round-trip through disk
 *   - TTL + expired-entry purge on list
 *   - validation: unknown / malformed / expired / ok
 *   - scope filter (isPathInScope) — prefix match + separator guard
 *
 * Every test runs against a fresh temp dir so state doesn't leak between
 * cases. The store is a small JSON file, so a disk round-trip per test
 * costs nothing and matches production behavior exactly.
 */

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createClaim,
  listClaims,
  revokeClaim,
  validateClaimSync,
  isPathInScope,
  normalizeCode,
  formatCode,
  generateCode,
  getClaimsFilePath,
} from '../dist/daemon/claims.js';

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

function freshBaseDir(): string {
  return mkdtempSync(join(tmpdir(), 'photon-claim-'));
}

async function main(): Promise<void> {
  console.log('claim-code store:');

  await test('create writes a record that list can read back', async () => {
    const baseDir = freshBaseDir();
    try {
      const rec = await createClaim({ scopeDir: baseDir, ttlMs: 60_000, label: 'first' }, baseDir);
      assert.match(rec.code, /^[A-Z0-9]{6}$/);
      // createClaim canonicalizes scopeDir via realpath (symlink
      // escape defense — a lexical compare would let a symlinked
      // photon inside scope escape the scope check). On macOS
      // `/var/folders/...` is itself a symlink to `/private/var/...`,
      // so the stored path resolves to the canonical form. Compare
      // against the realpath'd baseDir rather than the raw one.
      assert.equal(rec.scopeDir, realpathSync(baseDir));
      assert.equal(rec.label, 'first');
      const list = await listClaims(baseDir);
      assert.equal(list.length, 1);
      assert.equal(list[0].code, rec.code);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('createClaim rejects relative scopeDir', async () => {
    const baseDir = freshBaseDir();
    try {
      await assert.rejects(
        () => createClaim({ scopeDir: 'relative/path', ttlMs: 60_000 }, baseDir),
        /absolute/
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('createClaim rejects ttl below 1 minute', async () => {
    const baseDir = freshBaseDir();
    try {
      await assert.rejects(
        () => createClaim({ scopeDir: baseDir, ttlMs: 1_000 }, baseDir),
        /ttlMs/
      );
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('validate returns ok for a live code, unknown after revoke', async () => {
    const baseDir = freshBaseDir();
    try {
      const rec = await createClaim({ scopeDir: baseDir, ttlMs: 60_000 }, baseDir);
      const ok = validateClaimSync(rec.code, baseDir);
      assert.equal(ok.ok, true);
      if (ok.ok) assert.equal(ok.claim.code, rec.code);

      const revoked = await revokeClaim(rec.code, baseDir);
      assert.equal(revoked, true);

      const after = validateClaimSync(rec.code, baseDir);
      assert.equal(after.ok, false);
      if (!after.ok) assert.equal(after.reason, 'unknown');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('validate rejects malformed codes', async () => {
    const baseDir = freshBaseDir();
    try {
      for (const bad of ['', 'TOOSHORT', 'way-too-long-for-a-code', '!!!!!!']) {
        const res = validateClaimSync(bad, baseDir);
        assert.equal(res.ok, false, `expected failure for ${JSON.stringify(bad)}`);
        if (!res.ok) assert.equal(res.reason, 'malformed');
      }
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('expired claims are reported as expired and purged by list', async () => {
    const baseDir = freshBaseDir();
    try {
      // Inject an already-expired claim straight into the store file so we
      // don't have to wait on real time.
      const file = getClaimsFilePath(baseDir);
      const path = await import('node:path');
      const fs = await import('node:fs/promises');
      await fs.mkdir(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify(
          [
            {
              code: 'ABCDEF',
              scopeDir: baseDir,
              createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
              expiresAt: Date.now() - 86_400_000,
            },
          ],
          null,
          2
        )
      );

      const res = validateClaimSync('ABCDEF', baseDir);
      assert.equal(res.ok, false);
      if (!res.ok) assert.equal(res.reason, 'expired');

      const fresh = await listClaims(baseDir);
      assert.equal(fresh.length, 0, 'expired claim must be purged from list()');
      const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
      assert.equal(onDisk.length, 0, 'list() should write the purged file back');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('revoke returns false when the code does not exist', async () => {
    const baseDir = freshBaseDir();
    try {
      assert.equal(await revokeClaim('NONEXT', baseDir), false);
      assert.equal(existsSync(getClaimsFilePath(baseDir)), false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('normalizeCode + formatCode are inverses (display ↔ storage)', () => {
    assert.equal(normalizeCode('abc-123'), 'ABC123');
    assert.equal(normalizeCode(' A B C 1 2 3 '), 'ABC123');
    assert.equal(formatCode('ABC123'), 'ABC-123');
    assert.equal(formatCode('abc-123'), 'ABC-123');
  });

  await test('generated codes only use the restricted alphabet', () => {
    const banned = /[01IOLio l]/; // lookalikes intentionally excluded
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      assert.match(code, /^[A-Z0-9]{6}$/);
      assert.doesNotMatch(code, banned);
    }
  });

  console.log('\n  scope filter:');

  await test('isPathInScope: true under scope, false sibling, guard separator', () => {
    assert.equal(isPathInScope('/workspace/proj/foo.photon.ts', '/workspace/proj'), true);
    assert.equal(isPathInScope('/workspace/proj', '/workspace/proj'), true);
    assert.equal(
      isPathInScope('/workspace/projX/foo.photon.ts', '/workspace/proj'),
      false,
      'projX must not match scope `proj` — separator guard'
    );
    assert.equal(isPathInScope('/other/foo.photon.ts', '/workspace/proj'), false);
  });

  await test('isPathInScope returns true when scopeDir is undefined (backward compat)', () => {
    assert.equal(isPathInScope('/anything.photon.ts', undefined), true);
    assert.equal(isPathInScope(undefined, undefined), true);
  });

  await test('isPathInScope returns false when scopeDir set but source is undefined', () => {
    assert.equal(isPathInScope(undefined, '/workspace/proj'), false);
  });

  await test('isPathInScope canonicalizes via realpath — a symlinked photon inside scope still matches its target', async () => {
    // Set up: scope = /tmp/.../scope, a real photon lives at
    // /tmp/.../outside/foo.ts, and a symlink inside scope points
    // at it. Lexical `path.resolve` would say the symlink is
    // in-scope (wrong — it targets outside). With realpath, we
    // follow the link and correctly report out-of-scope.
    const root = freshBaseDir();
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const scope = path.join(root, 'scope');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(scope, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      const realPhoton = path.join(outside, 'foo.ts');
      fs.writeFileSync(realPhoton, '// foo');
      const linkedPhoton = path.join(scope, 'foo.ts');
      fs.symlinkSync(realPhoton, linkedPhoton);

      // Symlinked path sits *lexically* under scope, but realpath
      // resolves to the outside target. The check must reject it.
      assert.equal(
        isPathInScope(linkedPhoton, scope),
        false,
        'symlinked photon pointing outside scope must not be treated as in-scope'
      );
      // A genuine in-scope file still passes.
      const realInScope = path.join(scope, 'bar.ts');
      fs.writeFileSync(realInScope, '// bar');
      assert.equal(isPathInScope(realInScope, scope), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  console.log('\nAll claim-code tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
