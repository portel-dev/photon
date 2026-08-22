import assert from 'node:assert/strict';
import { PhotonDocExtractor } from '../src/photon-doc-extractor.js';

async function metadata(source: string) {
  return new PhotonDocExtractor('/tmp/oauth-auth-tags.photon.ts', source).extractFullMetadata();
}

const cases: Array<{
  name: string;
  source: string;
  expectedAuth?: string;
  expectedMetadata?: {
    scheme: string;
    mode: 'required' | 'optional';
    methods?: Array<'email' | 'passkey'>;
  };
}> = [
  {
    name: 'oauth required',
    source: '/** @auth oauth required */\nexport default class Example {}',
    expectedAuth: 'oauth required',
    expectedMetadata: { scheme: 'oauth', mode: 'required' },
  },
  {
    name: 'oauth optional',
    source: '/** @auth oauth optional */\nexport default class Example {}',
    expectedAuth: 'oauth optional',
    expectedMetadata: { scheme: 'oauth', mode: 'optional' },
  },
  {
    name: 'legacy required',
    source: '/** @auth required */\nexport default class Example {}',
    expectedAuth: 'required',
    expectedMetadata: { scheme: 'legacy', mode: 'required' },
  },
  {
    name: 'legacy optional',
    source: '/** @auth optional */\nexport default class Example {}',
    expectedAuth: 'optional',
    expectedMetadata: { scheme: 'legacy', mode: 'optional' },
  },
  {
    name: 'arbitrary legacy scheme',
    source: '/** @auth cf-access */\nexport default class Example {}',
    expectedAuth: 'cf-access',
    expectedMetadata: { scheme: 'cf-access', mode: 'required' },
  },
  {
    name: 'email and passkey',
    source: '/** @auth email passkey */\nexport default class Example {}',
    expectedAuth: 'email passkey',
    expectedMetadata: { scheme: 'oauth', mode: 'required', methods: ['email', 'passkey'] },
  },
  {
    name: 'email and passkey optional',
    source: '/** @auth email passkey optional */\nexport default class Example {}',
    expectedAuth: 'email passkey optional',
    expectedMetadata: { scheme: 'oauth', mode: 'optional', methods: ['email', 'passkey'] },
  },
  {
    name: 'single passkey method',
    source: '/** @auth passkey */\nexport default class Example {}',
    expectedAuth: 'passkey',
    expectedMetadata: { scheme: 'oauth', mode: 'required', methods: ['passkey'] },
  },
];

for (const testCase of cases) {
  const result = await metadata(testCase.source);
  assert.equal(result.auth, testCase.expectedAuth, `${testCase.name}: legacy auth value`);
  assert.deepEqual(result.authMetadata, testCase.expectedMetadata, `${testCase.name}: metadata`);
  assert.equal(result.diagnostics, undefined, `${testCase.name}: no diagnostics`);
}

{
  const result = await metadata(`
    /**
     * @auth oauth optional
     */
    export default class Example {
      /** @auth required */
      async publicMethod() {}
    }
  `);
  assert.equal(
    result.authMetadata?.mode,
    'optional',
    'method-level @auth cannot override class auth'
  );
}

for (const source of [
  '/** @auth oauth optional required */\nexport default class Example {}',
  '/** @auth required oauth */\nexport default class Example {}',
  '/** @auth cf-access optional */\nexport default class Example {}',
  '/** @auth email email */\nexport default class Example {}',
  '/** @auth email oauth */\nexport default class Example {}',
]) {
  const result = await metadata(source);
  assert.equal(result.auth, undefined, 'malformed auth is not partially normalized');
  assert.equal(result.authMetadata, undefined, 'malformed auth fails closed');
  assert.equal(
    result.diagnostics?.[0]?.severity,
    'error',
    'malformed auth has an error diagnostic'
  );
  assert.equal(result.diagnostics?.[0]?.tag, 'auth', 'diagnostic identifies auth');
}

{
  const result = await metadata(`
    /**
     * @auth oauth required
     * @auth oauth optional
     */
    export default class Example {}
  `);
  assert.equal(result.authMetadata, undefined, 'conflicting auth tags fail closed');
  assert.equal(result.diagnostics?.[0]?.code, 'conflicting-auth-tag');
}

{
  const result = await metadata(`
    /**
     * @auth oauth required
     */
    export default class Example {}
  `);
  assert.equal(result.diagnostics, undefined, 'valid auth has no diagnostics');
}

console.log('oauth-auth-tags extractor tests passed');
