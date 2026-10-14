import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PhotonLoader } from '../src/loader.js';

const root = mkdtempSync(join(tmpdir(), 'photon-loader-parity-'));
const filePath = join(root, 'parity.photon.ts');
writeFileSync(join(root, 'helper.ts'), `export function helper() { return 'pong'; }`);
const source = `
import { helper } from './helper.js';
/** @stateful @icon rocket */
export default class Parity {
  async ping() { return helper(); }
  async *flow() { yield { emit: 'status', message: 'ready' }; return 'done'; }
}`;
writeFileSync(filePath, source);

try {
  const diskLoader = new PhotonLoader(false, undefined, root);
  const disk = await diskLoader.loadFile(filePath);

  const moduleLoader = new PhotonLoader(false, undefined, root);
  class Parity {
    async ping() {
      return 'pong';
    }
    async *flow() {
      yield { emit: 'status', message: 'ready' };
      return 'done';
    }
  }
  const preloaded = await moduleLoader.loadFromModule({ default: Parity }, filePath, source);

  assert.deepEqual(
    disk.tools.map((tool) => tool.name),
    preloaded.tools.map((tool) => tool.name)
  );
  assert.equal(disk.name, preloaded.name);
  assert.equal(disk.stateful, true);
  assert.equal(preloaded.stateful, true);
  assert.equal((disk.instance as any)._photonName, (preloaded.instance as any)._photonName);
  assert.equal((disk.instance as any)._baseDir, (preloaded.instance as any)._baseDir);
  assert.equal(typeof (disk.instance as any).emit, 'function');
  assert.equal(typeof (preloaded.instance as any).emit, 'function');
  assert.equal(typeof (disk.instance as any).memory, 'object');
  assert.equal(typeof (preloaded.instance as any).memory, 'object');
  assert.equal((disk.instance as any)._photonFilePath, filePath);
  assert.equal((preloaded.instance as any)._photonFilePath, join(root, 'parity.photon.ts'));
  console.log('loader load parity tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
