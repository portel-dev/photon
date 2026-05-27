import { strict as assert } from 'assert';
import Nango from '../photons/nango.photon.ts';

type FetchCall = {
  url: string;
  init: RequestInit;
};

const calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function mockFetch(data: unknown, init: { status?: number; contentType?: string } = {}) {
  globalThis.fetch = (async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit || {} });
    return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
      status: init.status || 200,
      statusText: init.status && init.status >= 400 ? 'Bad Request' : 'OK',
      headers: {
        'content-type': init.contentType || 'application/json',
        'x-test': 'yes',
      },
    });
  }) as typeof fetch;
}

function reset() {
  calls.length = 0;
}

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    reset();
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await test('creates connect sessions with merged tags', async () => {
  mockFetch({ data: { token: 'session-token', connect_link: 'https://connect.example' } });
  const nango = new Nango('secret', 'https://nango.example/');

  const result = await nango.createConnectSession({
    allowedIntegrations: ['github'],
    tags: { plan: 'pro' },
    endUserId: 'user_123',
    organizationId: 'org_456',
  });

  assert.deepEqual(result, {
    data: { token: 'session-token', connect_link: 'https://connect.example' },
  });
  assert.equal(calls[0].url, 'https://nango.example/connect/sessions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    allowed_integrations: ['github'],
    tags: {
      plan: 'pro',
      end_user_id: 'user_123',
      organization_id: 'org_456',
    },
  });
});

await test('lists connections with integration and tag query params', async () => {
  mockFetch({ connections: [] });
  const nango = new Nango('secret', 'https://nango.example');

  await nango.listConnections({
    integrationId: 'hubspot',
    tags: { end_user_id: 'user_123' },
  });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/connections');
  assert.equal(url.searchParams.get('integration_id'), 'hubspot');
  assert.equal(url.searchParams.get('tags[end_user_id]'), 'user_123');
});

await test('triggers actions with Nango execution headers', async () => {
  mockFetch({ id: 'action_123', statusUrl: '/action/action_123' });
  const nango = new Nango('secret', 'https://nango.example');

  await nango.triggerAction({
    integrationId: 'github',
    connectionId: 'conn_123',
    actionName: 'create-issue',
    input: { owner: 'NangoHQ', repo: 'nango', title: 'Hello' },
    async: true,
    maxRetries: 3,
  });

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(calls[0].url, 'https://nango.example/action/trigger');
  assert.equal(headers['Connection-Id'], 'conn_123');
  assert.equal(headers['Provider-Config-Key'], 'github');
  assert.equal(headers['X-Async'], 'true');
  assert.equal(headers['X-Max-Retries'], '3');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    action_name: 'create-issue',
    input: { owner: 'NangoHQ', repo: 'nango', title: 'Hello' },
  });
});

await test('wraps proxy responses in status/header envelope', async () => {
  mockFetch({ ok: true });
  const nango = new Nango('secret', 'https://nango.example');

  const result = await nango.proxyRequest({
    integrationId: 'github',
    connectionId: 'conn_123',
    method: 'POST',
    endpoint: '/repos/owner/repo/issues',
    data: { title: 'Hello' },
    retries: 2,
  });

  const url = new URL(calls[0].url);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(url.pathname, '/proxy/repos/owner/repo/issues');
  assert.equal(url.searchParams.get('retries'), '2');
  assert.equal(headers['Connection-Id'], 'conn_123');
  assert.equal(result.status, 200);
  assert.equal(result.headers['x-test'], 'yes');
  assert.deepEqual(result.data, { ok: true });
});

await test('throws useful errors for failed Nango calls', async () => {
  mockFetch({ error: 'bad input' }, { status: 400 });
  const nango = new Nango('secret', 'https://nango.example');

  await assert.rejects(
    () => nango.getConnection({ integrationId: 'github', connectionId: 'missing' }),
    /Nango API request failed \(400 Bad Request\).*bad input/
  );
});

globalThis.fetch = originalFetch;
