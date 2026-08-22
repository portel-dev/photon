import assert from 'node:assert/strict';
import {
  AuthCodeService,
  MemoryAuthChallengeStore,
  type AuthCodeDeliveryRequest,
} from '../src/auth/auth-delivery.js';

const start = new Date('2026-08-22T10:00:00.000Z');
let current = start;
const delivered: AuthCodeDeliveryRequest[] = [];

function service(overrides: Partial<ConstructorParameters<typeof AuthCodeService>[0]> = {}) {
  return new AuthCodeService({
    secret: 'test-auth-secret-at-least-16',
    store: new MemoryAuthChallengeStore(),
    now: () => current,
    adapter: {
      sendCode: async (request) => {
        delivered.push(request);
      },
    },
    ...overrides,
  });
}

async function run() {
  delivered.length = 0;
  current = start;

  const auth = service();
  const requested = await auth.requestCode({
    destination: 'person@example.com',
    purpose: 'sign-in',
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].destination, 'person@example.com');
  assert.equal(delivered[0].purpose, 'sign-in');
  assert.match(delivered[0].code, /^\d{6}$/);
  assert.notEqual(delivered[0].code, requested.challengeId);

  const verified = await auth.verifyCode(requested.challengeId, delivered[0].code);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.challenge.destination, 'person@example.com');

  const replay = await auth.verifyCode(requested.challengeId, delivered[0].code);
  assert.deepEqual(replay, { ok: false, reason: 'not_found' });

  const limited = service({ maxAttempts: 2 });
  const limitedRequest = await limited.requestCode({
    destination: 'person@example.com',
    purpose: 'account-recovery',
  });
  const limitedCode = delivered[delivered.length - 1].code;
  assert.deepEqual(await limited.verifyCode(limitedRequest.challengeId, '000000'), {
    ok: false,
    reason: 'invalid_code',
  });
  assert.deepEqual(await limited.verifyCode(limitedRequest.challengeId, '111111'), {
    ok: false,
    reason: 'invalid_code',
  });
  assert.deepEqual(await limited.verifyCode(limitedRequest.challengeId, limitedCode), {
    ok: false,
    reason: 'not_found',
  });

  const expiring = service({ ttlSeconds: 60 });
  const expiringRequest = await expiring.requestCode({
    destination: 'person@example.com',
    purpose: 'passkey-enrollment',
  });
  const expiringCode = delivered[delivered.length - 1].code;
  current = new Date(start.getTime() + 61_000);
  assert.deepEqual(await expiring.verifyCode(expiringRequest.challengeId, expiringCode), {
    ok: false,
    reason: 'expired',
  });

  const failing = service({
    adapter: {
      sendCode: async () => {
        throw new Error('delivery unavailable');
      },
    },
  });
  await assert.rejects(
    failing.requestCode({ destination: 'person@example.com', purpose: 'sign-in' }),
    /delivery unavailable/
  );

  console.log('auth-delivery: all assertions passed');
}

void run();
