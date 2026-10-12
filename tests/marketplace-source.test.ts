import assert from 'node:assert/strict';
import { parseMarketplaceSource } from '../src/marketplace-source.js';

assert.equal(parseMarketplaceSource('owner/repo')?.sourceType, 'github');
assert.equal(parseMarketplaceSource('git@github.com:owner/repo.git')?.repo, 'owner/repo');
assert.equal(parseMarketplaceSource('https://example.com/photons.json')?.name, 'photons');
assert.equal(parseMarketplaceSource('./local-marketplace')?.sourceType, 'local');
assert.equal(parseMarketplaceSource('not a source'), null);
console.log('marketplace-source tests passed');
