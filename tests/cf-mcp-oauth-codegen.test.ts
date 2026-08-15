import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as ts from 'typescript';
import { build } from 'esbuild';
import { deployToCloudflare } from '../src/deploy/cloudflare.js';

async function generate(
  options: {
    kvId?: string;
    authMode?: 'optional' | 'required';
    authTag?: string;
    inferFromAuth?: boolean;
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'photon-cf-mcp-oauth-'));
  const project = join(root, 'project');
  const output = join(root, 'out');
  await mkdir(project, { recursive: true });
  const photonPath = join(project, 'appointments.photon.ts');
  await writeFile(
    photonPath,
    `
${options.authTag ? `/** ${options.authTag} */` : options.authMode ? `/** @auth oauth ${options.authMode} */` : ''}
export default class Appointments {
  get role() { return this.caller.anonymous ? 'user' : 'host'; }

  /** @class Appointments {@role user} @scope bookings:read */
  async listSlots() { return []; }

  /** @class Appointments {@role host} @scope availability:write */
  async updateAvailability() { return { ok: true }; }
}
`
  );

  const previousKvId = process.env.PHOTON_MCP_OAUTH_KV_ID;
  if (options.kvId) process.env.PHOTON_MCP_OAUTH_KV_ID = options.kvId;
  else delete process.env.PHOTON_MCP_OAUTH_KV_ID;
  try {
    const deployOptions: Parameters<typeof deployToCloudflare>[0] = {
      photonPath,
      outputDir: output,
      dryRun: true,
      publicUrl: 'https://consult.example.test',
      ...(options.inferFromAuth ? {} : { mcpAuth: 'oauth' as const }),
    };
    await deployToCloudflare(deployOptions);
  } finally {
    if (previousKvId === undefined) delete process.env.PHOTON_MCP_OAUTH_KV_ID;
    else process.env.PHOTON_MCP_OAUTH_KV_ID = previousKvId;
  }
  return {
    output,
    worker: await readFile(join(output, 'src', 'worker.ts'), 'utf8'),
    wrangler: await readFile(join(output, 'wrangler.toml'), 'utf8'),
  };
}

describe('Cloudflare generated inbound MCP OAuth', () => {
  it('accepts oauth mode and emits the complete discovery and authorization route slice', async () => {
    const generated = await generate();

    expect(generated.worker).toContain('const MCP_AUTH_MODE = "oauth"');
    expect(generated.worker).toContain('const MCP_OAUTH_ISSUER = "https://consult.example.test"');
    expect(generated.worker).toContain('const MCP_OAUTH_AUTH_MODE = "required"');
    expect(generated.worker).toContain("'/.well-known/oauth-protected-resource'");
    expect(generated.worker).toContain("'/.well-known/oauth-authorization-server'");
    expect(generated.worker).toContain("'/.well-known/jwks.json'");
    expect(generated.worker).toContain("pathname === '/authorize'");
    expect(generated.worker).toContain("requestPath === '/oauth/login'");
    expect(generated.worker).toContain("pathname === '/token'");
    expect(generated.worker).toContain("pathname === '/register'");
    expect(generated.worker).toContain("pathname === '/consent'");
    expect(generated.worker).toContain("pathname === '/revoke'");
    expect(generated.worker).toContain("pathname === '/introspect'");
    expect(generated.worker).toContain('resource_metadata="');
    expect(generated.worker).toContain('photonOAuthCaller');
    expect(generated.worker).toContain('const role = typeof claims.role');
    expect(generated.worker).toContain(": 'user'");
    expect(generated.worker).toContain('scope: scope || undefined');
    expect(generated.worker).toContain("role: 'user'");
    expect(generated.worker).toContain("role !== 'user'");
    expect(generated.worker).not.toContain('PHOTON_MCP_OAUTH_TRUST_CF_ACCESS');
    expect(generated.worker).toContain('if (DEV_MODE)');
    expect(generated.worker).toContain('const origin = MCP_OAUTH_ISSUER');
    expect(generated.worker).toContain(
      "token_endpoint_auth_methods_supported: ['none', 'client_secret_post']"
    );
    expect(generated.worker).not.toContain('client_secret_basic');
    expect(generated.worker).toContain(
      "const instance = isOAuthEndpoint ? 'default' : extractInstance(request, env);"
    );
    expect(generated.worker).toContain('this.ctx.storage');
    expect(generated.worker.match(/storage\.transaction/g)).toHaveLength(2);
    expect(generated.wrangler).toContain(
      'MCP OAuth state is authoritative in the host Durable Object ctx.storage.'
    );
    expect(generated.wrangler).toContain('PHOTON_MCP_OAUTH_LOGIN_URL');
    expect(generated.worker).toContain("pathname === '/oauth/login'");
    expect(generated.worker).toContain('PHOTON_MCP_OAUTH_HOST_SUBJECTS');
    expect(generated.worker).toContain('Cf-Access-Authenticated-User-Email');
    expect(generated.worker).toContain('wants to connect to Photon');
    expect(generated.worker).toContain('name="scope"');
    expect(generated.worker).toContain('Allow access');
    expect(generated.worker).toContain('const grantedScope = selectedScopes.join');
  });

  it('emits the optional KV binding contract without changing the authoritative state model', async () => {
    const generated = await generate({ kvId: 'oauth-kv-id' });

    expect(generated.wrangler).toContain('binding = "PHOTON_OAUTH_KV"');
    expect(generated.wrangler).toContain('id = "oauth-kv-id"');
    expect(generated.wrangler).toContain('authoritative in Durable Object storage');
  });

  it('infers optional OAuth from the class-level Photon auth contract', async () => {
    const generated = await generate({ authMode: 'optional', inferFromAuth: true });

    expect(generated.worker).toContain('const MCP_AUTH_MODE = "oauth"');
    expect(generated.worker).toContain('const MCP_OAUTH_AUTH_MODE = "optional"');
    expect(generated.worker).toContain(
      "supplied || (method !== 'tools/list' && !bypass.has(method) && !publicPropertyTool)"
    );
  });

  it('infers required OAuth and challenges anonymous discovery and calls', async () => {
    const generated = await generate({ authMode: 'required', inferFromAuth: true });

    expect(generated.worker).toContain('const MCP_AUTH_MODE = "oauth"');
    expect(generated.worker).toContain('const MCP_OAUTH_AUTH_MODE = "required"');
    expect(generated.worker).toContain("request.method === 'POST'");
  });

  it('preserves legacy @auth oauth and fails closed for malformed or duplicate metadata', async () => {
    const legacy = await generate({ authTag: '@auth oauth', inferFromAuth: true });
    expect(legacy.worker).toContain('const MCP_AUTH_MODE = "legacy"');
    expect(legacy.worker).not.toContain('Generated inbound MCP OAuth');
    await expect(generate({ authTag: '@auth oauth maybe', inferFromAuth: true })).rejects.toThrow(
      /Invalid class-level @auth metadata/
    );
    await expect(
      generate({
        authTag: '@auth oauth optional\n * @auth oauth required',
        inferFromAuth: true,
      })
    ).rejects.toThrow(/Only one class-level @auth tag/);
  });

  it('keeps legacy auth generation untouched when oauth is not selected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-cf-mcp-auth-legacy-'));
    const project = join(root, 'project');
    const output = join(root, 'out');
    await mkdir(project, { recursive: true });
    const photonPath = join(project, 'probe.photon.ts');
    await writeFile(photonPath, `export default class Probe { async ping() { return 'pong'; } }`);

    await deployToCloudflare({ photonPath, outputDir: output, dryRun: true, mcpAuth: 'open' });
    const worker = await readFile(join(output, 'src', 'worker.ts'), 'utf8');
    expect(worker).toContain('const MCP_AUTH_MODE = "open"');
    expect(worker).not.toContain('Generated inbound MCP OAuth');
  });

  it('requires a stable issuer for OAuth generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photon-cf-mcp-oauth-issuer-'));
    const project = join(root, 'project');
    const output = join(root, 'out');
    await mkdir(project, { recursive: true });
    const photonPath = join(project, 'probe.photon.ts');
    await writeFile(photonPath, `export default class Probe { async ping() { return 'pong'; } }`);

    await expect(
      deployToCloudflare({ photonPath, outputDir: output, dryRun: true, mcpAuth: 'oauth' })
    ).rejects.toThrow(/stable issuer/);
  });

  it('emits TypeScript that the Cloudflare worker compiler can parse', async () => {
    const generated = await generate();
    const result = ts.transpileModule(generated.worker, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    expect(result.diagnostics ?? []).toEqual([]);
    await expect(
      build({
        entryPoints: [join(generated.output, 'src', 'worker.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        external: ['cloudflare:workers', 'node:async_hooks', 'cron-parser'],
      })
    ).resolves.toBeDefined();
  });
});
