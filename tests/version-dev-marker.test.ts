/**
 * Regression test for the dev-build version marker.
 *
 * Agents and humans need to tell at a glance whether the photon binary
 * in PATH is the published tarball or the dev tree. Semver 2.0 build
 * metadata (`+sha.<short>`) makes it visible on `photon --version`.
 *
 * The marker appends only when a `.git` is reachable from the module
 * path — a fresh `npm install @portel/photon` has no `.git` anywhere
 * in its installed tree, so the marker stays empty there.
 */

import assert from 'node:assert/strict';
import { PHOTON_VERSION, IS_DEV_BUILD } from '../dist/version.js';

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

async function main() {
  console.log('Dev-build version marker:');

  await test('PHOTON_VERSION includes a +sha.<short> suffix when run from this git tree', () => {
    // The test is executed from the repo root which has a .git — the
    // marker must be present.
    assert.match(
      PHOTON_VERSION,
      /^\d+\.\d+\.\d+\+sha\.[0-9a-f]{7}$/,
      `expected semver + sha build-metadata, got: ${PHOTON_VERSION}`
    );
  });

  await test('IS_DEV_BUILD is true when the marker resolved', () => {
    assert.equal(IS_DEV_BUILD, true, 'dev build flag must be true when marker present');
  });

  await test('version still parses as semver (metadata is spec-legal)', () => {
    // Semver 2.0: build metadata after `+` is ignored for precedence
    // but is part of the full version string. Validate shape.
    const m = PHOTON_VERSION.match(/^(\d+)\.(\d+)\.(\d+)(\+[0-9a-zA-Z.-]+)?$/);
    assert.ok(m, `version must match semver 2.0 shape, got: ${PHOTON_VERSION}`);
  });

  await test('the semver base (pre-+) matches package.json version', async () => {
    const base = PHOTON_VERSION.split('+')[0];
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    assert.equal(base, pkg.version);
  });

  console.log('\nAll dev-build version marker tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
