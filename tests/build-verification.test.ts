/**
 * Build Verification Tests
 *
 * Ensures the build output (dist/) exposes everything it should:
 * - CLI binary is executable with correct shebang
 * - All expected modules exist with both .js and .d.ts
 * - Main entry exports resolve
 * - CLI commands are all present
 * - Bundled photons and templates ship
 * - Beam UI bundle and HTML exist
 * - Submodule directories (async, daemon, shared, serv, deploy) are complete
 *
 * Run AFTER `npm run build` — this tests the artifact, not the source.
 */

import { strict as assert } from 'assert';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

const DIST = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '..',
  'dist'
);
const ROOT = path.resolve(DIST, '..');

function fileExists(relativePath: string): boolean {
  return existsSync(path.join(DIST, relativePath));
}

function rootExists(relativePath: string): boolean {
  return existsSync(path.join(ROOT, relativePath));
}

// ══════════════════════════════════════════════════════════════════════
// Pre-check: dist/ must exist
// ══════════════════════════════════════════════════════════════════════

if (!existsSync(DIST)) {
  console.error('\n  dist/ not found. Run `npm run build` first.\n');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════
// CLI Binary
// ══════════════════════════════════════════════════════════════════════

async function testCliBinary() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  CLI Binary');
  console.log(`${'═'.repeat(60)}`);

  await test('dist/cli.js exists', () => {
    assert.ok(fileExists('cli.js'), 'cli.js missing from dist/');
  });

  await test('cli.js has node shebang', () => {
    const content = readFileSync(path.join(DIST, 'cli.js'), 'utf-8');
    assert.ok(content.startsWith('#!/usr/bin/env node'), 'Missing shebang line');
  });

  await test('cli.js is executable (755)', () => {
    const stat = statSync(path.join(DIST, 'cli.js'));
    const mode = (stat.mode & 0o777).toString(8);
    assert.ok(
      mode === '755' || mode === '775' || mode === '777',
      `Expected executable, got ${mode}`
    );
  });

  await test('cli.js imports cli/index.js', () => {
    const content = readFileSync(path.join(DIST, 'cli.js'), 'utf-8');
    assert.ok(content.includes('./cli/index.js'), 'cli.js should delegate to cli/index.js');
  });
}

// ══════════════════════════════════════════════════════════════════════
// Top-Level Module Exports
// ══════════════════════════════════════════════════════════════════════

async function testTopLevelModules() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Top-Level Modules');
  console.log(`${'═'.repeat(60)}`);

  // Every module that consumers import from @portel/photon
  const requiredModules = [
    'index',
    'loader',
    'server',
    'embedded-runtime',
    'photon-doc-extractor',
    'photon-cli-runner',
    'cli-formatter',
    'cli-alias',
    'context',
    'context-store',
    'marketplace-manager',
    'mcp-client',
    'mcp-elicitation',
    'path-resolver',
    'security-scanner',
    'shared-utils',
    'shell-completions',
    'template-manager',
    'test-client',
    'test-runner',
    'testing',
    'version',
    'version-checker',
    'watcher',
    'markdown-utils',
    'claude-code-plugin',
    'readme-syncer',
    'namespace-migration',
  ];

  for (const mod of requiredModules) {
    await test(`${mod}.js exists`, () => {
      assert.ok(fileExists(`${mod}.js`), `${mod}.js missing`);
    });
  }

  await test('all top-level modules have declaration files', () => {
    const missing: string[] = [];
    for (const mod of requiredModules) {
      if (!fileExists(`${mod}.d.ts`)) {
        missing.push(mod);
      }
    }
    assert.equal(missing.length, 0, `Missing .d.ts for: ${missing.join(', ')}`);
  });
}

// ══════════════════════════════════════════════════════════════════════
// Main Entry Exports
// ══════════════════════════════════════════════════════════════════════

async function testMainEntry() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Main Entry (index.js)');
  console.log(`${'═'.repeat(60)}`);

  await test('index.js re-exports photon-core', () => {
    const content = readFileSync(path.join(DIST, 'index.js'), 'utf-8');
    assert.ok(
      content.includes('@portel/photon-core') || content.includes('photon-core'),
      'index.js should re-export from photon-core'
    );
  });

  await test('index.js exports PhotonLoader', () => {
    const content = readFileSync(path.join(DIST, 'index.js'), 'utf-8');
    assert.ok(content.includes('PhotonLoader'), 'Missing PhotonLoader export');
  });

  await test('index.js exports PhotonServer', () => {
    const content = readFileSync(path.join(DIST, 'index.js'), 'utf-8');
    assert.ok(content.includes('PhotonServer'), 'Missing PhotonServer export');
  });

  await test('index.js exports PhotonDocExtractor', () => {
    const content = readFileSync(path.join(DIST, 'index.js'), 'utf-8');
    assert.ok(content.includes('PhotonDocExtractor'), 'Missing PhotonDocExtractor export');
  });

  await test('index.js exports EmbeddedRuntime', () => {
    const content = readFileSync(path.join(DIST, 'index.js'), 'utf-8');
    assert.ok(content.includes('EmbeddedRuntime'), 'Missing EmbeddedRuntime export');
  });

  await test('index.d.ts has type declarations', () => {
    const content = readFileSync(path.join(DIST, 'index.d.ts'), 'utf-8');
    assert.ok(content.includes('PhotonLoader'), 'Missing PhotonLoader type declaration');
    assert.ok(content.includes('PhotonServer'), 'Missing PhotonServer type declaration');
  });
}

// ══════════════════════════════════════════════════════════════════════
// CLI Commands
// ══════════════════════════════════════════════════════════════════════

async function testCliCommands() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  CLI Commands');
  console.log(`${'═'.repeat(60)}`);

  const expectedCommands = [
    'alias',
    'audit',
    'beam',
    'build',
    'config',
    'daemon',
    'doctor',
    'host',
    'info',
    'init',
    'maker',
    'marketplace',
    'mcp',
    'package',
    'package-app',
    'run',
    'search',
    'serve',
    'test',
    'update',
  ];

  await test('cli/index.js exists', () => {
    assert.ok(fileExists('cli/index.js'), 'cli/index.js missing');
  });

  for (const cmd of expectedCommands) {
    await test(`command: ${cmd}`, () => {
      assert.ok(fileExists(`cli/commands/${cmd}.js`), `cli/commands/${cmd}.js missing`);
    });
  }

  await test('all commands have declaration files', () => {
    const missing: string[] = [];
    for (const cmd of expectedCommands) {
      if (!fileExists(`cli/commands/${cmd}.d.ts`)) {
        missing.push(cmd);
      }
    }
    assert.equal(missing.length, 0, `Missing .d.ts for commands: ${missing.join(', ')}`);
  });

  await test('cli/index.js imports all command registrations', () => {
    const content = readFileSync(path.join(DIST, 'cli/index.js'), 'utf-8');
    // Check that the main CLI file registers key commands
    for (const cmd of ['mcp', 'beam', 'run', 'daemon', 'test', 'marketplace']) {
      assert.ok(content.includes(cmd), `cli/index.js should reference ${cmd} command`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// Submodule Directories
// ══════════════════════════════════════════════════════════════════════

async function testSubmodules() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Submodule Directories');
  console.log(`${'═'.repeat(60)}`);

  // async/
  await test('async/ has dedup-map, loading-gate, with-timeout', () => {
    for (const mod of ['dedup-map', 'loading-gate', 'with-timeout', 'index']) {
      assert.ok(fileExists(`async/${mod}.js`), `async/${mod}.js missing`);
      assert.ok(fileExists(`async/${mod}.d.ts`), `async/${mod}.d.ts missing`);
    }
  });

  // daemon/
  await test('daemon/ has client, server, protocol, manager, session-manager', () => {
    for (const mod of ['client', 'server', 'protocol', 'manager', 'session-manager']) {
      assert.ok(fileExists(`daemon/${mod}.js`), `daemon/${mod}.js missing`);
    }
  });

  await test('daemon/ has worker modules', () => {
    for (const mod of ['worker-host', 'worker-manager', 'worker-protocol']) {
      assert.ok(fileExists(`daemon/${mod}.js`), `daemon/${mod}.js missing`);
    }
  });

  // shared/
  await test('shared/ has logger, error-handler, audit, validation', () => {
    for (const mod of ['logger', 'error-handler', 'audit', 'validation']) {
      assert.ok(fileExists(`shared/${mod}.js`), `shared/${mod}.js missing`);
    }
  });

  // serv/
  await test('serv/ directory exists with index', () => {
    assert.ok(fileExists('serv/index.js'), 'serv/index.js missing');
  });

  await test('serv/ has sub-directories', () => {
    for (const sub of ['auth', 'db', 'middleware', 'runtime', 'session', 'vault', 'types']) {
      const dir = path.join(DIST, 'serv', sub);
      assert.ok(existsSync(dir), `serv/${sub}/ missing`);
    }
  });

  // deploy/
  await test('deploy/ has cloudflare module', () => {
    assert.ok(fileExists('deploy/cloudflare.js'), 'deploy/cloudflare.js missing');
  });
}

// ══════════════════════════════════════════════════════════════════════
// Beam UI Bundle
// ══════════════════════════════════════════════════════════════════════

async function testBeamBundle() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Beam UI Bundle');
  console.log(`${'═'.repeat(60)}`);

  await test('beam.bundle.js exists', () => {
    assert.ok(fileExists('beam.bundle.js'), 'beam.bundle.js missing');
  });

  await test('beam.bundle.js is non-trivial (>100KB)', () => {
    const stat = statSync(path.join(DIST, 'beam.bundle.js'));
    assert.ok(stat.size > 100_000, `beam.bundle.js too small: ${stat.size} bytes`);
  });

  await test('beam.bundle.js.map exists', () => {
    assert.ok(fileExists('beam.bundle.js.map'), 'Source map missing');
  });

  await test('frontend/index.html exists', () => {
    assert.ok(fileExists('auto-ui/frontend/index.html'), 'Beam UI HTML missing');
  });

  await test('frontend/index.html references beam.bundle.js', () => {
    const html = readFileSync(path.join(DIST, 'auto-ui/frontend/index.html'), 'utf-8');
    assert.ok(
      html.includes('beam.bundle') || html.includes('main.js') || html.includes('<script'),
      'index.html should reference a script bundle'
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// Bundled Photons
// ══════════════════════════════════════════════════════════════════════

async function testBundledPhotons() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Bundled Photons');
  console.log(`${'═'.repeat(60)}`);

  const photons = ['maker', 'marketplace', 'tunnel'];

  for (const name of photons) {
    await test(`${name}.photon.ts source included`, () => {
      assert.ok(fileExists(`photons/${name}.photon.ts`), `${name}.photon.ts missing`);
    });

    await test(`${name}.photon.js compiled`, () => {
      assert.ok(fileExists(`photons/${name}.photon.js`), `${name}.photon.js missing`);
    });

    await test(`${name}.photon.d.ts declarations`, () => {
      assert.ok(fileExists(`photons/${name}.photon.d.ts`), `${name}.photon.d.ts missing`);
    });
  }
}

// ══════════════════════════════════════════════════════════════════════
// Templates
// ══════════════════════════════════════════════════════════════════════

async function testTemplates() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Templates');
  console.log(`${'═'.repeat(60)}`);

  await test('templates/ directory exists', () => {
    assert.ok(rootExists('templates'), 'templates/ missing');
  });

  await test('photon.template.ts exists', () => {
    assert.ok(rootExists('templates/photon.template.ts'), 'photon.template.ts missing');
  });

  await test('cloudflare deploy template exists', () => {
    assert.ok(rootExists('templates/cloudflare'), 'templates/cloudflare/ missing');
  });
}

// ══════════════════════════════════════════════════════════════════════
// Dynamic Import Verification
// ══════════════════════════════════════════════════════════════════════

async function testDynamicImports() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Dynamic Import Verification');
  console.log(`${'═'.repeat(60)}`);

  await test('index.js is importable', async () => {
    const mod = await import(path.join(DIST, 'index.js'));
    assert.ok(mod, 'Failed to import index.js');
    // Should have PhotonLoader from the re-exports
    assert.ok(typeof mod.PhotonLoader === 'function', 'PhotonLoader not a constructor');
  });

  await test('PhotonServer is importable', async () => {
    const mod = await import(path.join(DIST, 'server.js'));
    assert.ok(typeof mod.PhotonServer === 'function', 'PhotonServer not a constructor');
  });

  await test('PhotonDocExtractor is importable', async () => {
    const mod = await import(path.join(DIST, 'photon-doc-extractor.js'));
    assert.ok(typeof mod.PhotonDocExtractor === 'function', 'PhotonDocExtractor not a constructor');
  });

  await test('async primitives are importable', async () => {
    const mod = await import(path.join(DIST, 'async/index.js'));
    assert.ok(typeof mod.DedupMap === 'function', 'DedupMap not exported');
    assert.ok(typeof mod.LoadingGate === 'function', 'LoadingGate not exported');
  });

  await test('daemon protocol is importable', async () => {
    const mod = await import(path.join(DIST, 'daemon/protocol.js'));
    assert.ok(typeof mod.isValidDaemonRequest === 'function', 'isValidDaemonRequest not exported');
    assert.ok(
      typeof mod.isValidDaemonResponse === 'function',
      'isValidDaemonResponse not exported'
    );
  });

  await test('version exports PHOTON_VERSION string', async () => {
    const mod = await import(path.join(DIST, 'version.js'));
    assert.ok(typeof mod.PHOTON_VERSION === 'string', 'PHOTON_VERSION not a string');
    assert.ok(mod.PHOTON_VERSION.length > 0, 'PHOTON_VERSION is empty');
  });

  await test('parseCliArgs is importable from cli-runner', async () => {
    const mod = await import(path.join(DIST, 'photon-cli-runner.js'));
    assert.ok(typeof mod.parseCliArgs === 'function', 'parseCliArgs not exported');
  });

  await test('EmbeddedRuntime is importable', async () => {
    const mod = await import(path.join(DIST, 'embedded-runtime.js'));
    assert.ok(typeof mod.EmbeddedRuntime === 'function', 'EmbeddedRuntime not a constructor');
  });

  await test('shared logger is importable', async () => {
    const mod = await import(path.join(DIST, 'shared/logger.js'));
    assert.ok(mod.logger || mod.createLogger, 'Logger not exported');
  });

  await test('beam class-metadata functions are importable', async () => {
    const mod = await import(path.join(DIST, 'auto-ui/beam/class-metadata.js'));
    assert.ok(
      typeof mod.extractClassMetadataFromSource === 'function',
      'extractClassMetadataFromSource not exported'
    );
    assert.ok(typeof mod.prettifyName === 'function', 'prettifyName not exported');
  });
}

// ══════════════════════════════════════════════════════════════════════
// Package.json Integrity
// ══════════════════════════════════════════════════════════════════════

async function testPackageJson() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Package.json Integrity');
  console.log(`${'═'.repeat(60)}`);

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  await test('main points to dist/index.js', () => {
    assert.equal(pkg.main, 'dist/index.js');
  });

  await test('bin.photon points to dist/cli.js', () => {
    assert.equal(pkg.bin?.photon, 'dist/cli.js');
  });

  await test('type is module', () => {
    assert.equal(pkg.type, 'module');
  });

  await test('files includes dist and templates', () => {
    assert.ok(pkg.files?.includes('dist'), '"dist" missing from files');
    assert.ok(pkg.files?.includes('templates'), '"templates" missing from files');
  });

  await test('no file: dependencies', () => {
    const deps = JSON.stringify(pkg.dependencies || {});
    assert.ok(!deps.includes('file:'), 'file: dependency found — cannot publish');
  });

  await test('version follows semver', () => {
    assert.ok(/^\d+\.\d+\.\d+/.test(pkg.version), `Invalid version: ${pkg.version}`);
  });

  await test('name is @portel/photon', () => {
    assert.equal(pkg.name, '@portel/photon');
  });
}

// ══════════════════════════════════════════════════════════════════════
// No Stale or Missing Source Maps
// ══════════════════════════════════════════════════════════════════════

async function testSourceMaps() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Source Maps');
  console.log(`${'═'.repeat(60)}`);

  await test('index.js has source map', () => {
    assert.ok(fileExists('index.js.map'), 'index.js.map missing');
  });

  await test('loader.js has source map', () => {
    assert.ok(fileExists('loader.js.map'), 'loader.js.map missing');
  });

  await test('server.js has source map', () => {
    assert.ok(fileExists('server.js.map'), 'server.js.map missing');
  });

  await test('.js files reference their source maps', () => {
    const content = readFileSync(path.join(DIST, 'index.js'), 'utf-8');
    assert.ok(
      content.includes('//# sourceMappingURL='),
      'index.js missing sourceMappingURL comment'
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║            BUILD VERIFICATION TESTS                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testCliBinary();
  await testTopLevelModules();
  await testMainEntry();
  await testCliCommands();
  await testSubmodules();
  await testBeamBundle();
  await testBundledPhotons();
  await testTemplates();
  await testDynamicImports();
  await testPackageJson();
  await testSourceMaps();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All build verification tests passed!\n');
})();
