/**
 * CIMD (Client ID Metadata Document) resolution tests.
 *
 * Covers the structured-error taxonomy, cache, domain allowlist, and
 * ETag-based revalidation for `resolveClientMetadata`.
 */

import assert from 'node:assert/strict';
import {
  resolveClientMetadata,
  CimdCache,
  __test__,
  type ClientMetadataDocument,
} from '../src/serv/auth/well-known.js';

const { isDomainAllowed, resolveTtlMs } = __test__;

type FetchFn = typeof fetch;

function okDocument(
  clientId: string,
  overrides: Partial<ClientMetadataDocument> = {}
): ClientMetadataDocument {
  return {
    client_id: clientId,
    redirect_uris: ['https://example.app/callback'],
    client_name: 'Example',
    ...overrides,
  };
}

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit
  ) => { status: number; body?: unknown; headers?: Record<string, string> }
): FetchFn {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const result = handler(url, init);
    const headers = new Headers(result.headers ?? { 'content-type': 'application/json' });
    const body =
      result.body === undefined
        ? ''
        : typeof result.body === 'string'
          ? result.body
          : JSON.stringify(result.body);
    return new Response(body, { status: result.status, headers });
  }) as FetchFn;
}

async function run() {
  await test('rejects non-HTTPS client_id with not_https error', async () => {
    const result = await resolveClientMetadata('http://example.com/cimd');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'not_https');
  });

  await test('rejects malformed URL with not_https error', async () => {
    const result = await resolveClientMetadata('https://');
    assert.equal(result.ok, false);
    assert.ok(result.error === 'not_https' || result.error === 'fetch_failed');
  });

  await test('happy path returns metadata + caches with default TTL', async () => {
    const clientId = 'https://example.com/cimd';
    const cache = new CimdCache();
    const fetchImpl = mockFetch(() => ({ status: 200, body: okDocument(clientId) }));

    const result = await resolveClientMetadata(clientId, { cache, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.metadata?.client_id, clientId);
    assert.equal(result.fromCache, undefined);
    assert.equal(cache.size(), 1);

    // Second call hits cache
    const cached = await resolveClientMetadata(clientId, { cache, fetchImpl });
    assert.equal(cached.ok, true);
    assert.equal(cached.fromCache, true);
  });

  await test('client_id mismatch rejected', async () => {
    const clientId = 'https://example.com/cimd';
    const fetchImpl = mockFetch(() => ({
      status: 200,
      body: { client_id: 'https://attacker.example/cimd', redirect_uris: ['https://x/cb'] },
    }));
    const result = await resolveClientMetadata(clientId, { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'client_id_mismatch');
  });

  await test('missing redirect_uris rejected', async () => {
    const clientId = 'https://example.com/cimd';
    const fetchImpl = mockFetch(() => ({
      status: 200,
      body: { client_id: clientId, redirect_uris: [] },
    }));
    const result = await resolveClientMetadata(clientId, { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing_redirect_uris');
  });

  await test('disallowed domain rejected before fetch', async () => {
    const clientId = 'https://attacker.com/cimd';
    let fetched = false;
    const fetchImpl = mockFetch(() => {
      fetched = true;
      return { status: 200, body: okDocument(clientId) };
    });
    const result = await resolveClientMetadata(clientId, {
      fetchImpl,
      allowedDomains: ['claude.ai', '*.openai.com'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'domain_not_allowed');
    assert.equal(fetched, false, 'should short-circuit before network');
  });

  await test('wildcard subdomain allowlist matches', async () => {
    const clientId = 'https://login.openai.com/cimd';
    const fetchImpl = mockFetch(() => ({ status: 200, body: okDocument(clientId) }));
    const result = await resolveClientMetadata(clientId, {
      fetchImpl,
      allowedDomains: ['*.openai.com'],
    });
    assert.equal(result.ok, true);
  });

  await test('wildcard does not match apex domain', async () => {
    const clientId = 'https://openai.com/cimd';
    const fetchImpl = mockFetch(() => ({ status: 200, body: okDocument(clientId) }));
    const result = await resolveClientMetadata(clientId, {
      fetchImpl,
      allowedDomains: ['*.openai.com'], // wildcard only matches subdomains
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'domain_not_allowed');
  });

  await test('HTTP error surfaces as http_error', async () => {
    const fetchImpl = mockFetch(() => ({ status: 503 }));
    const result = await resolveClientMetadata('https://example.com/cimd', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'http_error');
  });

  await test('invalid JSON surfaces as invalid_json', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 200,
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    }));
    const result = await resolveClientMetadata('https://example.com/cimd', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_json');
  });

  await test('fetch throw surfaces as fetch_failed', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as FetchFn;
    const result = await resolveClientMetadata('https://example.com/cimd', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'fetch_failed');
  });

  await test('304 Not Modified extends cached entry', async () => {
    const clientId = 'https://example.com/cimd';
    const cache = new CimdCache();
    let call = 0;
    const fetchImpl = mockFetch(() => {
      call++;
      if (call === 1) {
        return {
          status: 200,
          body: okDocument(clientId),
          headers: {
            etag: '"v1"',
            'cache-control': 'max-age=1',
            'content-type': 'application/json',
          },
        };
      }
      return { status: 304, headers: { 'cache-control': 'max-age=3600' } };
    });

    // Prime cache, let it expire
    const first = await resolveClientMetadata(clientId, { cache, fetchImpl });
    assert.equal(first.ok, true);
    // Force expiry
    const entry = cache.get(clientId)!;
    entry.expiresAt = Date.now() - 1000;

    const second = await resolveClientMetadata(clientId, { cache, fetchImpl });
    assert.equal(second.ok, true);
    assert.equal(second.fromCache, true, '304 should hit cached body');
    assert.ok(cache.get(clientId)!.expiresAt > Date.now(), 'TTL should be refreshed');
  });

  await test('Cache-Control: max-age honored', () => {
    const res = new Response('', { headers: { 'cache-control': 'public, max-age=120' } });
    assert.equal(resolveTtlMs(res), 120 * 1000);
  });

  await test('CimdCache LRU eviction', () => {
    const cache = new CimdCache(2);
    cache.set('a', { metadata: okDocument('a'), expiresAt: Date.now() + 10_000 });
    cache.set('b', { metadata: okDocument('b'), expiresAt: Date.now() + 10_000 });
    cache.set('c', { metadata: okDocument('c'), expiresAt: Date.now() + 10_000 });
    assert.equal(cache.size(), 2);
    assert.equal(cache.get('a'), undefined, 'oldest should be evicted');
    assert.ok(cache.get('b'));
    assert.ok(cache.get('c'));
  });

  await test('isDomainAllowed: exact match', () => {
    assert.equal(isDomainAllowed('claude.ai', ['claude.ai']), true);
    assert.equal(isDomainAllowed('evil.com', ['claude.ai']), false);
    assert.equal(isDomainAllowed('CLAUDE.AI', ['claude.ai']), true, 'case-insensitive');
  });

  await test('isDomainAllowed: empty allowlist means allow all', () => {
    assert.equal(isDomainAllowed('anything.com', undefined), true);
    assert.equal(isDomainAllowed('anything.com', []), true);
  });
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
