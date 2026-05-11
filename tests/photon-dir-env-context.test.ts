/**
 * PHOTON_DIR isolation for the single in-process daemon.
 *
 * The daemon can host photons from multiple base directories in one Node process.
 * User photons may still read process.env.PHOTON_DIR directly, so that value must
 * follow the active photon across import, construction, lifecycle, and awaits.
 *
 * Run: npm run build && npx tsx tests/photon-dir-env-context.test.ts
 */

import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PhotonLoader } from '../dist/loader.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-dir-env-context-'));

async function createPhoton(baseDir: string, name: string) {
  await fs.mkdir(baseDir, { recursive: true });
  const file = path.join(baseDir, `${name}.photon.ts`);
  await fs.writeFile(
    file,
    `
      const importedDir = process.env.PHOTON_DIR ?? null;

      export default class EnvContext {
        constructedDir = process.env.PHOTON_DIR ?? null;
        initializedDir: string | null = null;

        async onInitialize() {
          this.initializedDir = process.env.PHOTON_DIR ?? null;
        }

        async check(params: { delayMs: number }) {
          const before = process.env.PHOTON_DIR ?? null;
          await new Promise((resolve) => setTimeout(resolve, params.delayMs));
          return {
            importedDir,
            constructedDir: this.constructedDir,
            initializedDir: this.initializedDir,
            before,
            after: process.env.PHOTON_DIR ?? null
          };
        }
      }
    `,
    'utf8'
  );
  return file;
}

const baseA = path.join(root, 'base-a');
const baseB = path.join(root, 'base-b');
const fileA = await createPhoton(baseA, 'env-a');
const fileB = await createPhoton(baseB, 'env-b');

try {
  const loaderA = new PhotonLoader(false, undefined, baseA);
  const loaderB = new PhotonLoader(false, undefined, baseB);

  const [photonA, photonB] = await Promise.all([loaderA.loadFile(fileA), loaderB.loadFile(fileB)]);

  const [resultA, resultB] = await Promise.all([
    loaderA.executeTool(photonA, 'check', { delayMs: 50 }),
    loaderB.executeTool(photonB, 'check', { delayMs: 10 }),
  ]);

  assert.deepEqual(resultA, {
    importedDir: baseA,
    constructedDir: baseA,
    initializedDir: baseA,
    before: baseA,
    after: baseA,
  });

  assert.deepEqual(resultB, {
    importedDir: baseB,
    constructedDir: baseB,
    initializedDir: baseB,
    before: baseB,
    after: baseB,
  });

  console.log('✅ PHOTON_DIR stays isolated across concurrent photon bases');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
