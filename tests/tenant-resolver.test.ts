import assert from 'node:assert/strict';
import { MemoryTenantStore, TenantResolver } from '../src/serv/middleware/tenant.js';
import type { Tenant } from '../src/serv/types/index.js';

const tenant: Tenant = {
  id: 'tenant-1',
  name: 'Acme',
  slug: 'acme',
  region: 'us',
  plan: 'pro',
  encryptionKeyId: 'key-1',
  createdAt: new Date(),
  settings: {
    allowAnonymousUsers: false,
    sponsoredPhotons: [],
    customDomain: 'mcp.acme.com',
  },
};

const store = new MemoryTenantStore();
store.add(tenant);
const resolver = new TenantResolver({ store, baseDomain: 'serv.example.com' });

const hosts = [
  'acme.serv.example.com',
  'acme.serv.example.com:8443',
  'ACME.serv.example.com',
  'mcp.acme.com',
  'mcp.acme.com:8443',
  'MCP.acme.com',
  'mcp.acme.com.',
];

for (const host of hosts) {
  const resolved = await resolver.resolve({ host });
  assert.equal(resolved?.id, tenant.id, `expected ${host} to resolve to ${tenant.id}`);
}

console.log('tenant resolver tests passed');
