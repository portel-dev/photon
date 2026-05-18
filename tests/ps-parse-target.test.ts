/**
 * Regression: `photon ps disable photon:hash:method` was a silent no-op.
 *
 * parseTarget split on the FIRST colon, so an instance-qualified id
 * `kith-sync:7780a2a6:scheduled_freshness_scan` became
 *   photon = "kith-sync"
 *   method = "7780a2a6:scheduled_freshness_scan"
 * which matched no enrollment. The daemon dropped nothing yet the CLI
 * still printed "Disabled", so a rogue LinkedIn schedule kept firing on a
 * host it had been "disabled" on.
 *
 * Method names are JS identifiers (never contain colons); photon ids may
 * be instance-qualified (`photon:hash`). Split on the LAST colon.
 */

import assert from 'node:assert/strict';
import { parseTarget } from '../src/cli/commands/ps.js';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

console.log('\nps parseTarget:\n');

check('plain photon:method splits correctly', () => {
  assert.deepEqual(parseTarget('kith-sync:scheduled_sync'), {
    photon: 'kith-sync',
    method: 'scheduled_sync',
  });
});

check('instance-qualified photon:hash:method keeps the hash on the photon', () => {
  assert.deepEqual(parseTarget('kith-sync:7780a2a6:scheduled_freshness_scan'), {
    photon: 'kith-sync:7780a2a6',
    method: 'scheduled_freshness_scan',
  });
});

check('rejects a bare photon with no method', () => {
  assert.throws(() => parseTarget('kith-sync'), /Expected <photon>:<method>/);
});

check('rejects a trailing colon', () => {
  assert.throws(() => parseTarget('kith-sync:'), /Expected <photon>:<method>/);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
