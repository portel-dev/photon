import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createPhotonAuthKeypair, signPhotonAuthToken } from '../src/auth/mcp-jwt.js';
import { PhotonServer } from '../src/server.js';

const audience = 'http://127.0.0.1/mcp';

async function postMcp(port: number, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    json: await res.json(),
    wwwAuthenticate: res.headers.get('www-authenticate'),
  };
}

describe('local MCP JWT auth', () => {
  let server: PhotonServer | undefined;
  const oldEnv = { ...process.env };

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    process.env = { ...oldEnv };
  });

  it('requires valid JWT scopes before local Beam MCP tool dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-local-jwt-'));
    const photonPath = join(root, 'appointments.photon.ts');
    await writeFile(
      photonPath,
      `
export default class Appointments {
  /**
   * @readOnly
   */
  async listSlots() {
    return [{ id: 'slot_1' }];
  }

  /**
   * @scope bookings:write
   */
  async book() {
    return { caller: (this as any).caller.id };
  }
}
`
    );

    const auth = createPhotonAuthKeypair('appointments', new Date('2026-05-22T00:00:00Z'));
    process.env.PHOTON_MCP_AUTH_MODE = 'jwt';
    process.env.PHOTON_MCP_JWT_ISSUER = auth.issuer.issuer;
    process.env.PHOTON_MCP_JWT_AUDIENCE = audience;
    process.env.PHOTON_MCP_JWT_JWKS = JSON.stringify(auth.jwks);

    const port = 31000 + Math.floor(Math.random() * 30000);
    server = new PhotonServer({ filePath: photonPath, transport: 'sse', port });
    await server.start();

    const list = await postMcp(port, {
      jsonrpc: '2.0',
      id: 'list',
      method: 'tools/list',
      params: {},
    });
    expect(list.status).toBe(200);
    const toolName = list.json.result.tools.find(
      (tool: any) =>
        tool.name === 'book' || tool.name.endsWith('.book') || tool.name.endsWith('/book')
    ).name;
    const readToolName = list.json.result.tools.find(
      (tool: any) =>
        tool.name === 'listSlots' ||
        tool.name.endsWith('.listSlots') ||
        tool.name.endsWith('/listSlots')
    ).name;
    expect(list.json.result.tools.find((tool: any) => tool.name === readToolName).scopes).toEqual([
      'listSlots:read',
    ]);

    const missingToken = await postMcp(port, {
      jsonrpc: '2.0',
      id: 'missing',
      method: 'tools/call',
      params: { name: toolName, arguments: {} },
    });
    expect(missingToken.status).toBe(401);

    const underScoped = signPhotonAuthToken(auth.issuer, auth.privateJwk, {
      agent: 'scheduler',
      audience,
      scopes: ['bookings:read'],
    });
    const forbidden = await postMcp(
      port,
      {
        jsonrpc: '2.0',
        id: 'scope',
        method: 'tools/call',
        params: { name: toolName, arguments: {} },
      },
      underScoped
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.wwwAuthenticate).toContain('insufficient_scope');

    const allowed = signPhotonAuthToken(auth.issuer, auth.privateJwk, {
      agent: 'scheduler',
      audience,
      scopes: ['bookings:write'],
    });
    const ok = await postMcp(
      port,
      {
        jsonrpc: '2.0',
        id: 'ok',
        method: 'tools/call',
        params: { name: toolName, arguments: {} },
      },
      allowed
    );
    expect(ok.status).toBe(200);
    expect(ok.json.result.content[0].text).toContain('agent:scheduler');

    const readOnlyToken = signPhotonAuthToken(auth.issuer, auth.privateJwk, {
      agent: 'reader',
      audience,
      scopes: ['listSlots:read'],
    });
    const readOk = await postMcp(
      port,
      {
        jsonrpc: '2.0',
        id: 'read',
        method: 'tools/call',
        params: { name: readToolName, arguments: {} },
      },
      readOnlyToken
    );
    expect(readOk.status).toBe(200);
  }, 15_000);
});
