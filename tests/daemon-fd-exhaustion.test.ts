/**
 * DaemonManager file-descriptor-exhaustion handling.
 *
 * `spawnDaemon` retries once on EMFILE/ENFILE and, if it persists, throws
 * an actionable message instead of a raw posix_spawn stack trace. The
 * spawn path itself can't be unit-mocked (the ESM `fs` namespace is
 * sealed) and a real system-wide ENFILE is unsafe to force, so this
 * pins the classifier that drives that behaviour. The retry/rethrow
 * control flow around it is straight-line and reviewed by inspection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DaemonManager } from '../src/daemon/manager.js';

const isFdExhaustion = (err: unknown): boolean => (DaemonManager as any).isFdExhaustion(err);

test('isFdExhaustion matches only the FD-exhaustion errno codes', () => {
  const emfile = Object.assign(new Error('EMFILE: too many open files'), {
    code: 'EMFILE',
  });
  const enfile = Object.assign(new Error('ENFILE: file table overflow'), {
    code: 'ENFILE',
  });
  assert.equal(isFdExhaustion(emfile), true, 'EMFILE → true');
  assert.equal(isFdExhaustion(enfile), true, 'ENFILE → true');

  assert.equal(
    isFdExhaustion(Object.assign(new Error('x'), { code: 'EACCES' })),
    false,
    'EACCES → false (must surface as-is, no retry)'
  );
  assert.equal(isFdExhaustion(new Error('no code')), false, 'no code → false');
  assert.equal(isFdExhaustion(null), false, 'null → false');
  assert.equal(isFdExhaustion(undefined), false, 'undefined → false');
  console.log('  ✅ FD-exhaustion classifier is exact');
});
