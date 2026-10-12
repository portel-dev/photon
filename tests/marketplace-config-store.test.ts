import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileMarketplaceConfigStore } from '../src/marketplace-config-store.js';
import { createLogger } from '../src/shared/logger.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-marketplace-config-'));
const store = new FileMarketplaceConfigStore(
  dir,
  path.join(dir, 'marketplaces.json'),
  createLogger({ component: 'test', minimal: true })
);
const defaults = [
  {
    name: 'default',
    repo: 'owner/repo',
    url: 'https://example.com',
    sourceType: 'github' as const,
    source: 'owner/repo',
    enabled: true,
  },
];

await store.initialize();
assert.deepEqual(await store.load(defaults), { marketplaces: defaults });
await store.save({ marketplaces: defaults });
assert.deepEqual(await store.load([]), { marketplaces: defaults });
await fs.rm(dir, { recursive: true, force: true });
console.log('marketplace-config-store tests passed');
