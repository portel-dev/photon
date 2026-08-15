/**
 * Inbound MCP OAuth runtime for the standalone Node transport.
 *
 * This composes Photon's existing OAuth 2.1 authorization-server handlers
 * with a single deployed Photon.  Identity authentication remains an
 * explicit trust-boundary choice: local development may use a single subject,
 * while production can provide a trusted reverse-proxy subject header or an
 * external login URL.
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Serv,
  handleAuthServerHTTP,
  type AuthServerHTTPOptions,
  type Tenant,
} from '../serv/index.js';

export interface VerifiedOAuthCaller {
  sub: string;
  role: string;
  scope?: string;
  scopes: string[];
  [key: string]: unknown;
}

export type OAuthBearerVerification =
  | { ok: true; caller: VerifiedOAuthCaller }
  | { ok: false; reason: 'missing_token' | 'invalid_token' | 'insufficient_scope' };

export class PhotonOAuthRuntime {
  readonly issuer: string;
  readonly resource: string;
  readonly serv: Serv;
  readonly tenant: Tenant;
  private readonly singleUserId?: string;
  private readonly singleUserRole: string;
  private readonly subjectHeader?: string;
  private readonly hostSubjects: Set<string>;

  constructor(options: {
    baseUrl: string;
    photonName: string;
    devMode?: boolean;
    scopesSupported?: string[];
  }) {
    this.issuer = options.baseUrl.replace(/\/+$/, '');
    this.resource = `${this.issuer}/mcp`;
    this.singleUserId = process.env.PHOTON_OAUTH_SINGLE_USER_ID;
    if (!options.devMode && this.singleUserId) {
      throw new Error(
        'PHOTON_OAUTH_SINGLE_USER_ID is development-only. Configure a trusted identity provider for production OAuth.'
      );
    }
    this.singleUserRole = process.env.PHOTON_OAUTH_SINGLE_USER_ROLE || 'host';
    this.subjectHeader = process.env.PHOTON_OAUTH_SUBJECT_HEADER?.toLowerCase();
    this.hostSubjects = new Set(
      (process.env.PHOTON_OAUTH_HOST_SUBJECTS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (this.singleUserId && this.singleUserRole === 'host') {
      this.hostSubjects.add(this.singleUserId);
    }

    const configuredPrivateKey = process.env.PHOTON_OAUTH_PRIVATE_KEY_PEM;
    const configuredPublicKey = process.env.PHOTON_OAUTH_PUBLIC_KEY_PEM;
    if (
      !options.devMode &&
      (!configuredPrivateKey ||
        !configuredPublicKey ||
        !process.env.PHOTON_OAUTH_ENCRYPTION_KEY ||
        !process.env.PHOTON_OAUTH_STATE_SECRET)
    ) {
      throw new Error(
        'Production OAuth requires PHOTON_OAUTH_PRIVATE_KEY_PEM, PHOTON_OAUTH_PUBLIC_KEY_PEM, PHOTON_OAUTH_ENCRYPTION_KEY, and PHOTON_OAUTH_STATE_SECRET.'
      );
    }
    const keypair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privateKey = configuredPrivateKey
      ? configuredPrivateKey.replace(/\\n/g, '\n')
      : keypair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKey = configuredPublicKey
      ? configuredPublicKey.replace(/\\n/g, '\n')
      : keypair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const ephemeral = () => randomBytes(32).toString('base64url');

    this.tenant = {
      id: `photon:${options.photonName}`,
      name: options.photonName,
      slug: options.photonName,
      region: 'local',
      plan: 'free',
      encryptionKeyId: 'photon-local',
      settings: {
        allowAnonymousUsers: true,
        sponsoredPhotons: [],
        customDomain: this.issuer,
      },
      createdAt: new Date(),
    };

    const loginUrl = process.env.PHOTON_OAUTH_LOGIN_URL || `${this.issuer}/login`;
    this.serv = new Serv({
      baseUrl: this.issuer,
      baseDomain: new URL(this.issuer).host,
      jwtSecret: process.env.PHOTON_OAUTH_JWT_SECRET || ephemeral(),
      encryptionKey: process.env.PHOTON_OAUTH_ENCRYPTION_KEY || ephemeral(),
      stateSecret: process.env.PHOTON_OAUTH_STATE_SECRET || ephemeral(),
      scopesSupported: options.scopesSupported,
      jwt: {
        algorithm: 'ES256',
        privateKey,
        publicKey,
        kid: process.env.PHOTON_OAUTH_KEY_ID || 'photon-oauth-1',
      },
      endpointConfig: {
        loginUrl,
        singleUserId: this.singleUserId,
      },
    });
    this.serv.addTenant(this.tenant);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url) return false;
    const url = new URL(req.url, this.issuer);

    if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      const key = this.serv.jwtService.exportJwk();
      res.writeHead(key ? 200 : 404, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(JSON.stringify(key ? { keys: [key] } : { error: 'jwks_unavailable' }));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/login' && !this.singleUserId) {
      res.writeHead(501, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><title>Photon OAuth login</title><h1>Identity provider required</h1>' +
          '<p>Configure PHOTON_OAUTH_LOGIN_URL, PHOTON_OAUTH_SUBJECT_HEADER, or PHOTON_OAUTH_SINGLE_USER_ID for local development.</p>'
      );
      return true;
    }

    const adapterOptions: AuthServerHTTPOptions = {
      serv: this.serv,
      singleTenant: true,
      resolveTenant: async (_request, slug) =>
        slug === null || slug === this.tenant.slug ? this.tenant : null,
      resolveUserId: async (request) => this.resolveSubject(request),
    };
    return await handleAuthServerHTTP(req, res, adapterOptions);
  }

  verifyBearer(
    token: string | null | undefined,
    requiredScopes: string[] = []
  ): OAuthBearerVerification {
    if (!token) return { ok: false, reason: 'missing_token' };
    const claims = this.serv.jwtService.verifyAccessToken(token, {
      issuer: this.issuer,
      audience: this.resource,
      tenantId: this.tenant.id,
    });
    if (!claims) return { ok: false, reason: 'invalid_token' };
    const scope = typeof claims.scope === 'string' ? claims.scope : undefined;
    const scopes = scope ? scope.split(/\s+/).filter(Boolean) : [];
    if (requiredScopes.some((required) => !scopes.includes(required))) {
      return { ok: false, reason: 'insufficient_scope' };
    }
    const sub = String(claims.sub);
    // OAuth exposes non-host identities as the public user role while keeping
    // the configured owner on the host role.
    const role = this.hostSubjects.has(sub) ? 'host' : 'user';
    return {
      ok: true,
      caller: {
        ...(claims as unknown as Record<string, unknown>),
        sub,
        role,
        scope,
        scopes,
      },
    };
  }

  wwwAuthenticate(scopes: string[] = [], error?: 'invalid_token' | 'insufficient_scope') {
    return [
      'Bearer realm="photon"',
      `resource_metadata="${this.issuer}/.well-known/oauth-protected-resource"`,
      ...(error ? [`error="${error}"`] : []),
      ...(scopes.length ? [`scope="${scopes.join(' ')}"`] : []),
    ].join(', ');
  }

  private resolveSubject(req: IncomingMessage): string | undefined {
    if (this.singleUserId) return this.singleUserId;
    if (!this.subjectHeader) return undefined;
    const value = req.headers[this.subjectHeader];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
