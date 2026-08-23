import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHOTON_WEB_SESSION_COOKIE,
  PHOTON_WEB_SESSION_TTL_SECONDS,
  buildExpiredSessionCookie,
  buildSessionCookie,
  isSafeReturnPath,
  parseCookieHeader,
} from '../src/auth/web-session.js';

test('web session cookies are HttpOnly, secure, same-site, and scoped to the app', () => {
  const cookie = buildSessionCookie('opaque token', 120);
  assert.match(cookie, new RegExp(`^${PHOTON_WEB_SESSION_COOKIE}=opaque%20token`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=120/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('web session expiry cookie removes the session', () => {
  assert.match(buildExpiredSessionCookie(), new RegExp(`${PHOTON_WEB_SESSION_COOKIE}=;`));
  assert.match(buildExpiredSessionCookie(), /Max-Age=0/);
});

test('cookie parser handles encoded values and ignores malformed pieces', () => {
  assert.deepEqual(parseCookieHeader('a=1; __photon_session=hello%20world; malformed; empty='), {
    a: '1',
    __photon_session: 'hello world',
    empty: '',
  });
});

test('only same-origin relative return paths are accepted', () => {
  assert.equal(isSafeReturnPath('/account?tab=bookings'), true);
  assert.equal(isSafeReturnPath('/'), true);
  assert.equal(isSafeReturnPath('https://evil.example/account'), false);
  assert.equal(isSafeReturnPath('//evil.example/account'), false);
  assert.equal(isSafeReturnPath('javascript:alert(1)'), false);
  assert.equal(PHOTON_WEB_SESSION_TTL_SECONDS, 30 * 24 * 60 * 60);
});
