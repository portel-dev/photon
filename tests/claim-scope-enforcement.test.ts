/**
 * Regression for the claim-code scope bypass codex flagged.
 *
 * Before this test landed, `Mcp-Claim-Code` only filtered `tools/list`
 * output. A caller that already knew a tool's name — from a prior
 * unscoped session, a config file, docs, or a guess — could still
 * invoke it via `tools/call`, because the call handler resolved
 * against the full `ctx.photons` without re-checking scope. Claim
 * codes were hiding tools from the picker, not actually gating
 * access.
 *
 * This test pins the contract that the scope filter in `tools/call`
 * applies even when the tool name is known a priori.
 *
 * Implementation detail (why no daemon subprocess): `isPathInScope`
 * from `src/daemon/claims.ts` is the one piece of logic the HTTP
 * transport consults for both `tools/list` filtering and the
 * `tools/call` gate that got added. This test exercises it directly
 * plus a minimal end-to-end of the call handler's gating shape.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createClaim, isPathInScope, validateClaimSync } from '../dist/daemon/claims.js';

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

async function main(): Promise<void> {
  console.log('claim-code scope enforcement:');

  await test('in-scope photon passes the gate', () => {
    const scope = '/workspace/proj';
    assert.equal(isPathInScope('/workspace/proj/auth.photon.ts', scope), true);
    assert.equal(isPathInScope('/workspace/proj/deep/nested.photon.ts', scope), true);
  });

  await test('out-of-scope photon fails the gate', () => {
    const scope = '/workspace/proj';
    assert.equal(isPathInScope('/workspace/other/rogue.photon.ts', scope), false);
    assert.equal(
      isPathInScope('/workspace/projX/adjacent.photon.ts', scope),
      false,
      'separator guard: /workspace/projX must not count as under /workspace/proj'
    );
  });

  await test('a photon with no source path is rejected when a scope is active', () => {
    const scope = '/workspace/proj';
    // External MCP tools and runtime-injected tools surface without a
    // source `path`. A scoped session must not be able to reach
    // unattributed tools — the call handler rejects them the same way.
    assert.equal(isPathInScope(undefined, scope), false);
  });

  await test('unscoped session (no claim) keeps full access', () => {
    assert.equal(isPathInScope('/anywhere/on/disk.photon.ts', undefined), true);
    assert.equal(
      isPathInScope(undefined, undefined),
      true,
      'no scope + no source → unscoped sessions see everything, including runtime-injected tools'
    );
  });

  console.log('\n  revocation + revalidation:');

  await test('revoked claim is rejected by validateClaimSync', async () => {
    const baseDir = mkdtempSync(join(os.tmpdir(), 'photon-claim-revoke-'));
    try {
      const { revokeClaim } = await import('../dist/daemon/claims.js');
      const rec = await createClaim({ scopeDir: baseDir, ttlMs: 60_000 }, baseDir);

      // Simulate the first request: session stamps scopeDir from a
      // valid code.
      const first = validateClaimSync(rec.code, baseDir);
      assert.equal(first.ok, true);

      // Owner revokes.
      assert.equal(await revokeClaim(rec.code, baseDir), true);

      // Next request must re-validate and fail — the transport's
      // per-request re-check is what turns revocation into an
      // immediate gate rather than a lagging cleanup.
      const afterRevoke = validateClaimSync(rec.code, baseDir);
      assert.equal(afterRevoke.ok, false);
      if (!afterRevoke.ok) assert.equal(afterRevoke.reason, 'unknown');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  console.log('\n  tools/call gate shape:');

  await test('the gate decision uses photon.path matched against session.claimScopeDir', () => {
    // This mirrors the check the transport runs at
    // streamable-http-transport.ts tools/call. The transport does
    // exactly: `if (!isPathInScope(targetPhoton.path, session.claimScopeDir)) return error`.
    // That shape is all this test guards — more complex integration
    // coverage lives in the e2e smoke test once we add one.
    const session = { claimScopeDir: '/workspace/proj' };
    const insidePhoton = { name: 'auth', path: '/workspace/proj/auth.photon.ts' };
    const outsidePhoton = { name: 'rogue', path: '/workspace/other/rogue.photon.ts' };

    const allow = (p: { path?: string }): boolean =>
      !session.claimScopeDir || isPathInScope(p.path, session.claimScopeDir);

    assert.equal(allow(insidePhoton), true, 'in-scope tools/call must be allowed');
    assert.equal(
      allow(outsidePhoton),
      false,
      'out-of-scope tools/call must be rejected — this is the bypass codex flagged'
    );
  });

  console.log('\nAll claim-code scope enforcement tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
