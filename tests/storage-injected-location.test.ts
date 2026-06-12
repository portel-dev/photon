/**
 * Regression: loader-injected storage() must resolve under the data dir,
 * exactly like Photon.storage() in photon-core base.ts.
 *
 * The injected helper for plain classes used to resolve next to the photon
 * source file (<dir>/<name>/<subpath>) — a copy of assets() semantics,
 * where source-adjacent is correct. Every doc (photon-core base.ts JSDoc,
 * photon-core README) promises the data dir, so a plain class and an
 * `extends Photon` class got different storage locations for identical
 * code. Documented contract wins: getPhotonDataDir(ns, name, baseDir).
 */

import { PhotonLoader } from '../dist/loader.js';
import { getPhotonDataDir } from '@portel/photon-core';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function main() {
  console.log('🧪 Injected storage() location\n');

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-storage-loc-'));
  const photonFile = path.join(baseDir, 'plainstore.photon.ts');
  fs.writeFileSync(
    photonFile,
    `
/** @version 1.0.0 */
export default class PlainStore {
  /** Returns where storage resolves */
  async where(): Promise<string> {
    return (this as any).storage('blobs');
  }
}
`
  );

  let passed = 0;
  let failed = 0;
  const test = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ ${name}\n     ${err.message}`);
    }
  };

  try {
    const loader = new PhotonLoader(false, undefined, baseDir);
    const mcp: any = await loader.loadFile(photonFile);
    const dir: string = mcp.instance.storage('blobs');

    // Name comes from the instance pin (kebab-cased class name), same
    // source the base class uses — not the filename.
    const photonName = mcp.instance._photonName || mcp.name;
    const expected = path.join(getPhotonDataDir('local', photonName, baseDir), 'blobs');

    test('storage() resolves under the data dir (documented contract)', () => {
      assert.equal(dir, expected, `got ${dir}\n     expected ${expected}`);
    });

    test('storage() does NOT resolve next to the source file', () => {
      const sourceAdjacent = path.join(baseDir, 'plainstore', 'blobs');
      assert.notEqual(dir, sourceAdjacent, `resolved source-adjacent: ${dir}`);
    });

    test('storage() directory is auto-created', () => {
      assert.ok(fs.existsSync(dir), `${dir} was not created`);
    });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
