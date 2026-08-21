import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PhotonServer } from '../src/server.js';
import { PhotonOAuthRuntime } from '../src/auth/runtime-oauth.js';

function form(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

async function mcp(port: number, body: unknown, token?: string) {
  const request =
    typeof body === 'object' && body !== null
      ? {
          ...(body as Record<string, unknown>),
          params: {
            ...(((body as Record<string, unknown>).params as Record<string, unknown> | undefined) ||
              {}),
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': {
                name: 'photon-runtime-oauth-test',
                version: '1.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }
      : body;
  const requestParams =
    typeof request === 'object' && request !== null
      ? (request as { params?: { name?: unknown } }).params
      : undefined;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Protocol-Version': '2026-07-28',
      'Mcp-Method':
        typeof request === 'object' && request !== null && 'method' in request
          ? String((request as { method?: unknown }).method || '')
          : '',
      ...(typeof requestParams?.name === 'string' ? { 'Mcp-Name': requestParams.name } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
  });
  return {
    status: response.status,
    body: await response.json(),
    challenge: response.headers.get('www-authenticate'),
  };
}

describe('Photon inbound OAuth runtime', () => {
  let server: PhotonServer | undefined;
  const original = { ...process.env };

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    process.env = { ...original };
  });

  it('negotiates OAuth and changes the optional-auth catalog by caller role', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-runtime-oauth-'));
    const source = join(root, 'consult.photon.ts');
    await writeFile(
      source,
      `
/** @auth oauth optional */
export default class Consult {
  get role() { return this.caller.role || 'anonymous'; }
  /** @class Consult {@role anonymous} */
  async findSlots() { return ['slot']; }
  /** @class Consult {@role host} @scope availability:write */
  async updateAvailability() { return { caller: this.caller.id, role: this.caller.role }; }
}
`
    );

    const port = 31000 + Math.floor(Math.random() * 30000);
    const base = `http://127.0.0.1:${port}`;
    process.env.PHOTON_PUBLIC_URL = base;
    process.env.PHOTON_OAUTH_SINGLE_USER_ID = 'owner-1';
    process.env.PHOTON_OAUTH_SINGLE_USER_ROLE = 'host';
    process.env.PHOTON_OAUTH_HOST_SUBJECTS = 'owner-1';
    server = new PhotonServer({ filePath: source, transport: 'sse', port, devMode: true });
    await server.start();

    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(metadata.status).toBe(200);
    const resourceMetadata = await metadata.json();
    expect(resourceMetadata.resource).toBe(`${base}/mcp`);
    expect(resourceMetadata.scopes_supported).toEqual(
      expect.arrayContaining(['findSlots:write', 'availability:write'])
    );
    const authorizationMetadata = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect((await authorizationMetadata.json()).scopes_supported).toEqual(
      expect.arrayContaining(['findSlots:write', 'availability:write'])
    );
    const jwks = await fetch(`${base}/.well-known/jwks.json`);
    expect((await jwks.json()).keys).toHaveLength(1);

    const anonymous = await mcp(port, {
      jsonrpc: '2.0',
      id: 'anonymous-list',
      method: 'tools/list',
      params: {},
    });
    expect(anonymous.status).toBe(200);
    const anonymousNames = anonymous.body.result.tools.map((tool: any) => tool.name);
    expect(anonymousNames).toContain('findSlots');
    expect(anonymousNames).not.toContain('updateAvailability');

    const registration = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Photon OAuth test',
        redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
      }),
    });
    const client = await registration.json();
    const proof = pkce();
    const authorize = new URL(`${base}/authorize`);
    authorize.searchParams.set('client_id', client.client_id);
    authorize.searchParams.set('redirect_uri', 'http://127.0.0.1/callback');
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'availability:write');
    authorize.searchParams.set('resource', `${base}/mcp`);
    authorize.searchParams.set('code_challenge', proof.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    const consentRedirect = await fetch(authorize, { redirect: 'manual' });
    expect(consentRedirect.status).toBe(302);
    const consent = new URL(consentRedirect.headers.get('location')!);
    const approval = await fetch(consent, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ req: consent.searchParams.get('req')!, decision: 'approve' }),
    });
    const callback = new URL(approval.headers.get('location')!);
    const tokenResponse = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code')!,
        redirect_uri: 'http://127.0.0.1/callback',
        client_id: client.client_id,
        code_verifier: proof.verifier,
        resource: `${base}/mcp`,
      }),
    });
    const token = await tokenResponse.json();
    expect(token.access_token).toBeTypeOf('string');

    const host = await mcp(
      port,
      { jsonrpc: '2.0', id: 'host-list', method: 'tools/list', params: {} },
      token.access_token
    );
    expect(host.status).toBe(200);
    const hostNames = host.body.result.tools.map((tool: any) => tool.name);
    expect(hostNames).toContain('updateAvailability');
    expect(hostNames).not.toContain('findSlots');

    const call = await mcp(
      port,
      {
        jsonrpc: '2.0',
        id: 'host-call',
        method: 'tools/call',
        params: { name: 'updateAvailability', arguments: {} },
      },
      token.access_token
    );
    expect(call.status).toBe(200);
    expect(call.body.result.content[0].text).toContain('owner-1');
  }, 20_000);

  it('challenges anonymous discovery when OAuth is required', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-runtime-oauth-required-'));
    const source = join(root, 'private.photon.ts');
    await writeFile(
      source,
      `
/** @auth oauth required */
export default class PrivatePhoton {
  async privateTool() { return 'private'; }
}
`
    );

    const port = 31000 + Math.floor(Math.random() * 30000);
    process.env.PHOTON_PUBLIC_URL = `http://127.0.0.1:${port}`;
    process.env.PHOTON_OAUTH_SINGLE_USER_ID = 'owner-1';
    server = new PhotonServer({ filePath: source, transport: 'sse', port, devMode: true });
    await server.start();

    const initialize = await mcp(port, {
      jsonrpc: '2.0',
      id: 'required-initialize',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'oauth-test', version: '1.0.0' },
      },
    });
    expect(initialize.status).toBe(401);
    expect(initialize.challenge).toContain('resource_metadata=');

    const response = await mcp(port, {
      jsonrpc: '2.0',
      id: 'required-list',
      method: 'tools/list',
      params: {},
    });
    expect(response.status).toBe(401);
    expect(response.challenge).toContain('resource_metadata=');
  });

  it('rejects the development single-user identity in production', async () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.PHOTON_OAUTH_SINGLE_USER_ID = 'owner-1';
    process.env.PHOTON_OAUTH_PRIVATE_KEY_PEM = keys.privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString();
    process.env.PHOTON_OAUTH_PUBLIC_KEY_PEM = keys.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();
    process.env.PHOTON_OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
    process.env.PHOTON_OAUTH_STATE_SECRET = randomBytes(32).toString('base64url');

    expect(
      () =>
        new PhotonOAuthRuntime({
          baseUrl: 'https://oauth.example.test',
          photonName: 'private',
        })
    ).toThrow(/development-only/);
  });

  it('does not leak protected tools from aggregated sub-photons', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-runtime-oauth-sub-photon-'));
    const source = join(root, 'main.photon.ts');
    await writeFile(
      join(root, 'admin.photon.ts'),
      `
export default class AdminPhoton {
  get role() { return this.caller.anonymous ? 'user' : this.caller.role; }
  /** @class AdminPhoton {@role host} */
  async hostOnly() { return 'secret'; }
}
`
    );
    await writeFile(
      source,
      `
/**
 * @auth oauth optional
 * @photon admin ./admin.photon.ts
 */
export default class MainPhoton {
  constructor(private admin: any) {}
  get role() { return this.caller.anonymous ? 'user' : this.caller.role; }
  /** @class MainPhoton {@role user} */
  async publicTool() { return 'public'; }
}
`
    );
    const port = 31000 + Math.floor(Math.random() * 30000);
    process.env.PHOTON_PUBLIC_URL = `http://127.0.0.1:${port}`;
    server = new PhotonServer({ filePath: source, transport: 'sse', port, devMode: true });
    await server.start();

    const list = await mcp(port, {
      jsonrpc: '2.0',
      id: 'sub-list',
      method: 'tools/list',
      params: {},
    });
    const names = list.body.result.tools.map((tool: any) => tool.name);
    expect(names).toContain('publicTool');
    expect(names).not.toContain('admin-photon.hostOnly');

    const call = await mcp(port, {
      jsonrpc: '2.0',
      id: 'sub-call',
      method: 'tools/call',
      params: { name: 'admin-photon.hostOnly', arguments: {} },
    });
    expect(call.status).toBe(401);
  });
});
