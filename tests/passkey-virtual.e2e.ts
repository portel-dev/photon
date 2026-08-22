/**
 * Opt-in end-to-end passkey test for a deployed Photon OAuth endpoint.
 *
 * This uses Chromium's virtual CTAP2 authenticator, so it validates the real
 * browser ceremony and the generated Worker verifier without touching a
 * user's platform keychain. It intentionally is not part of `test:all`.
 *
 * Run:
 *   PHOTON_PASSKEY_E2E=1 \
 *   PHOTON_PASSKEY_E2E_EMAIL=owner@example.com \
 *   PHOTON_PASSKEY_E2E_EXPECT_ROLE=host \
 *   PHOTON_PASSKEY_E2E_BASE_URL=https://consult.example \
 *   tsx tests/passkey-virtual.e2e.ts
 *
 * The test uses the configured `gws` CLI to read the one-time email code.
 * It does not print the code, OAuth code, or access token.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';

const execFileAsync = promisify(execFile);
const enabled = process.env.PHOTON_PASSKEY_E2E === '1';
const baseUrl = (process.env.PHOTON_PASSKEY_E2E_BASE_URL ?? '').replace(/\/+$/, '');
const email = (process.env.PHOTON_PASSKEY_E2E_EMAIL ?? '').trim().toLowerCase();
const expectedRole = process.env.PHOTON_PASSKEY_E2E_EXPECT_ROLE ?? 'host';
const redirectUri = 'http://127.0.0.1:8765/callback';

if (!enabled) {
  console.log('passkey-virtual: skipped (set PHOTON_PASSKEY_E2E=1 to run)');
  process.exit(0);
}

assert.ok(baseUrl, 'PHOTON_PASSKEY_E2E_BASE_URL is required');
assert.ok(email, 'PHOTON_PASSKEY_E2E_EMAIL is required');
assert.ok(
  ['host', 'user'].includes(expectedRole),
  'PHOTON_PASSKEY_E2E_EXPECT_ROLE must be host or user'
);

type OAuthMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};

type Callback = { code: string; state: string };

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok, `${response.status}: ${text.slice(0, 240)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .findLast((line) => line.startsWith('{') || line.startsWith('['));
    assert.ok(data, `expected JSON or an SSE data event, got: ${text.slice(0, 240)}`);
    return JSON.parse(data) as T;
  }
}

async function codeChallenge(verifier: string): Promise<string> {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function readVerificationCodes(): Promise<string[]> {
  await execFileAsync('agent-browser', [
    '--auto-connect',
    'open',
    'https://mail.google.com/mail/u/0/#search/verification+code+newer_than%3A1h',
  ]);
  await execFileAsync('agent-browser', ['--auto-connect', 'wait', '1500']);
  const browserText = await execFileAsync('agent-browser', [
    '--auto-connect',
    'get',
    'text',
    'body',
  ]);
  return Array.from(
    browserText.stdout.matchAll(/Your verification code is\s+(\d{6})/gi),
    (match) => match[1]
  );
}

async function readVerificationCode(ignoredCodes: Set<string> = new Set()): Promise<string> {
  // Prefer the already logged-in browser session. This keeps the test usable
  // when the local gws CLI has no separate credential file.
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const codes = await readVerificationCodes();
      const fresh = codes.find((code) => !ignoredCodes.has(code));
      if (fresh) return fresh;
    } catch {
      // The connected browser may be between Gmail navigations; retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('verification email was not found in the connected Gmail browser session');
}

function startCallbackServer(): { server: Server; nextCallback: () => Promise<Callback> } {
  const waiters: Array<(callback: Callback) => void> = [];
  const nextCallback = () => new Promise<Callback>((resolve) => waiters.push(resolve));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', redirectUri);
    if (url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      response.writeHead(400).end('Missing OAuth callback parameters');
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(
        '<!doctype html><title>Authorization captured</title><p>You can close this test tab.</p>'
      );
    waiters.shift()?.({ code, state });
  });
  return { server, nextCallback };
}

async function registerClient(metadata: OAuthMetadata): Promise<string> {
  const result = await json<{ client_id: string }>(
    await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Photon virtual passkey regression test',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
  );
  return result.client_id;
}

function authorizationUrl(
  metadata: OAuthMetadata,
  clientId: string,
  verifier: string
): { url: string; state: string } {
  const state = randomBytes(18).toString('base64url');
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', verifier);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', `${baseUrl}/mcp`);
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

async function exchangeCode(
  metadata: OAuthMetadata,
  clientId: string,
  callback: Callback,
  verifier: string
) {
  return json<{ access_token: string }>(
    await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: callback.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    })
  );
}

async function allowConsent(page: Page): Promise<void> {
  const allow = page.getByRole('button', { name: /allow/i }).first();
  await allow.waitFor({ state: 'visible', timeout: 20_000 });
  await allow.click();
}

async function run(): Promise<void> {
  const metadata = await json<OAuthMetadata>(
    await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
  );
  const clientId = await registerClient(metadata);
  const { server, nextCallback } = startCallbackServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(8765, '127.0.0.1', resolve).once('error', reject)
  );

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const cdp = await context.newCDPSession(await context.newPage());
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const page = context.pages()[0];

    if (process.env.PHOTON_PASSKEY_E2E_SKIP_REGISTRATION !== '1') {
      // First authorization: email OTP, then a real browser passkey registration.
      const firstVerifier = randomBytes(32).toString('base64url');
      const first = authorizationUrl(metadata, clientId, await codeChallenge(firstVerifier));
      const firstCallbackPromise = nextCallback();
      await page.goto(first.url, { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="email"]').fill(email);
      const previousCodes = new Set(await readVerificationCodes());
      await page.getByRole('button', { name: /send verification code/i }).click();
      const firstCode = await readVerificationCode(previousCodes);
      await page.locator('input[autocomplete="one-time-code"]').fill(firstCode);
      await page.getByRole('button', { name: /verify and continue/i }).click();
      await page.waitForTimeout(1000);
      console.log(
        `passkey-virtual: post-email page ${await page.url()} — ${(await page.locator('body').innerText()).slice(0, 280).replace(/\s+/g, ' ')}`
      );
      await page.getByRole('button', { name: /add a passkey/i }).click();
      await page.waitForURL(/\/consent\?/i, { timeout: 20_000 });
      await allowConsent(page);
      const firstCallback = await firstCallbackPromise;
      assert.equal(firstCallback.state, first.state);
      const firstToken = await exchangeCode(metadata, clientId, firstCallback, firstVerifier);
      assert.ok(firstToken.access_token);
    }

    // Second authorization: the same virtual authenticator must replace email OTP.
    const secondVerifier = randomBytes(32).toString('base64url');
    const second = authorizationUrl(metadata, clientId, await codeChallenge(secondVerifier));
    const secondCallbackPromise = nextCallback();
    await page.goto(second.url, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(email);
    await page.getByRole('button', { name: /use a passkey/i }).click();
    await page.waitForURL(/\/consent\?/i, { timeout: 20_000 });
    await allowConsent(page);
    const secondCallback = await secondCallbackPromise;
    assert.equal(secondCallback.state, second.state);
    const secondToken = await exchangeCode(metadata, clientId, secondCallback, secondVerifier);
    assert.ok(secondToken.access_token);

    const mcp = await json<{ result?: { tools?: Array<{ name: string }> } }>(
      await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${secondToken.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
    );
    const names = (mcp.result?.tools ?? []).map((tool) => tool.name);
    if (expectedRole === 'host') {
      assert.ok(
        names.includes('getBookingSetup'),
        'passkey-authenticated host token did not expose host tools'
      );
      assert.ok(
        !names.includes('bookConsultation'),
        'passkey-authenticated host token exposed guest tools'
      );
    } else {
      assert.ok(
        names.includes('bookConsultation'),
        'passkey-authenticated user token did not expose guest tools'
      );
      assert.ok(
        !names.includes('getBookingSetup'),
        'passkey-authenticated user token exposed host tools'
      );
    }
    console.log(
      `passkey-virtual: WebAuthn passkey authentication and MCP ${expectedRole} role verification passed`
    );
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
