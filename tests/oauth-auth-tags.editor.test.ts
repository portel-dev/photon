import assert from 'node:assert/strict';
import {
  buildPhotonDocblockTagCatalog,
  photonAuthTagValues,
} from '../src/editor-support/docblock-tag-catalog.js';

assert.deepEqual(photonAuthTagValues, ['required', 'optional', 'oauth required', 'oauth optional']);

const catalog = buildPhotonDocblockTagCatalog('1.36.1');
const auth = catalog.allTags.find((tag) => tag.label === '@auth');

assert.ok(auth, '@auth should be offered by class-level completions');
assert.match(auth.detail, /scheme/i);
assert.match(auth.info ?? '', /oauth required/);
assert.match(auth.info ?? '', /oauth optional/);
assert.match(auth.snippetTmpl ?? '', /oauth required/);
assert.match(auth.snippetTmpl ?? '', /oauth optional/);
assert.equal(
  catalog.inlineGeneralTags.some((tag) => tag.label === '@auth'),
  false,
  '@auth remains a class-level tag'
);

console.log('oauth-auth-tags editor tests passed');
