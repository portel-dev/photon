/**
 * Tests for GitHub ref install (npx-style photon distribution)
 *
 * Tests the full flow: owner/repo[/photon-name] → marketplace add → install → ready to run
 *
 * Uses https://github.com/Arul-/photons as the real test target.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MarketplaceManager } from '../dist/marketplace-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-github-ref-test-'));
  return dir;
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function makeManager(dir: string): Promise<MarketplaceManager> {
  const manager = new MarketplaceManager(undefined, dir);
  await manager.initialize();
  return manager;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit: parseGitHubRef (tested via the CLI module's exported logic)
// We test the same regex rules by calling fetchAndInstallFromRef with bad input
// ─────────────────────────────────────────────────────────────────────────────

async function testParseValidation() {
  console.log('\n── parseGitHubRef validation ──');
  const dir = makeTempDir();
  try {
    const manager = await makeManager(dir);

    // Too many parts
    await assert.rejects(
      () => manager.fetchAndInstallFromRef('a/b/c/d', dir),
      /Invalid photon reference/,
      'Should reject 4-part ref'
    );
    console.log('✅ Rejects 4-part ref (a/b/c/d)');

    // Single segment (no slash)
    await assert.rejects(
      () => manager.fetchAndInstallFromRef('kanban', dir),
      /Invalid photon reference/,
      'Should reject ref with no slash'
    );
    console.log('✅ Rejects no-slash ref');
  } finally {
    cleanup(dir);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit: photon name resolution from ref
// ─────────────────────────────────────────────────────────────────────────────

async function testPhotonNameResolution() {
  console.log('\n── Photon name resolution ──');

  // owner/repo → photon name = repo
  // owner/repo/photon-name → photon name = photon-name
  // We verify indirectly by checking which file would be created

  const dir = makeTempDir();
  try {
    // Simulate what fetchAndInstallFromRef does: 2-part → photonName = repo
    // We can't call the real network here, but we can verify the existsSync fast path
    // by pre-creating the file and confirming alreadyInstalled is returned

    const manager = await makeManager(dir);

    // Pre-create photon file to simulate already-installed state
    fs.writeFileSync(path.join(dir, 'connect-four.photon.ts'), '// mock');

    const result = await manager.fetchAndInstallFromRef('Arul-/photons/connect-four', dir);
    assert.equal(result.photonName, 'connect-four', 'Should resolve photon name from 3-part ref');
    assert.equal(result.alreadyInstalled, true, 'Should detect already-installed');
    console.log('✅ 3-part ref: owner/repo/photon-name resolves to correct photon name');
    console.log('✅ Fast path: already-installed returns without network call');

    // Verify 2-part ref name resolution (owner/photon → photonName = photon = repo)
    fs.writeFileSync(path.join(dir, 'myrepo.photon.ts'), '// mock');
    const result2 = await manager.fetchAndInstallFromRef('Arul-/myrepo', dir);
    assert.equal(
      result2.photonName,
      'myrepo',
      'Should resolve photon name from 2-part ref (= repo)'
    );
    assert.equal(result2.alreadyInstalled, true, 'Should detect already-installed');
    console.log('✅ 2-part ref: owner/repo resolves photon name = repo name');
  } finally {
    cleanup(dir);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration: real network fetch from Arul-/photons
// ─────────────────────────────────────────────────────────────────────────────

async function testRealInstallThreePart() {
  console.log('\n── Real install: Arul-/photons/connect-four (3-part ref) ──');
  const dir = makeTempDir();
  try {
    const manager = await makeManager(dir);

    const { photonName, alreadyInstalled } = await manager.fetchAndInstallFromRef(
      'Arul-/photons/connect-four',
      dir
    );

    assert.equal(photonName, 'connect-four', 'Resolved name should be connect-four');
    assert.equal(alreadyInstalled, false, 'Fresh install should not be already-installed');

    const installedPath = path.join(dir, 'connect-four.photon.ts');
    assert.ok(fs.existsSync(installedPath), 'Photon file should be written to disk');

    const content = fs.readFileSync(installedPath, 'utf-8');
    assert.ok(content.length > 100, 'Installed file should have real content');
    assert.ok(content.includes('class') || content.includes('export'), 'Should be valid TS source');
    assert.ok(content.includes('@forkedFrom'), 'Should have @forkedFrom tag injected');
    console.log(`✅ Installed connect-four (${content.length} bytes)`);
    console.log(`✅ @forkedFrom tag present`);

    // Verify marketplace was registered
    const marketplaces = manager.getAll();
    const registered = marketplaces.find((m) => m.repo === 'Arul-/photons');
    assert.ok(registered, 'Marketplace should be registered in config');
    assert.ok(fs.existsSync(path.join(dir, 'marketplaces.json')), 'marketplaces.json should exist');
    console.log(`✅ Marketplace Arul-/photons registered`);
  } finally {
    cleanup(dir);
  }
}

async function testRealInstallTwoPart() {
  console.log('\n── Real install: Arul-/photons (2-part ref → photonName = photons) ──');
  // 2-part: owner/repo where photon name = repo name
  // Arul-/photons would look for "photons.photon.ts" which likely doesn't exist
  // so this should fail gracefully with a clear error
  const dir = makeTempDir();
  try {
    const manager = await makeManager(dir);

    await assert.rejects(
      () => manager.fetchAndInstallFromRef('Arul-/photons', dir),
      /Could not fetch photon 'photons' from Arul-\/photons/,
      'Should fail with clear error when photon file not found in repo'
    );
    console.log('✅ 2-part ref with missing photon file gives clear error');

    // Marketplace should still be registered (add succeeded before fetch failed)
    const marketplaces = manager.getAll();
    const registered = marketplaces.find((m) => m.repo === 'Arul-/photons');
    assert.ok(registered, 'Marketplace should still be registered even if photon fetch fails');
    console.log('✅ Marketplace registered even when photon file not found');
  } finally {
    cleanup(dir);
  }
}

async function testIdempotentInstall() {
  console.log('\n── Idempotency: install same photon twice ──');
  const dir = makeTempDir();
  try {
    const manager = await makeManager(dir);

    // First install
    const first = await manager.fetchAndInstallFromRef('Arul-/photons/lg-remote', dir);
    assert.equal(first.alreadyInstalled, false, 'First install should not be already-installed');
    assert.ok(
      fs.existsSync(path.join(dir, 'lg-remote.photon.ts')),
      'File should exist after first install'
    );
    console.log('✅ First install: downloaded from GitHub');

    // Record file mtime to verify no re-write on second call
    const firstMtime = fs.statSync(path.join(dir, 'lg-remote.photon.ts')).mtimeMs;

    // Small delay to ensure mtime would differ if file were rewritten
    await new Promise((r) => setTimeout(r, 50));

    // Second install — should use fast path
    const second = await manager.fetchAndInstallFromRef('Arul-/photons/lg-remote', dir);
    assert.equal(second.alreadyInstalled, true, 'Second install should detect already-installed');
    assert.equal(second.photonName, 'lg-remote', 'Should still return correct photon name');

    const secondMtime = fs.statSync(path.join(dir, 'lg-remote.photon.ts')).mtimeMs;
    assert.equal(firstMtime, secondMtime, 'File should NOT be rewritten on second install');
    console.log('✅ Second install: fast path (existsSync), no network call, file unchanged');

    // Verify marketplace not duplicated
    const marketplaces = manager.getAll();
    const matches = marketplaces.filter((m) => m.repo === 'Arul-/photons');
    assert.equal(matches.length, 1, 'Marketplace should not be duplicated');
    console.log('✅ Marketplace registered exactly once');
  } finally {
    cleanup(dir);
  }
}

async function testMetadataTracking() {
  console.log('\n── Metadata tracking after install ──');
  const dir = makeTempDir();
  try {
    const manager = await makeManager(dir);

    await manager.fetchAndInstallFromRef('Arul-/photons/connect-four', dir);

    // Check .metadata.json was written
    const metaPath = path.join(dir, '.metadata.json');
    assert.ok(fs.existsSync(metaPath), '.metadata.json should be written');

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.ok(meta.photons['connect-four.photon.ts'], 'Should track connect-four.photon.ts');

    const photonMeta = meta.photons['connect-four.photon.ts'];
    assert.equal(photonMeta.marketplaceRepo, 'Arul-/photons', 'Should record marketplace repo');
    assert.ok(photonMeta.installedAt, 'Should record installedAt timestamp');
    assert.ok(photonMeta.originalHash, 'Should record content hash for update detection');
    // When no .marketplace/photons.json exists in the repo, version is 'unknown'
    assert.ok(
      photonMeta.version === 'unknown' || /^\d+\.\d+/.test(photonMeta.version),
      'Version should be semver or "unknown"'
    );
    console.log('✅ .metadata.json written with marketplace, timestamp, and hash');
    console.log(`✅ Version: ${photonMeta.version} (unknown = no manifest in repo)`);
  } finally {
    cleanup(dir);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI integration: verify preprocessArgs routes GitHub refs correctly
// ─────────────────────────────────────────────────────────────────────────────

async function testCLIInstallAndRun() {
  console.log('\n── CLI: install and invoke via GitHub ref ──');
  const dir = makeTempDir();
  try {
    // Install first using manager directly (same as CLI would)
    const manager = await makeManager(dir);
    await manager.fetchAndInstallFromRef('Arul-/photons/connect-four', dir);

    // Now verify the CLI can find and invoke the photon
    const { execSync } = await import('child_process');

    // List the photon — it should appear in `photon list`
    const listOutput = execSync(`node dist/cli.js list 2>&1`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: { ...process.env, PHOTON_DIR: dir },
    });
    assert.ok(listOutput.includes('connect-four'), 'Installed photon should appear in photon list');
    console.log('✅ Photon appears in `photon list` after GitHub ref install');

    // Verify CLI GitHub ref detection: photon Arul-/photons/connect-four should
    // detect it as already installed and run without re-fetching
    const startTime = Date.now();
    try {
      // Request help from the photon to verify it loads correctly
      execSync(`node dist/cli.js Arul-/photons/connect-four --help 2>&1`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 10000,
        env: { ...process.env, PHOTON_DIR: dir },
      });
    } catch (e: any) {
      // --help may exit non-zero but we just want to confirm it ran, not errored on install
      const output = e.stdout + e.stderr;
      assert.ok(
        !output.includes('Could not fetch photon') && !output.includes('Invalid photon reference'),
        `Should not fail on install step, got: ${output.slice(0, 300)}`
      );
    }
    const elapsed = Date.now() - startTime;
    // Fast path should complete well under 3s (no network call)
    assert.ok(elapsed < 3000, `Already-installed fast path should be fast, took ${elapsed}ms`);
    console.log(`✅ Already-installed fast path: ${elapsed}ms (no network call)`);
  } finally {
    cleanup(dir);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('🧪 GitHub Ref Install Tests (Arul-/photons)\n');
  console.log('   Tests: parse validation, name resolution, real network fetch,');
  console.log('          idempotency, metadata tracking, CLI integration\n');

  const tests = [
    { name: 'Parse validation', fn: testParseValidation },
    { name: 'Photon name resolution', fn: testPhotonNameResolution },
    { name: 'Real install (3-part ref)', fn: testRealInstallThreePart },
    { name: 'Real install (2-part ref, missing file)', fn: testRealInstallTwoPart },
    { name: 'Idempotent install', fn: testIdempotentInstall },
    { name: 'Metadata tracking', fn: testMetadataTracking },
    { name: 'CLI install and run', fn: testCLIInstallAndRun },
  ];

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`\n❌ FAILED: ${name}`);
      console.error(err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  if (failed === 0) {
    console.log(`✅ All ${passed} test groups passed`);
  } else {
    console.log(`❌ ${failed} failed, ${passed} passed`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
