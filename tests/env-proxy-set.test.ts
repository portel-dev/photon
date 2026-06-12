/**
 * Regression: the PHOTON_DIR env proxy must not break process.env writes.
 *
 * telemetry/context.ts replaces process.env with a Proxy so PHOTON_DIR
 * reads prefer the async-local value. Its set trap forwarded the proxy as
 * Reflect.set's receiver, which re-enters the proxy's descriptor
 * machinery — and Node's exotic process.env rejects that with
 * ERR_INVALID_OBJECT_DEFINE_PROPERTY. Net effect on Node 25: EVERY
 * `process.env.X = y` assignment anywhere in the process threw after the
 * proxy installed (found by the daemon chaos suite's scenario setup).
 */

import { strict as assert } from 'assert';

// Importing the module installs the proxy as a side effect.
await import('../dist/telemetry/context.js');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}\n     ${err.message}`);
  }
}

console.log('🧪 process.env proxy write semantics\n');

test('plain env assignment works after proxy install', () => {
  process.env._PHOTON_ENV_PROXY_TEST = 'hello';
  assert.equal(process.env._PHOTON_ENV_PROXY_TEST, 'hello');
});

test('PHOTON_DIR assignment works after proxy install', () => {
  const saved = process.env.PHOTON_DIR;
  process.env.PHOTON_DIR = '/tmp/proxy-test';
  assert.equal(process.env.PHOTON_DIR, '/tmp/proxy-test');
  if (saved === undefined) delete process.env.PHOTON_DIR;
  else process.env.PHOTON_DIR = saved;
});

test('env deletion works after proxy install', () => {
  process.env._PHOTON_ENV_PROXY_TEST = 'x';
  delete process.env._PHOTON_ENV_PROXY_TEST;
  assert.equal(process.env._PHOTON_ENV_PROXY_TEST, undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
