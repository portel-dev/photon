/**
 * Verify existing photons with functional tags work with the new middleware pipeline
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

// ─── daemon-features (@locked) ───

console.log('\n🧪 daemon-features photon (uses @locked)\n');

await test('loads successfully', async () => {
  const photon = await loader.loadFile('/Users/arul/Projects/photons/daemon-features.photon.ts');
  if (!photon) throw new Error('failed to load');
  if (photon.tools.length === 0) throw new Error('no tools');
});

await test('critical method has @locked middleware declaration', async () => {
  const photon = await loader.loadFile('/Users/arul/Projects/photons/daemon-features.photon.ts');
  const critical = photon.tools.find((t: any) => t.name === 'critical');
  if (!critical) throw new Error('critical tool not found');
  if (!critical.middleware || critical.middleware.length === 0)
    throw new Error('no middleware on critical');
  const locked = critical.middleware.find((m: any) => m.name === 'locked');
  if (!locked) throw new Error('no locked middleware found');
  if (locked.config.name !== 'daemon-features:critical') {
    throw new Error(`expected lock name 'daemon-features:critical', got '${locked.config.name}'`);
  }
});

// ─── kanban (@locked) ───

console.log('\n🧪 kanban photon (uses @locked)\n');

await test('loads successfully', async () => {
  const photon = await loader.loadFile('/Users/arul/Projects/photons/kanban.photon.ts');
  if (!photon) throw new Error('failed to load');
  if (photon.tools.length === 0) throw new Error('no tools');
});

await test('sweep method has @locked middleware declaration', async () => {
  const photon = await loader.loadFile('/Users/arul/Projects/photons/kanban.photon.ts');
  const sweep = photon.tools.find((t: any) => t.name === 'sweep');
  if (!sweep) throw new Error('sweep tool not found');
  if (!sweep.middleware || sweep.middleware.length === 0) throw new Error('no middleware on sweep');
  const locked = sweep.middleware.find((m: any) => m.name === 'locked');
  if (!locked) throw new Error('no locked middleware found');
  if (locked.config.name !== 'board:write') {
    throw new Error(`expected lock name 'board:write', got '${locked.config.name}'`);
  }
});

// ─── Sample other photons (no functional tags — should load without middleware) ───

console.log('\n🧪 Sample photons (no functional tags)\n');

const samplePhotons = [
  '/Users/arul/Projects/photons/expenses.photon.ts',
  '/Users/arul/Projects/photons/web.photon.ts',
  '/Users/arul/Projects/photons/tasks-basic.photon.ts',
  '/Users/arul/Projects/photons/hello-world.photon.ts',
  '/Users/arul/Projects/photons/filesystem.photon.ts',
];

for (const p of samplePhotons) {
  const name = p.split('/').pop()!.replace('.photon.ts', '');
  await test(`${name} loads and has no middleware declarations`, async () => {
    const photon = await loader.loadFile(p);
    if (!photon) throw new Error('failed to load');
    // Methods should NOT have middleware (no functional tags used)
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
