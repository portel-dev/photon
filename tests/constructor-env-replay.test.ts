/**
 * Constructor env replay tests for daemon-hosted stateful photons.
 *
 * Run: tsx tests/constructor-env-replay.test.ts
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPhotonEnvPath } from '@portel/photon-core';
import { PhotonLoader } from '../src/loader.js';
import {
  ConstructorEnvReplayStore,
  createConstructorEnvReplayIdentity,
} from '../src/daemon/constructor-env-replay.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed++;
        console.log(`  ✓ ${name}`);
      },
      (err) => {
        failed++;
        console.log(`  ✗ ${name}: ${err.message}`);
      }
    );
}

async function run(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-constructor-env-replay-'));
  const photonHome = path.join(tmpRoot, 'home');
  const baseDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(baseDir, { recursive: true });

  const photonPath = path.join(baseDir, 'secure.photon.ts');
  fs.writeFileSync(
    photonPath,
    `
      /**
       * Secure Photon
       * @stateful
       */
      export default class Secure {
        public apiKey: string;
        public items: string[];

        constructor(apiKey: string, items: string[] = []) {
          if (!apiKey) throw new Error('apiKey required');
          this.apiKey = apiKey;
          this.items = items;
        }

        async reveal() {
          return this.apiKey;
        }
      }
    `,
    'utf-8'
  );

  const store = new ConstructorEnvReplayStore(photonHome);
  const identity = createConstructorEnvReplayIdentity(baseDir, 'secure', photonPath);
  const replayOptions = (currentEnv?: Record<string, string>) => ({
    currentEnv,
    resolve: (envVarName: string) => store.resolve(identity, envVarName),
    capture: (values: Record<string, string>) => store.write(identity, values),
  });

  const oldEnv = process.env.SECURE_API_KEY;
  delete process.env.SECURE_API_KEY;

  try {
    await test('encrypted store does not persist plaintext values', () => {
      store.write(identity, { SECURE_API_KEY: 'super-secret-token' });
      const snapshotPath = store.getSnapshotPath(identity);
      const raw = fs.readFileSync(snapshotPath, 'utf-8');
      assert.equal(store.resolve(identity, 'SECURE_API_KEY'), 'super-secret-token');
      assert.equal(raw.includes('super-secret-token'), false);
      assert.equal(raw.includes('SECURE_API_KEY'), true);
    });

    await test('snapshot identity does not cross project boundaries', () => {
      const otherBase = path.join(tmpRoot, 'other-workspace');
      fs.mkdirSync(otherBase, { recursive: true });
      const otherPhotonPath = path.join(otherBase, 'secure.photon.ts');
      fs.writeFileSync(otherPhotonPath, fs.readFileSync(photonPath, 'utf-8'), 'utf-8');
      const otherIdentity = createConstructorEnvReplayIdentity(
        otherBase,
        'secure',
        otherPhotonPath
      );
      assert.equal(store.resolve(otherIdentity, 'SECURE_API_KEY'), undefined);
    });

    await test('stateful loader captures supplied constructor env into encrypted replay', async () => {
      const loader = new PhotonLoader(false, undefined, baseDir);
      const loaded = await loader.loadFile(photonPath, {
        constructorEnvReplay: replayOptions({ SECURE_API_KEY: 'initial-token' }),
      });
      assert.equal((loaded.instance as { apiKey: string }).apiKey, 'initial-token');
      assert.equal(store.resolve(identity, 'SECURE_API_KEY'), 'initial-token');
      assert.equal(store.resolve(identity, 'items'), undefined);
      assert.equal(store.resolve(identity, 'SECURE_ITEMS'), undefined);
      assert.equal(fs.existsSync(getPhotonEnvPath('local', 'secure', baseDir)), false);
    });

    await test('stateful loader replays constructor env when process env is absent', async () => {
      const loader = new PhotonLoader(false, undefined, baseDir);
      const loaded = await loader.loadFile(photonPath, {
        constructorEnvReplay: replayOptions(),
      });
      assert.equal((loaded.instance as { apiKey: string }).apiKey, 'initial-token');
    });

    await test('fresh constructor env replaces a corrupted encrypted snapshot', async () => {
      fs.writeFileSync(store.getSnapshotPath(identity), '{"not":"valid replay"}', 'utf-8');
      const loader = new PhotonLoader(false, undefined, baseDir);
      const loaded = await loader.loadFile(photonPath, {
        constructorEnvReplay: replayOptions({ SECURE_API_KEY: 'rotated-token' }),
      });
      assert.equal((loaded.instance as { apiKey: string }).apiKey, 'rotated-token');
      assert.equal(store.resolve(identity, 'SECURE_API_KEY'), 'rotated-token');
    });

    await test('corrupted replay without current env fails through existing constructor path', async () => {
      fs.writeFileSync(store.getSnapshotPath(identity), '{"not":"valid replay"}', 'utf-8');
      const loader = new PhotonLoader(false, undefined, baseDir);
      await assert.rejects(
        () =>
          loader.loadFile(photonPath, {
            constructorEnvReplay: replayOptions(),
          }),
        /SECURE_API_KEY|apiKey required/
      );
    });
  } finally {
    if (oldEnv === undefined) delete process.env.SECURE_API_KEY;
    else process.env.SECURE_API_KEY = oldEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nConstructor env replay tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
