/**
 * Runtime-owned config store regression tests.
 *
 * Daemon-hosted photons cannot safely depend on the interactive shell's
 * environment. These tests pin config values to PHOTON_DIR/.data and verify
 * constructor injection captures current process env for restart replay while
 * `this.config` is store-only.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PhotonLoader } from '../src/loader.js';
import { EnvStore } from '../src/context-store.js';
import { captureConstructorEnvForPhoton } from '../src/daemon/client.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-runtime-config-'));
const photonName = 'config-runtime';
const photonPath = path.join(tmpDir, `${photonName}.photon.ts`);

fs.writeFileSync(
  photonPath,
  `
export default class ConfigRuntime {
  constructor(private apiKey: string) {}

  async constructorKey(): Promise<string> {
    return this.apiKey;
  }

  async requiredEmail(): Promise<string> {
    return (this as any).config.require('KITH_USER_EMAIL');
  }
}
`,
  'utf-8'
);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('\n🧪 Runtime config store');

await test('constructor injection reads env-style keys from Photon config store', async () => {
  delete process.env.CONFIG_RUNTIME_API_KEY;
  new EnvStore(tmpDir).write(photonName, { CONFIG_RUNTIME_API_KEY: 'stored-key' });

  const loader = new PhotonLoader(false, undefined, tmpDir);
  const photon = await loader.loadFile(photonPath);
  const result = await loader.executeTool(photon, 'constructorKey', {});

  assert.equal(result, 'stored-key');
});

await test('constructor injection persists process env for daemon restart replay', async () => {
  const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-runtime-config-replay-'));
  const replayPhotonPath = path.join(replayDir, `${photonName}.photon.ts`);
  fs.copyFileSync(photonPath, replayPhotonPath);

  process.env.CONFIG_RUNTIME_API_KEY = 'captured-from-env';

  const firstLoader = new PhotonLoader(false, undefined, replayDir);
  const firstPhoton = await firstLoader.loadFile(replayPhotonPath);
  assert.equal(
    await firstLoader.executeTool(firstPhoton, 'constructorKey', {}),
    'captured-from-env'
  );
  assert.equal(
    new EnvStore(replayDir).read(photonName).CONFIG_RUNTIME_API_KEY,
    'captured-from-env'
  );

  delete process.env.CONFIG_RUNTIME_API_KEY;

  const secondLoader = new PhotonLoader(false, undefined, replayDir);
  const secondPhoton = await secondLoader.loadFile(replayPhotonPath);
  assert.equal(
    await secondLoader.executeTool(secondPhoton, 'constructorKey', {}),
    'captured-from-env'
  );
});

await test('daemon requests only capture declared constructor env values', async () => {
  process.env.CONFIG_RUNTIME_API_KEY = 'caller-env';
  process.env.UNRELATED_SECRET = 'must-not-travel';

  const captured = captureConstructorEnvForPhoton(photonName, photonPath);

  assert.deepEqual(captured, { CONFIG_RUNTIME_API_KEY: 'caller-env' });
  delete process.env.CONFIG_RUNTIME_API_KEY;
  delete process.env.UNRELATED_SECRET;
});

await test('constructor injection persistence is namespace-scoped', async () => {
  const namespacedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-runtime-config-ns-'));
  const namespaceDir = path.join(namespacedDir, 'team');
  fs.mkdirSync(namespaceDir, { recursive: true });
  const namespacedPhotonPath = path.join(namespaceDir, `${photonName}.photon.ts`);
  fs.copyFileSync(photonPath, namespacedPhotonPath);

  process.env.CONFIG_RUNTIME_API_KEY = 'namespaced-env';

  const firstLoader = new PhotonLoader(false, undefined, namespacedDir);
  const firstPhoton = await firstLoader.loadFile(namespacedPhotonPath);
  assert.equal(await firstLoader.executeTool(firstPhoton, 'constructorKey', {}), 'namespaced-env');
  assert.equal(
    new EnvStore(namespacedDir).read(photonName, 'team').CONFIG_RUNTIME_API_KEY,
    'namespaced-env'
  );
  assert.equal(new EnvStore(namespacedDir).read(photonName).CONFIG_RUNTIME_API_KEY, undefined);

  delete process.env.CONFIG_RUNTIME_API_KEY;

  const secondLoader = new PhotonLoader(false, undefined, namespacedDir);
  const secondPhoton = await secondLoader.loadFile(namespacedPhotonPath);
  assert.equal(
    await secondLoader.executeTool(secondPhoton, 'constructorKey', {}),
    'namespaced-env'
  );
});

await test('this.config reads daemon-safe config values from Photon config store', async () => {
  delete process.env.KITH_USER_EMAIL;
  new EnvStore(tmpDir).write(photonName, { KITH_USER_EMAIL: 'kit@example.com' });

  const loader = new PhotonLoader(false, undefined, tmpDir);
  const photon = await loader.loadFile(photonPath);
  const result = await loader.executeTool(photon, 'requiredEmail', {});

  assert.equal(result, 'kit@example.com');
});

await test('this.config does not read ambient process.env', async () => {
  process.env.KITH_USER_EMAIL = 'ambient@example.com';

  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-runtime-config-empty-'));
  const isolatedPhotonPath = path.join(isolatedDir, `${photonName}.photon.ts`);
  fs.copyFileSync(photonPath, isolatedPhotonPath);
  new EnvStore(isolatedDir).write(photonName, { CONFIG_RUNTIME_API_KEY: 'stored-key' });

  const loader = new PhotonLoader(false, undefined, isolatedDir);
  const photon = await loader.loadFile(isolatedPhotonPath);

  await assert.rejects(
    () => loader.executeTool(photon, 'requiredEmail', {}),
    /Missing Photon config "KITH_USER_EMAIL"/
  );
  delete process.env.KITH_USER_EMAIL;
});

if (failed > 0) {
  console.log(`\n❌ ${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n✅ ${passed} passed`);
