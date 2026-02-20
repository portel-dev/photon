/**
 * Tests for extensible middleware runtime behavior
 * Run: npx tsx tests/middleware.test.ts
 */

import { strict as assert } from 'assert';
import { PhotonLoader } from '../src/loader.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${e.message || e}`);
    failed++;
  }
}

// ─── Custom middleware photon ───

console.log('\n🧪 Custom middleware: loading and discovery\n');

const loader = new PhotonLoader(false);
const photon = await loader.loadFile('./tests/fixtures/custom-middleware.photon.ts');

await test('loads photon with custom middleware', async () => {
  assert.ok(photon);
  assert.ok(photon.tools.length > 0);
});

await test('audited method has @use audit in middleware[]', async () => {
  const tool = photon.tools.find((t: any) => t.name === 'audited')!;
  assert.ok(tool.middleware);
  const audit = tool.middleware.find((m: any) => m.name === 'audit');
  assert.ok(audit);
  // Schema stores default phase 45 for custom middleware (definition's phase is resolved at runtime)
  assert.equal(audit!.phase, 45);
});

await test('cachedAudited has both custom and built-in middleware', async () => {
  const tool = photon.tools.find((t: any) => t.name === 'cachedAudited')!;
  assert.ok(tool.middleware);
  const names = tool.middleware.map((m: any) => m.name);
  assert.ok(names.includes('audit'));
  assert.ok(names.includes('cached'));
});

// ─── Custom middleware execution ───

console.log('\n🧪 Custom middleware: execution\n');

await test('custom audit middleware wraps result', async () => {
  const result = await loader.executeTool(photon, 'audited', { value: 'hello' });
  assert.equal(result.value, 'hello');
  assert.equal(result._auditLevel, 'debug');
});

await test('cached + custom audit work together', async () => {
  await loader.executeTool(photon, 'resetCounter', {});
  const r1 = await loader.executeTool(photon, 'cachedAudited', {});
  const r2 = await loader.executeTool(photon, 'cachedAudited', {});
  // Second call should be cached (same count)
  assert.equal(r1.count, r2.count);
  // Both should have audit wrapper applied
  assert.equal(r1._auditLevel, 'warn');
  assert.equal(r2._auditLevel, 'warn');
});

await test('multi middleware (custom + built-in) composes correctly', async () => {
  const result = await loader.executeTool(photon, 'multiMiddleware', {});
  assert.equal(result.ok, true);
  assert.equal(result._auditLevel, 'info');
});

// ─── Existing sugar tags still work through middleware pipeline ───

console.log('\n🧪 Sugar tags via middleware pipeline (backward compat)\n');

const existingPhoton = await loader.loadFile('./tests/fixtures/functional-tags.photon.ts');

await test('existing @cached still works via middleware pipeline', async () => {
  await loader.executeTool(existingPhoton, 'resetCounter', {});
  const r1 = await loader.executeTool(existingPhoton, 'cached', {});
  const r2 = await loader.executeTool(existingPhoton, 'cached', {});
  assert.equal(r1.value, r2.value);
});

await test('existing @timeout still throws PhotonTimeoutError', async () => {
  try {
    await loader.executeTool(existingPhoton, 'slow', {});
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonTimeoutError');
  }
});

await test('existing @validate still enforces rules', async () => {
  try {
    await loader.executeTool(existingPhoton, 'validated', {
      email: 'bad',
      amount: 42,
    });
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonValidationError');
  }
});

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
