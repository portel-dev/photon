/**
 * Beam Config Tests
 *
 * Tests the 4 exported functions from src/auto-ui/beam/config.ts:
 * getConfigFilePath, migrateConfig, loadConfig, saveConfig
 */

import { strict as assert } from 'assert';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  getConfigFilePath,
  migrateConfig,
  loadConfig,
  saveConfig,
} from '../src/auto-ui/beam/config.js';

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

// ── Helpers ─────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'beam-config-test-'));
}

async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ── getConfigFilePath ───────────────────────────────────────────────────────

async function testGetConfigFilePath() {
  console.log('\n  getConfigFilePath');

  await test('default: returns path.join(workingDir, config.json)', () => {
    const result = getConfigFilePath('/some/dir');
    assert.equal(result, path.join('/some/dir', 'config.json'));
  });

  await test('with PHOTON_CONFIG_FILE env var: returns env var value', () => {
    const original = process.env.PHOTON_CONFIG_FILE;
    try {
      process.env.PHOTON_CONFIG_FILE = '/custom/path/my-config.json';
      const result = getConfigFilePath('/some/dir');
      assert.equal(result, '/custom/path/my-config.json');
    } finally {
      if (original === undefined) {
        delete process.env.PHOTON_CONFIG_FILE;
      } else {
        process.env.PHOTON_CONFIG_FILE = original;
      }
    }
  });
}

// ── migrateConfig ───────────────────────────────────────────────────────────

async function testMigrateConfig() {
  console.log('\n  migrateConfig');

  await test('already new format (has photons key): returns as-is', () => {
    const config = { photons: { foo: {} }, mcpServers: { bar: {} } };
    const result = migrateConfig(config);
    assert.deepEqual(result, { photons: { foo: {} }, mcpServers: { bar: {} } });
  });

  await test('already new format with only mcpServers key: returns as-is', () => {
    const config = { mcpServers: { bar: {} } };
    const result = migrateConfig(config);
    assert.deepEqual(result, { photons: {}, mcpServers: { bar: {} } });
  });

  await test('old flat format: wraps in { photons, mcpServers }', () => {
    const config = { myPhoton: { path: '/foo' }, other: { path: '/bar' } };
    const result = migrateConfig(config);
    assert.deepEqual(result, {
      photons: { myPhoton: { path: '/foo' }, other: { path: '/bar' } },
      mcpServers: {},
    });
  });

  await test('empty mcpServers added if missing from new format', () => {
    const config = { photons: { a: {} } };
    const result = migrateConfig(config);
    assert.deepEqual(result, { photons: { a: {} }, mcpServers: {} });
  });
}

// ── loadConfig ──────────────────────────────────────────────────────────────

async function testLoadConfig() {
  console.log('\n  loadConfig');

  await test('missing file returns default { photons: {}, mcpServers: {} }', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const result = await loadConfig(tmpDir);
      assert.deepEqual(result, { photons: {}, mcpServers: {} });
    } finally {
      await cleanupDir(tmpDir);
    }
  });

  await test('valid JSON with new format returns it', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const config = { photons: { x: { path: '/x' } }, mcpServers: { s: {} } };
      await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(config));
      const result = await loadConfig(tmpDir);
      assert.deepEqual(result, config);
    } finally {
      await cleanupDir(tmpDir);
    }
  });

  await test('valid JSON with old format migrates it', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const oldConfig = { myPhoton: { path: '/foo' } };
      await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(oldConfig));
      const result = await loadConfig(tmpDir);
      assert.deepEqual(result, {
        photons: { myPhoton: { path: '/foo' } },
        mcpServers: {},
      });
    } finally {
      await cleanupDir(tmpDir);
    }
  });
}

// ── saveConfig ──────────────────────────────────────────────────────────────

async function testSaveConfig() {
  console.log('\n  saveConfig');

  await test('writes config.json to disk, reads back and verifies', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const config = { photons: { a: { path: '/a' } }, mcpServers: { b: {} } };
      await saveConfig(config, tmpDir);
      const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.deepEqual(parsed, config);
    } finally {
      await cleanupDir(tmpDir);
    }
  });
}

// ── Runner ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    BEAM CONFIG TESTS                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testGetConfigFilePath();
  await testMigrateConfig();
  await testLoadConfig();
  await testSaveConfig();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All beam config tests passed!\n');
})();
