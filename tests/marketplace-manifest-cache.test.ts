import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileMarketplaceManifestCache } from '../src/marketplace-manifest-cache.js';
import { createLogger } from '../src/shared/logger.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-manifest-cache-'));
const cache = new FileMarketplaceManifestCache(
  path.join(dir, 'manifests'),
  createLogger({ component: 'test', minimal: true })
);
const manifest = { name: 'test', photons: [] };

await cache.initialize();
await cache.put('test', manifest);
assert.deepEqual(await cache.get('test'), manifest);
assert.equal(await cache.get('missing'), null);

const corruptPath = path.join(dir, 'manifests', 'corrupt.json');
await fs.writeFile(corruptPath, '{invalid');
assert.equal(await cache.get('corrupt'), null);
assert.equal(existsSync(corruptPath), false);

await fs.rm(dir, { recursive: true, force: true });
console.log('marketplace-manifest-cache tests passed');
