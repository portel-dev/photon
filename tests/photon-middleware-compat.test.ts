/**
 * Verify photons with functional tags work with the middleware pipeline.
 * Uses self-contained fixtures — must not depend on PHOTON_DIR or any
 * photons outside the repo.
 * Run: npx tsx tests/photon-middleware-compat.test.ts
 */

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

// ─── @locked declarations ───

console.log('\n🧪 locked-compat photon (uses @locked)\n');

const lockedPhoton = await loader.loadFile('./tests/fixtures/locked-compat.photon.ts');

await test('loads successfully', async () => {
  if (!lockedPhoton) throw new Error('failed to load');
  if (lockedPhoton.tools.length === 0) throw new Error('no tools');
});

await test('bare @locked produces a locked middleware declaration', async () => {
  const critical = lockedPhoton.tools.find((t: any) => t.name === 'critical');
  if (!critical) throw new Error('critical tool not found');
  if (!critical.middleware || critical.middleware.length === 0)
    throw new Error('no middleware on critical');
  const locked = critical.middleware.find((m: any) => m.name === 'locked');
  if (!locked) throw new Error('no locked middleware found');
  // Bare @locked stores '' at schema level; the runtime defaults the lock
  // name to `${photon}:${method}` when the chain executes.
  if (locked.config.name !== '') {
    throw new Error(`expected empty schema-level lock name, got '${locked.config.name}'`);
  }
});

await test('@locked with custom name keeps that name', async () => {
  const sweep = lockedPhoton.tools.find((t: any) => t.name === 'sweep');
  if (!sweep) throw new Error('sweep tool not found');
  if (!sweep.middleware || sweep.middleware.length === 0) throw new Error('no middleware on sweep');
  const locked = sweep.middleware.find((m: any) => m.name === 'locked');
  if (!locked) throw new Error('no locked middleware found');
  if (locked.config.name !== 'board:write') {
    throw new Error(`expected lock name 'board:write', got '${locked.config.name}'`);
  }
});

await test('untagged method on the same photon has no middleware', async () => {
  const plain = lockedPhoton.tools.find((t: any) => t.name === 'plain');
  if (!plain) throw new Error('plain tool not found');
  if (plain.middleware && plain.middleware.length > 0)
    throw new Error(
      `unexpected middleware: ${plain.middleware.map((m: any) => m.name).join(', ')}`
    );
});

// ─── @locked execution through the pipeline ───

console.log('\n🧪 locked methods execute through the middleware chain\n');

await test('bare @locked method executes (lock acquired and released)', async () => {
  const result = await loader.executeTool(lockedPhoton, 'critical', {});
  if (!result?.ok) throw new Error('critical did not return ok');
});

await test('named @locked method executes', async () => {
  const result = await loader.executeTool(lockedPhoton, 'sweep', {});
  if (!result?.swept) throw new Error('sweep did not return swept');
});

// ─── Photons without functional tags get no middleware ───

console.log('\n🧪 Plain photons (no functional tags)\n');

const samplePhotons = [
  './tests/fixtures/plain-no-tags.photon.ts',
  './tests/fixtures/emit-helpers.photon.ts',
];

for (const p of samplePhotons) {
  const name = p.split('/').pop()!.replace('.photon.ts', '');
  await test(`${name} loads and has no middleware declarations`, async () => {
    const photon = await loader.loadFile(p);
    if (!photon) throw new Error('failed to load');
    const withMiddleware = photon.tools.filter((t: any) => t.middleware && t.middleware.length > 0);
    if (withMiddleware.length > 0) {
      throw new Error(
        `unexpected middleware on: ${withMiddleware.map((t: any) => t.name).join(', ')}`
      );
    }
  });
}

// ─── Summary ───

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
