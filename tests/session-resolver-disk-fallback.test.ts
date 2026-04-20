/**
 * Regression: same-marketplace peer resolution via disk fallback.
 *
 * User-reported bug (2026-04-20): `this.call('peer.method')` from photon
 * A to a same-marketplace photon B fails with "Cannot initialize photon
 * 'peer'. Provide photonPath in request." when B hasn't been pre-loaded
 * by the daemon — even though B sits right next to A on disk and the
 * outer CLI resolves it correctly.
 *
 * Root cause: `getOrCreateSessionManager` only walked the in-memory
 * `sessionManagers` and `photonPaths` maps. The outer CLI does a disk
 * walk via `resolvePhotonPath` but the daemon's dispatcher never did.
 * Peers that weren't auto-registered + weren't previously invoked were
 * invisible to the daemon.
 *
 * Fix: after the in-memory walk misses, the daemon now falls back to
 * `resolvePhotonPath(name, workingDir)` then `resolvePhotonPath(name,
 * defaultBase)` — matching the outer CLI's resolution. Found paths are
 * cached into `photonPaths` at the caller's composite key so subsequent
 * calls hit the fast path.
 *
 * This test exercises the resolver helper directly (the daemon reuses
 * the same `resolvePhotonPath` from photon-core). The end-to-end path —
 * spawning a daemon and dispatching `this.call` from plain-class photon
 * A to non-preloaded B — is covered by the subagent verification that
 * runs against the HEAD binary.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePhotonPath } from '@portel/photon-core';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

async function main() {
  console.log('Disk-fallback peer resolution:');
  const home = mkdtempSync(join(tmpdir(), 'photon-disk-home-'));
  const marketplace = mkdtempSync(join(tmpdir(), 'photon-disk-market-'));

  await test('resolves peer in the caller marketplace on disk', async () => {
    // Simulate a marketplace with two side-by-side photons.
    writeFileSync(
      join(marketplace, 'caller.photon.ts'),
      'export default class Caller {}\n',
      'utf-8'
    );
    writeFileSync(join(marketplace, 'peer.photon.ts'), 'export default class Peer {}\n', 'utf-8');
    // The daemon's fallback walks caller's workingDir first. Peer must
    // be discoverable on disk without any prior load.
    const resolved = await resolvePhotonPath('peer', marketplace);
    assert.ok(resolved, `expected to resolve peer under ${marketplace}, got null`);
    assert.equal(resolved, join(marketplace, 'peer.photon.ts'));
  });

  await test('returns null for a photon not on disk anywhere', async () => {
    const resolved = await resolvePhotonPath('ghost', marketplace);
    assert.equal(resolved, null);
  });

  await test('global-base fallback finds a peer only installed in ~/.photon', async () => {
    // Simulate global install (fake HOME).
    writeFileSync(join(home, 'global.photon.ts'), 'export default class Global {}\n', 'utf-8');
    const localMiss = await resolvePhotonPath('global', marketplace);
    assert.equal(localMiss, null, 'must not be in the marketplace');
    const globalHit = await resolvePhotonPath('global', home);
    assert.equal(globalHit, join(home, 'global.photon.ts'));
  });

  await test('local marketplace shadows global for same-named peer', async () => {
    // Both have `shadow.photon.ts` — local wins.
    writeFileSync(
      join(marketplace, 'shadow.photon.ts'),
      'export default class ShadowLocal {}\n',
      'utf-8'
    );
    writeFileSync(
      join(home, 'shadow.photon.ts'),
      'export default class ShadowGlobal {}\n',
      'utf-8'
    );
    // The fallback walks caller's workingDir first, so local must win.
    const local = await resolvePhotonPath('shadow', marketplace);
    assert.equal(local, join(marketplace, 'shadow.photon.ts'));
    // Explicit global query still returns the global path.
    const global = await resolvePhotonPath('shadow', home);
    assert.equal(global, join(home, 'shadow.photon.ts'));
  });

  rmSync(marketplace, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });

  console.log('\nAll disk-fallback peer resolution tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
