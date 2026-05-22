import type { Command } from 'commander';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { JsonWebKey } from 'node:crypto';
import {
  createPhotonAuthKeypair,
  normalizeScopes,
  signPhotonAuthToken,
  verifyPhotonAuthToken,
  type PhotonAuthIssuer,
} from '../../auth/mcp-jwt.js';

function authRoot(): string {
  return path.join(process.env.PHOTON_DIR || path.join(homedir(), '.photon'), 'auth');
}

export function photonAuthDir(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid photon auth name: ${name}`);
  }
  return path.join(authRoot(), name);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
}

async function writeJson(file: string, value: unknown, mode?: number): Promise<void> {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode });
}

function parseTtlSeconds(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const match = input.trim().match(/^(\d+)(s|m|h)?$/i);
  if (!match) throw new Error(`Invalid TTL: ${input}. Use values like 900s, 15m, or 1h.`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return value * multiplier;
}

export async function loadPhotonAuth(name: string): Promise<{
  dir: string;
  issuer: PhotonAuthIssuer;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  jwks: { keys: JsonWebKey[] };
}> {
  const dir = photonAuthDir(name);
  return {
    dir,
    issuer: await readJson<PhotonAuthIssuer>(path.join(dir, 'issuer.json')),
    privateJwk: await readJson<JsonWebKey>(path.join(dir, 'private.jwk')),
    publicJwk: await readJson<JsonWebKey>(path.join(dir, 'public.jwk')),
    jwks: await readJson<{ keys: JsonWebKey[] }>(path.join(dir, 'jwks.json')),
  };
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage Photon MCP OAuth/JWT auth');

  auth
    .command('init')
    .argument('<name>', 'Photon auth profile name')
    .option('--rotate', 'Overwrite an existing keypair')
    .description('Create a local ES256 issuer and keypair for deployed MCP JWT auth')
    .action(async (name: string, options: { rotate?: boolean }) => {
      const dir = photonAuthDir(name);
      if (existsSync(path.join(dir, 'private.jwk')) && !options.rotate) {
        throw new Error(`${dir} already exists. Pass --rotate to replace the signing key.`);
      }
      const material = createPhotonAuthKeypair(name);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.chmod(dir, 0o700).catch(() => {});
      await writeJson(path.join(dir, 'private.jwk'), material.privateJwk, 0o600);
      await fs.chmod(path.join(dir, 'private.jwk'), 0o600).catch(() => {});
      await writeJson(path.join(dir, 'public.jwk'), material.publicJwk, 0o644);
      await writeJson(path.join(dir, 'jwks.json'), material.jwks, 0o644);
      await writeJson(path.join(dir, 'issuer.json'), material.issuer, 0o644);
      console.log(`Created Photon auth issuer: ${material.issuer.issuer}`);
      console.log(`Public JWKS: ${path.join(dir, 'jwks.json')}`);
    });

  auth
    .command('token')
    .argument('<name>', 'Photon auth profile name')
    .requiredOption('--agent <id>', 'Stable agent/client identifier')
    .requiredOption('--audience <url>', 'MCP resource audience, usually https://host/mcp')
    .option('--tenant <id>', 'Tenant id claim', 'default')
    .option('--scope <scope...>', 'OAuth scopes; may be repeated or space-delimited')
    .option('--ttl <duration>', 'TTL such as 900s, 15m, or 1h')
    .description('Sign a short-lived JWT access token for an agent')
    .action(
      async (
        name: string,
        options: {
          agent: string;
          audience: string;
          tenant?: string;
          scope?: string[];
          ttl?: string;
        }
      ) => {
        const auth = await loadPhotonAuth(name);
        const token = signPhotonAuthToken(auth.issuer, auth.privateJwk, {
          agent: options.agent,
          audience: options.audience,
          tenant: options.tenant,
          scopes: normalizeScopes(options.scope ?? []),
          ttlSeconds: parseTtlSeconds(options.ttl, auth.issuer.defaultTtlSeconds),
        });
        console.log(token);
      }
    );

  auth
    .command('verify')
    .argument('<name>', 'Photon auth profile name')
    .argument('<token>', 'JWT access token')
    .requiredOption('--audience <url>', 'Expected MCP resource audience')
    .description('Verify a Photon local-issuer JWT')
    .action(async (name: string, token: string, options: { audience: string }) => {
      const auth = await loadPhotonAuth(name);
      const result = verifyPhotonAuthToken(token, {
        issuer: auth.issuer.issuer,
        audience: options.audience,
        jwks: auth.jwks,
      });
      if (!result.ok) {
        console.error(`Invalid token: ${result.reason}`);
        process.exit(1);
      }
      console.log(JSON.stringify(result.claims, null, 2));
    });
}
