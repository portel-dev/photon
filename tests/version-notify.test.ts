/**
 * Regression tests for update-notice version comparison.
 */

import assert from 'node:assert/strict';
import { compareSemver } from '../dist/version-notify.js';

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function main() {
  console.log('Version notification:');

  await test('build metadata does not make current version look older', () => {
    assert.equal(compareSemver('1.32.2', '1.32.2+sha.15fc9f1'), 0);
  });

  await test('newer patch versions still compare as newer than SHA builds', () => {
    assert.equal(compareSemver('1.32.3', '1.32.2+sha.15fc9f1'), 1);
  });

  await test('release versions still compare newer than prerelease SHA builds', () => {
    assert.equal(compareSemver('1.32.2', '1.32.2-beta.1+sha.15fc9f1'), 1);
  });

  await test('build metadata is ignored after prerelease comparison', () => {
    assert.equal(compareSemver('1.32.2-beta.1', '1.32.2-beta.1+sha.15fc9f1'), 0);
  });

  console.log('\nAll version notification tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
