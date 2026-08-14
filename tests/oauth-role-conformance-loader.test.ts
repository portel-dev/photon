/**
 * Transport-neutral OAuth role conformance at the PhotonLoader boundary.
 *
 * Run with:
 *   bunx tsx tests/oauth-role-conformance-loader.test.ts
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PhotonLoader } from '../src/loader.js';

type Caller = {
  id: string;
  anonymous: boolean;
  scope?: string;
  scopes?: string[];
  claims?: Record<string, unknown>;
};

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/oauth-role-conformance/roles.photon.ts'
);

const anonymous: Caller = { id: 'anonymous', anonymous: true };
const customer: Caller = {
  id: 'customer-1',
  anonymous: false,
  scope: 'bookings:read',
  scopes: ['bookings:read'],
  claims: { role: 'customer' },
};
const host: Caller = {
  id: 'host-1',
  anonymous: false,
  scope: 'availability:write',
  scopes: ['availability:write'],
  claims: { role: 'host' },
};

function visibleTools(loader: PhotonLoader, mcp: any, caller: Caller): string[] {
  return mcp.tools
    .filter((tool: any) => loader.isToolAccessible(mcp, tool.name, caller))
    .map((tool: any) => tool.name)
    .sort();
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  const loader = new PhotonLoader();
  const mcp = await loader.loadFile(fixturePath);

  console.log('OAuth role conformance — PhotonLoader:');

  await test('preserves optional OAuth metadata for the Photon class', () => {
    // `mcp.auth` remains the backward-compatible raw representation for a
    // structured directive; transports must use authDirective for its mode.
    assert.equal(mcp.auth, 'oauth optional');
    assert.deepEqual(mcp.authDirective, {
      scheme: 'oauth',
      mode: 'optional',
      raw: 'oauth optional',
    });
  });

  await test('exposes disjoint anonymous, customer, and host catalogs', () => {
    assert.deepEqual(visibleTools(loader, mcp, anonymous), ['userSlots']);
    assert.deepEqual(visibleTools(loader, mcp, customer), [
      'customerBookings',
      'customerExactScope',
    ]);
    assert.deepEqual(visibleTools(loader, mcp, host), ['hostAvailability']);
  });

  await test('uses exact property values and fails closed for an unknown role', () => {
    const unknown: Caller = {
      id: 'unknown-1',
      anonymous: false,
      claims: { role: 'customer-admin' },
    };
    assert.deepEqual(visibleTools(loader, mcp, unknown), []);
    assert.equal(loader.isToolAccessible(mcp, 'hostAvailability', customer), false);
    assert.equal(loader.isToolAccessible(mcp, 'customerBookings', host), false);
  });

  await test('keeps request-scoped callers isolated during concurrent execution', async () => {
    const [customerResult, hostResult] = await Promise.all([
      loader.executeTool(mcp, 'customerBookings', {}, { caller: customer }),
      loader.executeTool(mcp, 'hostAvailability', {}, { caller: host }),
    ]);
    assert.deepEqual(customerResult, { role: 'customer', callerId: 'customer-1' });
    assert.deepEqual(hostResult, { role: 'host', callerId: 'host-1' });
  });

  console.log('PhotonLoader OAuth role conformance passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
