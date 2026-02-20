/**
 * Tests for functional tag runtime enforcement
 * Run: npx tsx tests/functional-tags.test.ts
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

const loader = new PhotonLoader(false);
const photon = await loader.loadFile('./tests/fixtures/functional-tags.photon.ts');

// ─── Schema Extraction ───

console.log('\n🧪 Schema: functional tags in tool metadata\n');

await test('tools have correct functional tag metadata', async () => {
  const cached = photon.tools.find((t: any) => t.name === 'cached')!;
  assert.deepEqual(cached.cached, { ttl: 2000 });

  const retryable = photon.tools.find((t: any) => t.name === 'retryable')!;
  assert.deepEqual(retryable.retryable, { count: 2, delay: 100 });

  const slow = photon.tools.find((t: any) => t.name === 'slow')!;
  assert.deepEqual(slow.timeout, { ms: 200 });

  const throttled = photon.tools.find((t: any) => t.name === 'throttled')!;
  assert.deepEqual(throttled.throttled, { count: 3, windowMs: 1000 });

  const queued = photon.tools.find((t: any) => t.name === 'queued')!;
  assert.deepEqual(queued.queued, { concurrency: 1 });

  const validated = photon.tools.find((t: any) => t.name === 'validated')!;
  assert.ok(validated.validations);
  assert.equal(validated.validations.length, 2);

  const old = photon.tools.find((t: any) => t.name === 'oldMethod')!;
  assert.equal(old.deprecated, 'Use newMethod instead');
});

// ─── @cached ───

console.log('\n🧪 Runtime: @cached\n');

await test('returns cached result on second call', async () => {
  // Reset counter first
  await loader.executeTool(photon, 'resetCounter', {});
  const r1 = await loader.executeTool(photon, 'cached', {});
  const r2 = await loader.executeTool(photon, 'cached', {});
  assert.equal(r1.value, r2.value, 'second call should return cached result');
});

await test('cache expires after TTL', async () => {
  // Ensure previous cache has expired
  await new Promise((r) => setTimeout(r, 2200));
  await loader.executeTool(photon, 'resetCounter', {});
  const r1 = await loader.executeTool(photon, 'cached', {});
  // Wait for cache to expire (2s TTL + buffer)
  await new Promise((r) => setTimeout(r, 2200));
  const r2 = await loader.executeTool(photon, 'cached', {});
  assert.notEqual(r1.value, r2.value, 'should get fresh result after TTL');
});

// ─── @timeout ───

console.log('\n🧪 Runtime: @timeout\n');

await test('throws PhotonTimeoutError when method exceeds timeout', async () => {
  try {
    await loader.executeTool(photon, 'slow', {});
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonTimeoutError');
    assert.ok(e.message.includes('200ms'));
  }
});

// ─── @retryable ───

console.log('\n🧪 Runtime: @retryable\n');

await test('retries and ultimately throws on persistent failure', async () => {
  await loader.executeTool(photon, 'resetCounter', {});
  try {
    await loader.executeTool(photon, 'retryable', {});
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.ok(e.message.includes('always fails'));
  }
});

// ─── @throttled ───

console.log('\n🧪 Runtime: @throttled\n');

await test('allows calls within rate limit then rejects', async () => {
  // Wait for any previous throttle window to expire
  await new Promise((r) => setTimeout(r, 1100));

  // 3/s limit — first 3 should work
  await loader.executeTool(photon, 'throttled', {});
  await loader.executeTool(photon, 'throttled', {});
  await loader.executeTool(photon, 'throttled', {});

  // 4th should fail
  try {
    await loader.executeTool(photon, 'throttled', {});
    assert.fail('should have thrown rate limit error');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonRateLimitError');
    assert.ok(e.message.includes('exceeds'));
  }
});

await test('rate limit resets after window', async () => {
  await new Promise((r) => setTimeout(r, 1100));
  const r = await loader.executeTool(photon, 'throttled', {});
  assert.deepEqual(r, { ok: true });
});

// ─── @queued ───

console.log('\n🧪 Runtime: @queued\n');

await test('executes queued calls sequentially (concurrency 1)', async () => {
  const results = await Promise.all([
    loader.executeTool(photon, 'queued', { id: 'a' }),
    loader.executeTool(photon, 'queued', { id: 'b' }),
    loader.executeTool(photon, 'queued', { id: 'c' }),
  ]);
  assert.equal(results[0].id, 'a');
  assert.equal(results[1].id, 'b');
  assert.equal(results[2].id, 'c');
  // Each should finish after the previous (50ms sleep each)
  assert.ok(results[1].time >= results[0].time, 'b should finish after a');
  assert.ok(results[2].time >= results[1].time, 'c should finish after b');
});

// ─── @validate ───

console.log('\n🧪 Runtime: @validate\n');

await test('passes validation with correct params', async () => {
  const r = await loader.executeTool(photon, 'validated', {
    email: 'test@example.com',
    amount: 42,
  });
  assert.equal(r.email, 'test@example.com');
  assert.equal(r.amount, 42);
});

await test('fails validation for invalid email', async () => {
  try {
    await loader.executeTool(photon, 'validated', {
      email: 'not-an-email',
      amount: 42,
    });
    assert.fail('should have thrown validation error');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonValidationError');
    assert.ok(e.message.includes('email'));
  }
});

await test('fails validation for non-positive amount', async () => {
  try {
    await loader.executeTool(photon, 'validated', {
      email: 'test@example.com',
      amount: -5,
    });
    assert.fail('should have thrown validation error');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonValidationError');
    assert.ok(e.message.includes('amount'));
  }
});

await test('fails validation for zero amount (positive means > 0)', async () => {
  try {
    await loader.executeTool(photon, 'validated', {
      email: 'test@example.com',
      amount: 0,
    });
    assert.fail('should have thrown validation error');
  } catch (e: any) {
    assert.equal(e.name, 'PhotonValidationError');
    assert.ok(e.message.includes('amount'));
  }
});

// ─── @deprecated ───

console.log('\n🧪 Runtime: @deprecated\n');

await test('deprecated method still executes', async () => {
  const r = await loader.executeTool(photon, 'oldMethod', {});
  assert.deepEqual(r, { legacy: true });
});

await test('non-deprecated method has no deprecated field', async () => {
  const tool = photon.tools.find((t: any) => t.name === 'newMethod')!;
  assert.equal(tool.deprecated, undefined);
});

// ─── Combined tags ───

console.log('\n🧪 Runtime: combined tags\n');

await test('combined @cached + @timeout + @retryable works', async () => {
  await loader.executeTool(photon, 'resetCounter', {});
  const r1 = await loader.executeTool(photon, 'combined', {});
  const r2 = await loader.executeTool(photon, 'combined', {});
  // Second call should be cached (same count)
  assert.equal(r1.count, r2.count);
});

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
