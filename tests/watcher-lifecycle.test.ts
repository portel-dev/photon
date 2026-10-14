import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileWatcher } from '../src/watcher.js';

const directory = mkdtempSync(join(tmpdir(), 'photon-watcher-lifecycle-'));
const photonPath = join(directory, 'demo.photon.ts');
writeFileSync(photonPath, 'export default class Demo { ping() { return true; } }\n');

let reloads = 0;
const server = {
  reload: async () => {
    reloads++;
  },
} as any;
const watcher = new FileWatcher(server, photonPath);

try {
  // A stop racing with start must wait for startup and close the resulting watcher.
  await Promise.all([watcher.start(), watcher.stop(false)]);
  appendFileSync(photonPath, '\n// after-stop\n');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(reloads, 0, 'a watcher must not remain open after start/stop races');
  console.log('watcher lifecycle test passed');
} finally {
  await watcher.stop(false);
  rmSync(directory, { recursive: true, force: true });
}
