import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createPhotonAuthKeypair } from '../src/auth/mcp-jwt.js';
import { deployToCloudflare } from '../src/deploy/cloudflare.js';

describe('Cloudflare MCP JWT deploy wiring', () => {
  it('requires explicit jwt auth mode and embeds public verifier config plus @scope metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-cf-jwt-'));
    const photonDir = join(root, 'project');
    const authDir = join(root, 'photon-home', 'auth', 'appointments');
    const outputDir = join(root, 'out');
    await mkdir(photonDir, { recursive: true });
    await mkdir(authDir, { recursive: true });

    const material = createPhotonAuthKeypair('appointments', new Date('2026-05-22T00:00:00Z'));
    await writeFile(join(authDir, 'issuer.json'), JSON.stringify(material.issuer, null, 2));
    await writeFile(join(authDir, 'private.jwk'), JSON.stringify(material.privateJwk, null, 2));
    await writeFile(join(authDir, 'public.jwk'), JSON.stringify(material.publicJwk, null, 2));
    await writeFile(join(authDir, 'jwks.json'), JSON.stringify(material.jwks, null, 2));

    const photonPath = join(photonDir, 'appointments.photon.ts');
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
   * @scope bookings:read availability:write
   */
  async book({ name }: { name: string }) {
    return { ok: true, name, caller: (this as any).caller.id };
  }
}
`
    );

    const oldPhotonDir = process.env.PHOTON_DIR;
    process.env.PHOTON_DIR = join(root, 'photon-home');
    try {
      await deployToCloudflare({
        photonPath,
        outputDir,
        dryRun: true,
        mcpAuth: 'jwt',
        mcpAudience: 'https://appointments.example.com/mcp',
      });
    } finally {
      if (oldPhotonDir === undefined) delete process.env.PHOTON_DIR;
      else process.env.PHOTON_DIR = oldPhotonDir;
    }

    const worker = await readFile(join(outputDir, 'src', 'worker.ts'), 'utf-8');
    expect(worker).toContain('const MCP_AUTH_MODE = "jwt"');
    expect(worker).toContain('const MCP_JWT_ISSUER = "photon-local:appointments"');
    expect(worker).toContain('const MCP_JWT_AUDIENCE = "https://appointments.example.com/mcp"');
    expect(worker).toContain('"listSlots:read"');
    expect(worker).toContain('"bookings:read"');
    expect(worker).toContain('"availability:write"');
    expect(worker).toContain('function checkMcpAuth(');
    expect(worker).toContain("Object.defineProperty(instance, 'caller'");
  });

  it('fails closed when jwt deploy omits an explicit audience', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-cf-jwt-no-aud-'));
    const photonDir = join(root, 'project');
    const authDir = join(root, 'photon-home', 'auth', 'appointments');
    const outputDir = join(root, 'out');
    await mkdir(photonDir, { recursive: true });
    await mkdir(authDir, { recursive: true });

    const material = createPhotonAuthKeypair('appointments', new Date('2026-05-22T00:00:00Z'));
    await writeFile(join(authDir, 'issuer.json'), JSON.stringify(material.issuer, null, 2));
    await writeFile(join(authDir, 'jwks.json'), JSON.stringify(material.jwks, null, 2));

    const photonPath = join(photonDir, 'appointments.photon.ts');
    await writeFile(
      photonPath,
      `export default class Appointments { async ping() { return 'pong'; } }`
    );

    const oldPhotonDir = process.env.PHOTON_DIR;
    const oldAudience = process.env.PHOTON_MCP_JWT_AUDIENCE;
    process.env.PHOTON_DIR = join(root, 'photon-home');
    delete process.env.PHOTON_MCP_JWT_AUDIENCE;
    try {
      await expect(
        deployToCloudflare({
          photonPath,
          outputDir,
          dryRun: true,
          mcpAuth: 'jwt',
        })
      ).rejects.toThrow(/requires an audience/);
    } finally {
      if (oldPhotonDir === undefined) delete process.env.PHOTON_DIR;
      else process.env.PHOTON_DIR = oldPhotonDir;
      if (oldAudience === undefined) delete process.env.PHOTON_MCP_JWT_AUDIENCE;
      else process.env.PHOTON_MCP_JWT_AUDIENCE = oldAudience;
    }
  });

  it('does not silently enable jwt mode when auth files exist without opt-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-cf-jwt-legacy-'));
    const photonDir = join(root, 'project');
    const outputDir = join(root, 'out');
    await mkdir(photonDir, { recursive: true });
    const photonPath = join(photonDir, 'appointments.photon.ts');
    await writeFile(
      photonPath,
      `export default class Appointments { async ping() { return 'pong'; } }`
    );

    await deployToCloudflare({ photonPath, outputDir, dryRun: true });
    const worker = await readFile(join(outputDir, 'src', 'worker.ts'), 'utf-8');
    expect(worker).toContain('const MCP_AUTH_MODE = "legacy"');
  });
});
