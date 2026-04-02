/**
 * Systematic tests for .data/ consolidation
 *
 * Tests three layers:
 * 1. Migration — old layout → new .data/ layout
 * 2. Runtime — photon reads/writes go to correct .data/ paths
 * 3. Marketplace workflow — PHOTON_DIR + git remote = correct namespace
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

let passed = 0;
let failed = 0;
const only: string[] = []; // Set to test name(s) to run only those

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  if (only.length > 0 && !only.includes(name)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function makeTempDir(prefix = 'photon-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJSON(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readJSON(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. MIGRATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n1. Migration — old layout → .data/');

await test('migrates state files', async () => {
  const dir = makeTempDir();
  try {
    // Create old layout
    writeJSON(path.join(dir, 'state', 'todo', 'default.json'), { items: [1, 2, 3] });
    writeJSON(path.join(dir, 'state', 'todo', 'work.json'), { items: [4, 5] });
    writeFile(path.join(dir, 'state', 'todo', 'default.log'), 'log1\nlog2');

    // Create a dummy photon file so namespace detection works
    writeFile(path.join(dir, 'todo.photon.ts'), '// dummy');

    process.env.PHOTON_DIR = dir;
    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);
    delete process.env.PHOTON_DIR;

    // Verify new layout
    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'state', 'default', 'state.json')));
    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'state', 'work', 'state.json')));
    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'state', 'default', 'state.log')));

    // Verify data integrity
    const state = readJSON(
      path.join(dir, '.data', 'local', 'todo', 'state', 'default', 'state.json')
    );
    assert.deepEqual(state, { items: [1, 2, 3] });
  } finally {
    delete process.env.PHOTON_DIR;
    cleanup(dir);
  }
});

await test('migrates context files', async () => {
  const dir = makeTempDir();
  try {
    writeJSON(path.join(dir, 'context', 'todo.json'), { instance: 'work' });
    writeFile(path.join(dir, 'todo.photon.ts'), '// dummy');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'context.json')));
    const ctx = readJSON(path.join(dir, '.data', 'local', 'todo', 'context.json'));
    assert.equal(ctx.instance, 'work');
  } finally {
    cleanup(dir);
  }
});

await test('migrates env files', async () => {
  const dir = makeTempDir();
  try {
    writeJSON(path.join(dir, 'env', 'whatsapp.json'), { API_KEY: 'secret123' });
    writeFile(path.join(dir, 'whatsapp.photon.ts'), '// dummy');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    assert.ok(exists(path.join(dir, '.data', 'local', 'whatsapp', 'env.json')));
    const env = readJSON(path.join(dir, '.data', 'local', 'whatsapp', 'env.json'));
    assert.equal(env.API_KEY, 'secret123');
  } finally {
    cleanup(dir);
  }
});

await test('migrates memory (data/) files', async () => {
  const dir = makeTempDir();
  try {
    writeJSON(path.join(dir, 'data', 'todo', 'items.json'), ['buy milk']);
    writeJSON(path.join(dir, 'data', '_global', 'prefs.json'), { theme: 'dark' });
    writeFile(path.join(dir, 'todo.photon.ts'), '// dummy');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    // Per-photon memory
    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'memory', 'items.json')));
    const items = readJSON(path.join(dir, '.data', 'local', 'todo', 'memory', 'items.json'));
    assert.deepEqual(items, ['buy milk']);

    // Global memory
    assert.ok(exists(path.join(dir, '.data', '_global', 'prefs.json')));
  } finally {
    cleanup(dir);
  }
});

await test('migrates logs, cache, tasks, audit', async () => {
  const dir = makeTempDir();
  try {
    writeFile(path.join(dir, 'logs', 'todo', 'executions.jsonl'), '{"id":"exec_1"}');
    writeFile(path.join(dir, '.cache', 'marketplaces', 'portel.json'), '{}');
    writeJSON(path.join(dir, 'tasks', 'task_1.json'), { id: 'task_1' });
    writeFile(path.join(dir, 'audit.jsonl'), '{"event":"test"}');
    writeJSON(path.join(dir, '.metadata.json'), { photons: [] });
    writeFile(path.join(dir, 'todo.photon.ts'), '// dummy');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'logs', 'executions.jsonl')));
    assert.ok(exists(path.join(dir, '.data', '.cache', 'marketplaces', 'portel.json')));
    assert.ok(exists(path.join(dir, '.data', 'tasks', 'task_1.json')));
    assert.ok(exists(path.join(dir, '.data', 'audit.jsonl')));
    assert.ok(exists(path.join(dir, '.data', '.metadata.json')));
  } finally {
    cleanup(dir);
  }
});

await test('sentinel prevents re-running', async () => {
  const dir = makeTempDir();
  try {
    writeJSON(path.join(dir, 'state', 'todo', 'default.json'), { v: 1 });
    writeFile(path.join(dir, 'todo.photon.ts'), '// dummy');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    // Verify sentinel exists
    assert.ok(exists(path.join(dir, '.data', '.migrated')));

    // Modify the source — should NOT re-migrate
    writeJSON(path.join(dir, 'state', 'todo', 'default.json'), { v: 2 });
    await runDataMigration(dir);

    // Original migrated data should be unchanged (v: 1, not v: 2)
    const state = readJSON(
      path.join(dir, '.data', 'local', 'todo', 'state', 'default', 'state.json')
    );
    assert.equal(state.v, 1);
  } finally {
    cleanup(dir);
  }
});

await test('does not overwrite existing .data/ files', async () => {
  const dir = makeTempDir();
  try {
    // Create old AND new layout
    writeJSON(path.join(dir, 'state', 'todo', 'default.json'), { v: 'old' });
    writeJSON(path.join(dir, '.data', 'local', 'todo', 'state', 'default', 'state.json'), {
      v: 'new',
    });
    writeFile(path.join(dir, 'todo.photon.ts'), '// dummy');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    // New layout should be preserved, not overwritten
    const state = readJSON(
      path.join(dir, '.data', 'local', 'todo', 'state', 'default', 'state.json')
    );
    assert.equal(state.v, 'new');
  } finally {
    cleanup(dir);
  }
});

await test('no legacy dirs = just writes sentinel', async () => {
  const dir = makeTempDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Empty dir — no legacy data

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    assert.ok(exists(path.join(dir, '.data', '.migrated')));
  } finally {
    cleanup(dir);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. NAMESPACE DETECTION IN MIGRATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n2. Namespace detection during migration');

await test('marketplace git repo → uses owner as namespace', async () => {
  const dir = makeTempDir();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git remote add origin https://github.com/portel-dev/photons.git', {
      cwd: dir,
      stdio: 'ignore',
    });

    // Old layout data for a flat marketplace photon
    writeJSON(path.join(dir, 'state', 'slides', 'default.json'), { slide: 1 });
    writeFile(path.join(dir, 'slides.photon.ts'), '// flat marketplace photon');

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    // Should use 'portel-dev' as namespace (from git remote)
    assert.ok(
      exists(path.join(dir, '.data', 'portel-dev', 'slides', 'state', 'default', 'state.json')),
      'should use git remote owner as namespace'
    );
  } finally {
    cleanup(dir);
  }
});

await test('namespaced photon → preserves existing namespace', async () => {
  const dir = makeTempDir();
  try {
    // Photon in a namespace subdir
    writeFile(path.join(dir, 'my-org', 'todo.photon.ts'), '// namespaced');
    writeJSON(path.join(dir, 'state', 'todo', 'default.json'), { items: [] });

    const { runDataMigration } = await import('../src/data-migration.js');
    await runDataMigration(dir);

    // Should use 'my-org' namespace from the file location
    assert.ok(
      exists(path.join(dir, '.data', 'my-org', 'todo', 'state', 'default', 'state.json')),
      'should use photon file namespace'
    );
  } finally {
    cleanup(dir);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. RUNTIME PATH VERIFICATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n3. Runtime paths');

await test('MemoryProvider writes to .data/{ns}/{photon}/memory/', async () => {
  const dir = makeTempDir();
  try {
    process.env.PHOTON_DIR = dir;
    const { MemoryProvider } = await import('@portel/photon-core');
    const mem = new MemoryProvider('todo', undefined, 'local', dir);

    await mem.set('items', ['buy milk']);
    const result = await mem.get('items');
    assert.deepEqual(result, ['buy milk']);

    // Verify physical path
    assert.ok(exists(path.join(dir, '.data', 'local', 'todo', 'memory', 'items.json')));
  } finally {
    delete process.env.PHOTON_DIR;
    cleanup(dir);
  }
});

await test('MemoryProvider reads from legacy path as fallback', async () => {
  const dir = makeTempDir();
  try {
    // Write to legacy location
    writeJSON(path.join(dir, 'data', 'todo', 'items.json'), ['old data']);

    process.env.PHOTON_DIR = dir;
    const { MemoryProvider } = await import('@portel/photon-core');
    const mem = new MemoryProvider('todo', undefined, 'local', dir);

    const result = await mem.get('items');
    assert.deepEqual(result, ['old data']);
  } finally {
    delete process.env.PHOTON_DIR;
    cleanup(dir);
  }
});

await test('InstanceStore writes to .data/ and reads back', async () => {
  const dir = makeTempDir();
  try {
    const { InstanceStore } = await import('@portel/photon-core');
    const store = new InstanceStore('kanban', { baseDir: dir, namespace: 'local' });

    await store.save('work', { board: 'work-board' });
    const state = await store.load('work');
    assert.deepEqual(state, { board: 'work-board' });

    // Verify physical path
    assert.ok(exists(path.join(dir, '.data', 'local', 'kanban', 'state', 'work', 'state.json')));
  } finally {
    cleanup(dir);
  }
});

await test('InstanceStore reads from legacy state/ as fallback', async () => {
  const dir = makeTempDir();
  try {
    // Write to legacy location
    writeJSON(path.join(dir, 'state', 'kanban', 'default.json'), { legacy: true });

    const { InstanceStore } = await import('@portel/photon-core');
    const store = new InstanceStore('kanban', { baseDir: dir, namespace: 'local' });

    const state = await store.load('default');
    assert.deepEqual(state, { legacy: true });
  } finally {
    cleanup(dir);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. VERSION NOTIFY
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n4. Version notify');

await test('version cache written and read back', async () => {
  const dir = makeTempDir();
  try {
    process.env.PHOTON_DIR = dir;

    // Manually write a version cache
    const cachePath = path.join(dir, '.data', '.version-check.json');
    writeJSON(cachePath, {
      latest: '99.0.0',
      checkedAt: new Date().toISOString(),
    });

    // Verify it exists at the expected location
    assert.ok(exists(cachePath));
    const cache = readJSON(cachePath);
    assert.equal(cache.latest, '99.0.0');
  } finally {
    delete process.env.PHOTON_DIR;
    cleanup(dir);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GITIGNORE
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n5. Gitignore in marketplace repos');

await test('PHOTON_DIR git repo gets .data/ in .gitignore', async () => {
  const dir = makeTempDir();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    const photonDir = path.join(dir, 'my-photons');

    const { ensurePhotonDir } = await import('@portel/photon-core');
    await ensurePhotonDir(photonDir);

    const gitignore = fs.readFileSync(path.join(photonDir, '.gitignore'), 'utf-8');
    assert.ok(gitignore.includes('.data/'), '.gitignore should contain .data/');
    // Should NOT contain old scattered patterns
    assert.ok(!gitignore.includes('state/'), 'should not have old state/ pattern');
  } finally {
    cleanup(dir);
  }
});

// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));
if (failed > 0) process.exit(1);
