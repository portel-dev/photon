/**
 * Deploy-time augmentation for the generated Cloudflare Worker.
 *
 * The Cloudflare worker template is intentionally kept stable because it is
 * also used by older deploy fixtures. OAuth is therefore injected after the
 * template has been rendered. The injected implementation is deliberately
 * Web-Crypto-only and stores its authoritative state in the host Durable
 * Object's storage. This gives every generated worker a durable, serialized
 * store without requiring a second service. An optional KV binding is emitted
 * by the deployer as a documented extension point for deployments that want
 * externally managed state.
 */

import { renderOAuthConsentRuntimeSource } from '../../serv/auth/oauth-consent.js';
import type { PhotonAuthMethod } from '../../auth/directive.js';

export interface CloudflareMcpOAuthCodegenOptions {
  photonName: string;
  /** Display name shown as the OAuth resource being connected. */
  photonDisplayName?: string;
  /** Display icon shown beside the Photon name. */
  photonIcon?: string;
  /** Optional Photon description shown on the OAuth consent page. */
  photonDescription?: string;
  scopes: string[];
  /** Stable canonical issuer/resource origin for RFC 8414 and RFC 8707. */
  issuer: string;
  /** Whether anonymous MCP discovery and public user tools are allowed. */
  oauthAuthMode: 'optional' | 'required';
  /** Passwordless login methods declared by the Photon, when any. */
  oauthAuthMethods?: PhotonAuthMethod[];
  /** Optional KV namespace id supplied by the deploy environment. */
  kvNamespaceId?: string;
  /** Photon-owned oauth.css embedded after the safe default consent styles. */
  oauthCustomCss?: string;
}

export function renderCloudflareMcpOAuthBindings(kvNamespaceId?: string): string {
  if (!kvNamespaceId) {
    return `# MCP OAuth state is authoritative in the host Durable Object ctx.storage.
# Email/passkey login uses PHOTON_MCP_OAUTH_LOGIN_SECRET, a Resend key in
# PHOTON_MCP_OAUTH_RESEND_API_KEY (or the Photon's declared Resend binding),
# and PHOTON_MCP_OAUTH_FROM_EMAIL (or the Photon's declared sender binding).
# PHOTON_MCP_OAUTH_LOGIN_URL remains available for an external identity adapter.
# Optional external state contract: set PHOTON_MCP_OAUTH_KV_ID at deploy time
# to emit a PHOTON_OAUTH_KV binding for migration/caching integrations.`;
  }
  return `[[kv_namespaces]]
binding = "PHOTON_OAUTH_KV"
id = "${escapeToml(kvNamespaceId)}"
# MCP OAuth remains authoritative in Durable Object storage; this binding is
# available for deployment-specific replication, audit, or migration code.
# Configure PHOTON_MCP_OAUTH_LOGIN_SECRET plus the Resend bindings for the
# built-in email flow, or configure PHOTON_MCP_OAUTH_LOGIN_URL for an external
# login callback.`;
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Add OAuth routes and auth dispatch to a rendered worker.
 *
 * This function fails fast when the template seam disappears. A silent
 * partial injection would be worse than a deploy-time error because it could
 * advertise OAuth metadata while serving the legacy bearer path.
 */
export function injectCloudflareMcpOAuth(
  workerCode: string,
  options: CloudflareMcpOAuthCodegenOptions
): string {
  const runtime = renderRuntime(options);
  const marker = /const DEPLOY_INSTANCE_ALIASES: Record<string, string> = [^;]+;/;
  if (!marker.test(workerCode)) {
    throw new Error('Cloudflare OAuth injection seam missing: DEPLOY_INSTANCE_ALIASES');
  }
  let output = workerCode.replace(marker, (matched) => `${matched}\n\n${runtime}`);

  const authSignature = `  body: any\n): Promise<McpAuthResult> {`;
  if (!output.includes(authSignature)) {
    throw new Error('Cloudflare OAuth injection seam missing: checkMcpAuth signature');
  }
  output = output.replace(
    authSignature,
    `  body: any,\n  storage?: DurableObjectStorage\n): Promise<McpAuthResult> {`
  );
  output = output.replace(
    `): Promise<McpAuthResult> {\n  const requestedTool = body?.method === 'tools/call'`,
    `): Promise<McpAuthResult> {\n  if (MCP_AUTH_MODE === 'oauth') {\n    return checkMcpOAuth(request, env, method, toolDefinitions, body, storage);\n  }\n  const requestedTool = body?.method === 'tools/call'`
  );
  // The official MCP v2 handler is the only /mcp entry point now. Pass the
  // DO storage through that call so OAuth state remains durable without
  // reviving a protocol-specific adapter seam.
  const callSite = `    const authResult = await checkMcpAuth(request, this.env, method, this.toolDefinitions, body);`;
  if (output.includes(callSite)) {
    output = output.replace(
      callSite,
      `    const authResult = await checkMcpAuth(request, this.env, method, this.toolDefinitions, body, this.ctx.storage);`
    );
  } else {
    const legacyCallSite = `      body\n    );`;
    if (!output.includes(legacyCallSite)) {
      throw new Error('Cloudflare OAuth injection seam missing: checkMcpAuth call site');
    }
    output = output.replace(legacyCallSite, `      body,\n      this.ctx.storage\n    );`);
  }

  const fetchMarker = `  async fetch(request: Request): Promise<Response> {\n    this.getPhoton();\n    const url = new URL(request.url);`;
  if (!output.includes(fetchMarker)) {
    throw new Error('Cloudflare OAuth injection seam missing: Durable Object fetch');
  }
  output = output.replace(
    fetchMarker,
    `${fetchMarker}\n\n    if (MCP_AUTH_MODE === 'oauth') {\n      const oauthResponse = await handlePhotonMcpOAuth(\n        request,\n        this.ctx.storage,\n        this.photonName,\n        this.toolDefinitions,\n        this.env\n      );\n      if (oauthResponse) return oauthResponse;\n    }`
  );

  const outerInstance = `    const instance = extractInstance(request, env);`;
  if (!output.includes(outerInstance)) {
    throw new Error('Cloudflare OAuth injection seam missing: outer Worker routing');
  }
  output = output.replace(
    outerInstance,
    `    const requestPath = new URL(request.url).pathname;\n    const isOAuthEndpoint = requestPath === '/oauth/login' || requestPath === '/authorize' || requestPath === '/token' || requestPath === '/register' || requestPath === '/consent' || requestPath === '/revoke' || requestPath === '/introspect' || requestPath.startsWith('/.well-known/');\n    // Authorization state is single-tenant at the Worker edge. Do not let an\n    // arbitrary instance query/header select a different OAuth key or store.\n    const instance = isOAuthEndpoint ? 'default' : extractInstance(request, env);`
  );

  // Keep the anonymous caller compatible with @class ... {@role user}.
  output = output.replace(
    `          anonymous: true,\n          scope: undefined,`,
    `          anonymous: true,\n          role: 'user',\n          scope: undefined,`
  );

  return output;
}

function renderRuntime(options: CloudflareMcpOAuthCodegenOptions): string {
  const scopes = JSON.stringify(options.scopes);
  const photonName = JSON.stringify(options.photonName);
  const photonDisplayName = JSON.stringify(options.photonDisplayName ?? options.photonName);
  const photonIcon = JSON.stringify(options.photonIcon ?? '⚡');
  const photonDescription = JSON.stringify(options.photonDescription ?? '');
  const oauthAuthMethods = JSON.stringify(options.oauthAuthMethods ?? []);
  const issuer = JSON.stringify(options.issuer);
  const consentRuntime = renderOAuthConsentRuntimeSource();
  const oauthCustomCss = JSON.stringify(options.oauthCustomCss ?? '');
  return String.raw`
// ════════════════════════════════════════════════════════════════════════════
// Generated inbound MCP OAuth (RFC 8414 / 7591 / 7636 / 7662)
// ════════════════════════════════════════════════════════════════════════════

const MCP_OAUTH_DEFAULT_SCOPES: string[] = ${scopes};
const MCP_OAUTH_PHOTON_NAME = ${photonName};
const MCP_OAUTH_PHOTON_DISPLAY_NAME = ${photonDisplayName};
const MCP_OAUTH_PHOTON_ICON = ${photonIcon};
const MCP_OAUTH_PHOTON_DESCRIPTION = ${photonDescription};
const MCP_OAUTH_AUTH_METHODS: string[] = ${oauthAuthMethods};
const MCP_OAUTH_ISSUER = ${issuer};
const MCP_OAUTH_AUTH_MODE = ${JSON.stringify(options.oauthAuthMode)};
const MCP_OAUTH_ACCESS_TTL = 15 * 60;
const MCP_OAUTH_REFRESH_TTL = 30 * 24 * 60 * 60;
const MCP_OAUTH_CODE_TTL = 60;
const MCP_OAUTH_TX_TTL = 10 * 60;
const MCP_OAUTH_CUSTOM_CSS = ${oauthCustomCss};

type PhotonOAuthStorage = DurableObjectStorage;

${consentRuntime}

function photonOAuthJson(status: number, value: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

function photonOAuthHtml(status: number, html: string, formActionOrigins: string[] = []): Response {
  const allowedFormActions = ["'self'", ...formActionOrigins
    .map((value) => { try { return new URL(value).origin; } catch { return ''; } })
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)]
    .join(' ');
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action " + allowedFormActions + "; base-uri 'none'",
      ...CORS_HEADERS,
    },
  });
}

function photonOAuthError(
  status: number,
  error: string,
  description: string,
  extra: Record<string, string> = {}
): Response {
  return photonOAuthJson(status, { error, error_description: description }, extra);
}

function photonOAuthAcceptsHtml(request: Request): boolean {
  // The consent endpoint is human-facing. Some browsers and embedded
  // browser shells send a broad or JSON-first Accept header while opening a
  // top-level document. Fetch metadata is a stronger signal in that case,
  // and prevents an expired transaction from being shown as raw JSON.
  const fetchDest = request.headers.get('Sec-Fetch-Dest')?.toLowerCase();
  const fetchMode = request.headers.get('Sec-Fetch-Mode')?.toLowerCase();
  if (fetchDest === 'document' || fetchMode === 'navigate') return true;

  const accept = request.headers.get('Accept')?.trim().toLowerCase() ?? '';
  if (!accept || accept === '*/*') return true;

  const ranges = accept.split(',').map((entry) => {
    const [rawType, ...parameters] = entry.trim().split(';');
    const type = rawType.trim();
    const qParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const q = qParameter ? Number.parseFloat(qParameter.trim().slice(2)) : 1;
    return { type, q: Number.isFinite(q) ? q : 0 };
  });
  const htmlQuality = ranges.reduce(
    (quality, range) =>
      range.type === 'text/html' || range.type === 'application/xhtml+xml' || range.type === '*/*'
        ? Math.max(quality, range.q)
        : quality,
    0
  );
  const jsonQuality = ranges.reduce(
    (quality, range) => (range.type === 'application/json' ? Math.max(quality, range.q) : quality),
    0
  );
  return htmlQuality > 0 && htmlQuality >= jsonQuality;
}

function photonOAuthErrorForRequest(
  request: Request,
  status: number,
  error: string,
  description: string,
  extra: Record<string, string> = {}
): Response {
  if (!photonOAuthAcceptsHtml(request)) return photonOAuthError(status, error, description, extra);
  return photonOAuthHtml(status, photonOAuthRenderConsentError({
    pageTitle: MCP_OAUTH_PHOTON_DISPLAY_NAME + ' connection',
    resourceName: MCP_OAUTH_PHOTON_DISPLAY_NAME,
    resourceIcon: MCP_OAUTH_PHOTON_ICON,
    resourceDescription: MCP_OAUTH_PHOTON_DESCRIPTION,
    error,
    errorDescription: description,
    customCss: MCP_OAUTH_CUSTOM_CSS,
  }));
}

function photonOAuthB64(value: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function photonOAuthUnb64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function photonOAuthOrigin(_request: Request): string {
  return MCP_OAUTH_ISSUER;
}

function photonOAuthResource(request: Request): string {
  return photonOAuthOrigin(request) + '/mcp';
}

function photonOAuthBearerChallenge(request: Request, error?: string, scope?: string): string {
  const parts = [
    'Bearer realm="photon"',
    'resource_metadata="' + photonOAuthOrigin(request) + '/.well-known/oauth-protected-resource"',
  ];
  if (error) parts.push('error="' + error + '"');
  if (scope) parts.push('scope="' + scope + '"');
  return parts.join(', ');
}

function photonOAuthHash(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

async function photonOAuthHashKey(value: string): Promise<string> {
  return photonOAuthB64(await photonOAuthHash(value));
}

async function photonOAuthKeyMaterial(storage: PhotonOAuthStorage): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const existing = await storage.get<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }>('oauth:keypair');
  if (existing?.privateJwk && existing.publicJwk) return existing;
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;
  const material = {
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
  material.publicJwk.alg = 'ES256';
  material.publicJwk.use = 'sig';
  material.publicJwk.kid = 'photon-oauth';
  material.privateJwk.alg = 'ES256';
  material.privateJwk.use = 'sig';
  material.privateJwk.kid = 'photon-oauth';
  await storage.put('oauth:keypair', material);
  return material;
}

async function photonOAuthJwt(
  storage: PhotonOAuthStorage,
  claims: Record<string, unknown>,
  ttlSeconds: number,
  request: Request
): Promise<string> {
  const material = await photonOAuthKeyMaterial(storage);
  const key = await crypto.subtle.importKey(
    'jwk',
    material.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: photonOAuthOrigin(request),
    aud: photonOAuthResource(request),
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
    ...claims,
  };
  const header = { alg: 'ES256', typ: 'JWT', kid: 'photon-oauth' };
  const encodedHeader = photonOAuthB64(JSON.stringify(header));
  const encodedPayload = photonOAuthB64(JSON.stringify(payload));
  const signingInput = encodedHeader + '.' + encodedPayload;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + '.' + photonOAuthB64(signature);
}

async function photonOAuthVerifyJwt(
  storage: PhotonOAuthStorage,
  token: string,
  request: Request
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: any;
  let claims: any;
  try {
    header = JSON.parse(new TextDecoder().decode(photonOAuthUnb64(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(photonOAuthUnb64(parts[1])));
  } catch {
    return null;
  }
  if (header?.alg !== 'ES256' || header?.kid !== 'photon-oauth') return null;
  const material = await photonOAuthKeyMaterial(storage);
  const key = await crypto.subtle.importKey(
    'jwk',
    material.publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    photonOAuthUnb64(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  const now = Math.floor(Date.now() / 1000);
  const audience = claims?.aud;
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(photonOAuthResource(request))
    : audience === photonOAuthResource(request);
  if (!verified || claims?.iss !== photonOAuthOrigin(request) || !audienceMatches) return null;
  if (typeof claims?.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims?.nbf === 'number' && claims.nbf > now + 60) return null;
  return claims;
}

function photonOAuthCaller(claims: Record<string, unknown>): any {
  const scope = typeof claims.scope === 'string' ? claims.scope : '';
  // Anonymous callers are represented separately by the MCP runtime. Every
  // Authenticated OAuth subjects default to the public user role. Explicit
  // application roles remain untouched, including a deliberately declared
  // customer role.
  const role = typeof claims.role === 'string' ? claims.role : 'user';
  return {
    id: String(claims.sub ?? 'unknown'),
    name: typeof claims.name === 'string' ? claims.name : undefined,
    anonymous: false,
    role,
    scope: scope || undefined,
    scopes: scope.split(/\s+/).filter(Boolean),
    claims,
  };
}

function photonOAuthToolScopes(toolDefinitions: any[], body: any): string[] {
  if (body?.method !== 'tools/call') return [];
  const tool = toolDefinitions.find((candidate: any) => candidate.name === body?.params?.name);
  return Array.isArray(tool?.scopes) ? tool.scopes.filter((scope: unknown): scope is string => typeof scope === 'string') : [];
}

async function photonOAuthAuthenticate(
  request: Request,
  storage: PhotonOAuthStorage,
  requiredScopes: string[]
): Promise<McpAuthResult> {
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      enforced: true,
      ok: false,
      status: 401,
      code: -32001,
      message: 'Unauthorized',
      reason: 'OAuth access token required',
      wwwAuthenticate: photonOAuthBearerChallenge(request),
    };
  }
  const claims = await photonOAuthVerifyJwt(storage, match[1].trim(), request);
  if (!claims) {
    return {
      enforced: true,
      ok: false,
      status: 401,
      code: -32001,
      message: 'Unauthorized',
      reason: 'invalid OAuth access token',
      wwwAuthenticate: photonOAuthBearerChallenge(request, 'invalid_token'),
    };
  }
  const granted = new Set(String(claims.scope ?? '').split(/\s+/).filter(Boolean));
  const missing = requiredScopes.find((scope) => !granted.has(scope));
  if (missing) {
    return {
      enforced: true,
      ok: false,
      status: 403,
      code: -32003,
      message: 'Forbidden',
      reason: 'insufficient_scope',
      wwwAuthenticate: photonOAuthBearerChallenge(request, 'insufficient_scope', requiredScopes.join(' ')),
    };
  }
  return { enforced: true, ok: true, authed: true, caller: photonOAuthCaller(claims) };
}

async function checkMcpOAuth(
  request: Request,
  _env: Env,
  method: string,
  toolDefinitions: any[],
  body: any,
  storage?: PhotonOAuthStorage
): Promise<McpAuthResult> {
  if (!storage) return { enforced: false, ok: true, authed: false };
  const tool = body?.method === 'tools/call'
    ? toolDefinitions.find((candidate: any) => candidate.name === body?.params?.name)
    : undefined;
  const publicPropertyTool = tool?.access?.conditions?.every(
    (condition: any) => condition.property === 'role' && condition.value === 'user'
  ) === true;
  const bypass = new Set(['initialize', 'notifications/initialized', 'notifications/cancelled', 'ping', 'resources/list', 'resources/read', 'resources/templates/list', 'prompts/list', 'server/discover']);
  const supplied = request.headers.has('Authorization');
  const mustAuthenticate = MCP_OAUTH_AUTH_MODE === 'required'
    ? request.method === 'POST'
    : supplied || (method !== 'tools/list' && !bypass.has(method) && !publicPropertyTool);
  if (!mustAuthenticate) return { enforced: false, ok: true, authed: false };
  return photonOAuthAuthenticate(request, storage, photonOAuthToolScopes(toolDefinitions, body));
}

function photonOAuthForm(request: Request, body: string): URLSearchParams {
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    const json = JSON.parse(body || '{}');
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(json)) {
      if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)));
      else if (value !== undefined && value !== null) form.set(key, String(value));
    }
    return form;
  }
  return new URLSearchParams(body);
}

function photonOAuthRedirectError(redirectUri: string, state: string | null, error: string, description: string): Response {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store', ...CORS_HEADERS } });
}

function photonOAuthSafeRedirect(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

async function photonOAuthClient(storage: PhotonOAuthStorage, clientId: string): Promise<any | null> {
  return (await storage.get<any>('oauth:client:' + clientId)) ?? null;
}

async function photonOAuthSubject(_request: Request, env: Env): Promise<{ sub: string; role: string; name?: string } | null> {
  // A static subject is intentionally development-only. In production, an
  // OAuth login adapter must establish identity; otherwise a caller could
  // impersonate the configured user.
  if (DEV_MODE) {
    const configured = (env as any).PHOTON_MCP_OAUTH_SUBJECT;
    if (typeof configured === 'string' && configured.trim()) return { sub: configured.trim(), role: 'user' };
  }
  return null;
}

async function photonOAuthLoginSignature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return photonOAuthB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function photonOAuthVerifyLoginCallback(request: Request, env: Env, tx: any): Promise<{ sub: string; role: string; name?: string } | null> {
  const url = new URL(request.url);
  const sub = url.searchParams.get('subject');
  const role = url.searchParams.get('role') ?? 'user';
  const signature = url.searchParams.get('signature');
  const secret = (env as any).PHOTON_MCP_OAUTH_LOGIN_SECRET;
  if (!sub || !signature || typeof secret !== 'string' || !secret) return null;
  if (role !== 'user' && role !== 'host') return null;
  const expected = await photonOAuthLoginSignature(secret, [tx.id, sub, role].join('.'));
  if (!photonOAuthConstantTimeEqual(expected, signature)) return null;
  return { sub, role };
}

function photonOAuthEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function photonOAuthBrandMark(): string {
  const icon = String(MCP_OAUTH_PHOTON_ICON || 'P');
  if (/^https?:\/\//i.test(icon)) {
    return '<img src="' + photonOAuthEscape(icon) + '" alt="" aria-hidden="true">';
  }
  return photonOAuthEscape(icon);
}

function photonOAuthLoginShell(title: string, body: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + photonOAuthEscape(title) + '</title><style>' +
    '*,*:before,*:after{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0f1118;color:#f7f8fb;font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;padding:28px}.shell{width:min(560px,100%)}.brand{display:flex;align-items:center;gap:12px;color:#c8ccd8;font-weight:650;margin:0 0 18px}.brand-mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#7468ff,#4d7cff);font-weight:800;overflow:hidden}.brand-mark img{display:block;width:100%;height:100%;object-fit:cover}.card{border:1px solid #303543;border-radius:26px;background:#191c25;box-shadow:0 24px 80px #0007;padding:32px}.eyebrow{color:#8e84ff;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:800}.card h1{font-size:30px;line-height:1.12;margin:8px 0 10px}.muted{color:#aeb5c5;margin:0 0 26px}.label{display:block;color:#dce0ea;font-weight:700;margin:0 0 8px}.input{display:block;width:100%;border:1px solid #454b5c;background:#11141b;color:#fff;border-radius:14px;padding:14px 16px;font:inherit;outline:none}.input:focus{border-color:#786dff;box-shadow:0 0 0 4px #786dff2b}.button{width:100%;border:0;border-radius:14px;padding:14px 18px;background:#6f63ff;color:#fff;font:700 16px inherit;cursor:pointer;margin-top:16px}.button.secondary{background:#292e3c;color:#e9ebf2}.hint{font-size:13px;color:#949bad;margin-top:16px}.error{background:#3b2028;border:1px solid #a94a62;color:#ffb8c6;border-radius:12px;padding:12px 14px;margin:0 0 18px}.success{background:#17352d;border:1px solid #3c9b7c;color:#b3f2d9;border-radius:12px;padding:12px 14px;margin:0 0 18px}.row{display:flex;gap:12px}.row>*{flex:1}.choice{display:flex;gap:12px;align-items:flex-start;border:1px solid #343a4b;border-radius:14px;padding:15px;margin-top:12px}.choice strong{display:block}.choice span{display:block;color:#aeb5c5;font-size:13px}.link{color:#9e96ff;text-decoration:none;font-weight:700}.small{font-size:13px;color:#9da4b4;margin-top:20px;text-align:center}' +
    '</style></head><body><main class="shell"><div class="brand"><div class="brand-mark">' + photonOAuthBrandMark() + '</div><span>' + photonOAuthEscape(MCP_OAUTH_PHOTON_DISPLAY_NAME) + '</span></div>' + body + '</main></body></html>';
}

function photonOAuthLoginPage(txId: string, message?: string, error?: string): Response {
  const notice = error ? '<div class="error">' + photonOAuthEscape(error) + '</div>' : message ? '<div class="success">' + photonOAuthEscape(message) + '</div>' : '';
  const html = photonOAuthLoginShell('Sign in to ' + MCP_OAUTH_PHOTON_DISPLAY_NAME,
    '<section class="card"><div class="eyebrow">Secure connection</div><h1>Continue with your email</h1><p class="muted">We will send a one-time code. No Cloudflare account is required.</p>' + notice +
    '<form method="post" action="/oauth/login"><input type="hidden" name="action" value="request_code"><input type="hidden" name="oauth_state" value="' + photonOAuthEscape(txId) + '"><label class="label" for="email">Email address</label><input class="input" id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"><button class="button" type="submit">Send verification code</button><button class="button secondary" id="passkey" type="button">Use a passkey</button></form>' +
    '<script>document.getElementById("passkey").onclick=async function(){var email=document.getElementById("email").value.trim();if(!email){alert("Enter your email first.");return}try{var start=await fetch("/oauth/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({action:"passkey_begin_auth",oauth_state:' + JSON.stringify(txId) + ',email:email})});var options=await start.json();if(!start.ok)throw new Error(options.error_description||"Passkey unavailable");var dec=function(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer};options.publicKey.challenge=dec(options.publicKey.challenge);options.publicKey.allowCredentials=(options.publicKey.allowCredentials||[]).map(function(c){return Object.assign({},c,{id:dec(c.id)})});var credential=await navigator.credentials.get(options);var bytes=function(v){return Array.from(new Uint8Array(v))};var finish=await fetch("/oauth/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({action:"passkey_finish_auth",oauth_state:' + JSON.stringify(txId) + ',payload:JSON.stringify({id:credential.id,response:{clientDataJSON:bytes(credential.response.clientDataJSON),authenticatorData:bytes(credential.response.authenticatorData),signature:bytes(credential.response.signature),userHandle:credential.response.userHandle?bytes(credential.response.userHandle):null}})})});var result=await finish.json();if(!finish.ok)throw new Error(result.error_description||"Passkey failed");location.href=result.redirect}catch(e){alert(e.message)}};</script>' +
    '<p class="hint">The email address determines whether you receive guest or host access. Host access is limited to the owner email configured by the Photon.</p></section>');
  return photonOAuthHtml(200, html);
}

function photonOAuthVerifiedPage(txId: string, email: string): Response {
  const passkey = MCP_OAUTH_AUTH_METHODS.includes('passkey') ? '<button class="button" id="add-passkey" type="button">Add a passkey on this device</button><p class="hint">Passkeys use your device security and can replace email codes the next time you connect.</p>' : '';
  const html = photonOAuthLoginShell('Email verified', '<section class="card"><div class="eyebrow">Identity verified</div><h1>Continue securely</h1><p class="muted">You are signed in as <strong>' + photonOAuthEscape(email) + '</strong>.</p>' + passkey + '<a class="button secondary" style="display:block;text-align:center;text-decoration:none" href="/consent?tx=' + encodeURIComponent(txId) + '">Continue without a passkey</a></section>' + (MCP_OAUTH_AUTH_METHODS.includes('passkey') ? '<script>document.getElementById("add-passkey").onclick=async function(){try{var start=await fetch("/oauth/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({action:"passkey_begin_register",oauth_state:' + JSON.stringify(txId) + '})});var options=await start.json();if(!start.ok)throw new Error(options.error_description||"Passkey unavailable");var dec=function(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer};options.publicKey.challenge=dec(options.publicKey.challenge);options.publicKey.user.id=dec(options.publicKey.user.id);var credential=await navigator.credentials.create(options);var bytes=function(v){return Array.from(new Uint8Array(v))};var finish=await fetch("/oauth/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({action:"passkey_finish_register",oauth_state:' + JSON.stringify(txId) + ',payload:JSON.stringify({id:credential.id,response:{clientDataJSON:bytes(credential.response.clientDataJSON),attestationObject:bytes(credential.response.attestationObject)}})})});var result=await finish.json();if(!finish.ok)throw new Error(result.error_description||"Passkey registration failed");location.href=result.redirect}catch(e){alert(e.message)}};</script>' : ''));
  return photonOAuthHtml(200, html);
}

function photonOAuthCodePage(txId: string, email: string, challengeId: string, message?: string, error?: string): Response {
  const notice = error ? '<div class="error">' + photonOAuthEscape(error) + '</div>' : message ? '<div class="success">' + photonOAuthEscape(message) + '</div>' : '';
  const html = photonOAuthLoginShell('Verify your email',
    '<section class="card"><div class="eyebrow">Check your inbox</div><h1>Enter your code</h1><p class="muted">We sent a six-digit code to <strong>' + photonOAuthEscape(email) + '</strong>. It expires in ten minutes.</p>' + notice +
    '<form method="post" action="/oauth/login"><input type="hidden" name="action" value="verify_code"><input type="hidden" name="oauth_state" value="' + photonOAuthEscape(txId) + '"><input type="hidden" name="challenge_id" value="' + photonOAuthEscape(challengeId) + '"><label class="label" for="code">Verification code</label><input class="input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456"><button class="button" type="submit">Verify and continue</button></form>' +
    '<p class="small"><a class="link" href="/oauth/login?oauth_state=' + encodeURIComponent(txId) + '">Use a different email</a></p></section>');
  return photonOAuthHtml(200, html);
}

async function photonOAuthSendEmailCode(env: Env, email: string, code: string): Promise<boolean> {
  const apiKey = String((env as any).PHOTON_MCP_OAUTH_RESEND_API_KEY ?? (env as any).CONSULT_RESEND_API_KEY ?? '').trim();
  const from = String((env as any).PHOTON_MCP_OAUTH_FROM_EMAIL ?? (env as any).CONSULT_FROM_EMAIL ?? '').trim();
  if (!apiKey || !from) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Your ' + MCP_OAUTH_PHOTON_DISPLAY_NAME + ' verification code',
      text: 'Your verification code is ' + code + '. It expires in 10 minutes. If you did not request this, you can ignore this email.',
    }),
  });
  return response.ok;
}

async function photonOAuthEmailChallenge(storage: PhotonOAuthStorage, env: Env, tx: any, email: string): Promise<Response> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return photonOAuthLoginPage(tx.id, undefined, 'Enter a valid email address.');
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const challengeId = 'email_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(18)));
  const secret = String((env as any).PHOTON_MCP_OAUTH_LOGIN_SECRET ?? '');
  if (secret.length < 16) return photonOAuthError(503, 'temporarily_unavailable', 'Email authentication is not configured. Set PHOTON_MCP_OAUTH_LOGIN_SECRET.');
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await storage.put('oauth:email-code:' + challengeId, { email: normalized, txId: tx.id, codeHash: await photonOAuthHashKey(secret + ':' + challengeId + ':' + code), attempts: 0, expiresAt });
  try {
    if (!await photonOAuthSendEmailCode(env, normalized, code)) {
      await storage.delete('oauth:email-code:' + challengeId);
      return photonOAuthError(503, 'temporarily_unavailable', 'The verification email could not be sent. Configure the Photon Resend key and sender address.');
    }
  } catch {
    await storage.delete('oauth:email-code:' + challengeId);
    return photonOAuthError(503, 'temporarily_unavailable', 'The verification email could not be sent.');
  }
  return photonOAuthCodePage(tx.id, normalized, challengeId, 'Verification code sent.');
}

async function photonOAuthVerifyEmailCode(storage: PhotonOAuthStorage, env: Env, tx: any, challengeId: string, code: string): Promise<Response> {
  const challenge = await storage.get<any>('oauth:email-code:' + challengeId);
  if (!challenge || challenge.txId !== tx.id || challenge.expiresAt < Date.now()) return photonOAuthLoginPage(tx.id, undefined, 'That code has expired. Request a new one.');
  if (challenge.attempts >= 5) { await storage.delete('oauth:email-code:' + challengeId); return photonOAuthLoginPage(tx.id, undefined, 'Too many attempts. Request a new code.'); }
  challenge.attempts += 1;
  await storage.put('oauth:email-code:' + challengeId, challenge);
  const secret = String((env as any).PHOTON_MCP_OAUTH_LOGIN_SECRET ?? '');
  const expected = await photonOAuthHashKey(secret + ':' + challengeId + ':' + code.trim());
  if (!photonOAuthConstantTimeEqual(expected, challenge.codeHash)) return photonOAuthCodePage(tx.id, challenge.email, challengeId, undefined, 'The code is incorrect. Check the email and try again.');
  await storage.delete('oauth:email-code:' + challengeId);
  const hostSubjects = String((env as any).PHOTON_MCP_OAUTH_HOST_SUBJECTS ?? '').split(/[\s,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const role = hostSubjects.includes(challenge.email) ? 'host' : 'user';
  const verified = { ...tx, sub: challenge.email, role, name: challenge.email, emailVerified: true };
  await storage.put('oauth:tx:' + tx.id, verified);
  return MCP_OAUTH_AUTH_METHODS.includes('passkey') ? photonOAuthVerifiedPage(tx.id, challenge.email) : new Response(null, { status: 302, headers: { Location: MCP_OAUTH_ISSUER + '/consent?tx=' + encodeURIComponent(tx.id), 'Cache-Control': 'no-store', ...CORS_HEADERS } });
}

function photonOAuthBytes(value: any): Uint8Array {
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === 'string') return photonOAuthUnb64(value);
  return new Uint8Array();
}

function photonOAuthBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function photonOAuthCborReadLength(bytes: Uint8Array, offset: number, additional: number): { length: number; offset: number } | null {
  if (additional < 24) return { length: additional, offset };
  const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : 0;
  if (!width || offset + width > bytes.length || width > 4) return null;
  let length = 0;
  for (let i = 0; i < width; i++) length = length * 256 + bytes[offset + i];
  return { length, offset: offset + width };
}

function photonOAuthCborDecode(bytes: Uint8Array, start = 0): { value: any; offset: number } | null {
  if (start >= bytes.length) return null;
  const initial = bytes[start++];
  const major = initial >> 5;
  const additional = initial & 31;
  if (additional === 31) return null;
  const header = photonOAuthCborReadLength(bytes, start, additional);
  if (!header) return null;
  let offset = header.offset;
  const length = header.length;
  if (major === 0) return { value: length, offset };
  if (major === 1) return { value: -1 - length, offset };
  if (major === 2 || major === 3) {
    if (offset + length > bytes.length) return null;
    const chunk = bytes.slice(offset, offset + length);
    offset += length;
    return { value: major === 2 ? chunk : new TextDecoder().decode(chunk), offset };
  }
  if (major === 4) {
    const list: any[] = [];
    for (let i = 0; i < length; i++) {
      const item = photonOAuthCborDecode(bytes, offset);
      if (!item) return null;
      list.push(item.value); offset = item.offset;
    }
    return { value: list, offset };
  }
  if (major === 5) {
    const map = new Map<any, any>();
    for (let i = 0; i < length; i++) {
      const key = photonOAuthCborDecode(bytes, offset);
      if (!key) return null;
      const value = photonOAuthCborDecode(bytes, key.offset);
      if (!value) return null;
      map.set(key.value, value.value); offset = value.offset;
    }
    return { value: map, offset };
  }
  if (major === 7 && length === 20) return { value: false, offset };
  if (major === 7 && length === 21) return { value: true, offset };
  if (major === 7 && length === 22) return { value: null, offset };
  return null;
}

async function photonOAuthWebAuthnChallenge(storage: PhotonOAuthStorage, tx: any, kind: 'register' | 'authenticate', email: string): Promise<string> {
  const challenge = photonOAuthB64(crypto.getRandomValues(new Uint8Array(32)));
  await storage.put('oauth:webauthn:' + tx.id, { challenge, kind, email, txId: tx.id, expiresAt: Date.now() + 5 * 60 * 1000 });
  return challenge;
}

function photonOAuthRpId(): string {
  return new URL(MCP_OAUTH_ISSUER).hostname;
}

async function photonOAuthPasskeyIds(storage: PhotonOAuthStorage, email: string): Promise<string[]> {
  return (await storage.get<string[]>('oauth:passkey-user:' + email)) ?? [];
}

async function photonOAuthBeginPasskeyRegister(storage: PhotonOAuthStorage, tx: any): Promise<Response> {
  if (!tx.emailVerified || !tx.sub) return photonOAuthError(401, 'login_required', 'Verify your email before adding a passkey');
  const challenge = await photonOAuthWebAuthnChallenge(storage, tx, 'register', tx.sub);
  return photonOAuthJson(200, { publicKey: { challenge, rp: { id: photonOAuthRpId(), name: MCP_OAUTH_PHOTON_DISPLAY_NAME }, user: { id: photonOAuthB64(await photonOAuthHash('user:' + tx.sub)), name: tx.sub, displayName: tx.sub }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }, attestation: 'none', timeout: 300000 } });
}

async function photonOAuthBeginPasskeyAuth(storage: PhotonOAuthStorage, tx: any, email: string): Promise<Response> {
  const normalized = email.trim().toLowerCase();
  const ids = await photonOAuthPasskeyIds(storage, normalized);
  if (!ids.length) return photonOAuthLoginPage(tx.id, undefined, 'No passkey is registered for that email yet. Verify by email first.');
  const challenge = await photonOAuthWebAuthnChallenge(storage, tx, 'authenticate', normalized);
  return photonOAuthJson(200, { publicKey: { challenge, rpId: photonOAuthRpId(), userVerification: 'preferred', timeout: 300000, allowCredentials: ids.map((id) => ({ id, type: 'public-key' })) } });
}

async function photonOAuthFinishPasskeyRegister(storage: PhotonOAuthStorage, env: Env, tx: any, payload: any): Promise<Response> {
  const transaction = await storage.get<any>('oauth:webauthn:' + tx.id);
  if (!transaction || transaction.kind !== 'register' || transaction.email !== tx.sub || transaction.expiresAt < Date.now()) return photonOAuthError(400, 'invalid_request', 'Passkey registration has expired');
  const result = await photonOAuthVerifyRegistration(transaction.challenge, payload);
  if (!result) return photonOAuthError(400, 'invalid_request', 'The passkey registration could not be verified');
  const id = photonOAuthB64(result.credentialId);
  const record = { id, sub: tx.sub, publicJwk: result.publicJwk, signCount: result.signCount, createdAt: Date.now() };
  await storage.put('oauth:passkey:' + id, record);
  const ids = await photonOAuthPasskeyIds(storage, tx.sub);
  if (!ids.includes(id)) await storage.put('oauth:passkey-user:' + tx.sub, [...ids, id]);
  await storage.delete('oauth:webauthn:' + tx.id);
  await storage.put('oauth:tx:' + tx.id, { ...tx, passkeyRegistered: true });
  void env;
  return photonOAuthJson(200, { redirect: MCP_OAUTH_ISSUER + '/consent?tx=' + encodeURIComponent(tx.id) });
}

async function photonOAuthFinishPasskeyAuth(storage: PhotonOAuthStorage, env: Env, tx: any, payload: any): Promise<Response> {
  const transaction = await storage.get<any>('oauth:webauthn:' + tx.id);
  if (!transaction || transaction.kind !== 'authenticate' || transaction.expiresAt < Date.now()) return photonOAuthError(400, 'invalid_request', 'Passkey authentication has expired');
  const id = typeof payload?.id === 'string' ? payload.id : '';
  const record = id ? await storage.get<any>('oauth:passkey:' + id) : null;
  if (!record || record.sub !== transaction.email) return photonOAuthError(401, 'login_required', 'Passkey not recognized');
  const verified = await photonOAuthVerifyAssertion(transaction.challenge, record, payload);
  if (!verified) return photonOAuthError(401, 'login_required', 'Passkey assertion could not be verified');
  if (verified.signCount > record.signCount) { record.signCount = verified.signCount; await storage.put('oauth:passkey:' + id, record); }
  await storage.delete('oauth:webauthn:' + tx.id);
  const hostSubjects = String((env as any).PHOTON_MCP_OAUTH_HOST_SUBJECTS ?? '').split(/[\s,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const role = hostSubjects.includes(transaction.email) ? 'host' : 'user';
  await storage.put('oauth:tx:' + tx.id, { ...tx, sub: transaction.email, role, name: transaction.email, emailVerified: true });
  return photonOAuthJson(200, { redirect: MCP_OAUTH_ISSUER + '/consent?tx=' + encodeURIComponent(tx.id) });
}

async function photonOAuthVerifyRegistration(expectedChallenge: string, payload: any): Promise<{ credentialId: Uint8Array; publicJwk: JsonWebKey; signCount: number } | null> {
  try {
    const response = payload?.response;
    const clientDataBytes = photonOAuthBytes(response?.clientDataJSON);
    const attestationBytes = photonOAuthBytes(response?.attestationObject);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
    if (clientData.type !== 'webauthn.create' || clientData.challenge !== expectedChallenge || clientData.origin !== MCP_OAUTH_ISSUER) return null;
    const decoded = photonOAuthCborDecode(attestationBytes);
    const authData = decoded?.value instanceof Map ? decoded.value.get('authData') : null;
    if (!(authData instanceof Uint8Array) || authData.length < 55 || !(authData[32] & 1)) return null;
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(photonOAuthRpId())));
    if (!photonOAuthBytesEqual(rpHash, authData.slice(0, 32))) return null;
    const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
    const idLength = new DataView(authData.buffer, authData.byteOffset + 53, 2).getUint16(0);
    const credentialStart = 55;
    const credentialId = authData.slice(credentialStart, credentialStart + idLength);
    const publicKey = photonOAuthCborDecode(authData, credentialStart + idLength)?.value;
    if (!(publicKey instanceof Map) || publicKey.get(1) !== 2 || publicKey.get(3) !== -7) return null;
    const x = publicKey.get(-2); const y = publicKey.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) return null;
    return { credentialId, signCount, publicJwk: { kty: 'EC', crv: 'P-256', x: photonOAuthB64(x), y: photonOAuthB64(y), ext: true } };
  } catch { return null; }
}

function photonOAuthDerToP1363(signature: Uint8Array): Uint8Array | null {
  if (signature.length < 8 || signature[0] !== 0x30) return null;
  let offset = 2;
  if (signature[1] & 0x80) { const width = signature[1] & 0x7f; offset = 2 + width; }
  if (signature[offset] !== 0x02) return null;
  const rLength = signature[offset + 1]; const r = signature.slice(offset + 2, offset + 2 + rLength); offset += 2 + rLength;
  if (signature[offset] !== 0x02) return null;
  const sLength = signature[offset + 1]; const s = signature.slice(offset + 2, offset + 2 + sLength);
  const output = new Uint8Array(64); output.set(r.slice(-32), 32 - Math.min(32, r.length)); output.set(s.slice(-32), 64 - Math.min(32, s.length)); return output;
}

async function photonOAuthVerifyAssertion(expectedChallenge: string, record: any, payload: any): Promise<{ signCount: number } | null> {
  try {
    const response = payload?.response;
    const clientDataBytes = photonOAuthBytes(response?.clientDataJSON); const authData = photonOAuthBytes(response?.authenticatorData); const signature = photonOAuthDerToP1363(photonOAuthBytes(response?.signature));
    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
    if (!signature || clientData.type !== 'webauthn.get' || clientData.challenge !== expectedChallenge || clientData.origin !== MCP_OAUTH_ISSUER || authData.length < 37 || !(authData[32] & 1)) return null;
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(photonOAuthRpId())));
    if (!photonOAuthBytesEqual(rpHash, authData.slice(0, 32))) return null;
    const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
    const signed = new Uint8Array(authData.length + clientHash.length); signed.set(authData); signed.set(clientHash, authData.length);
    const key = await crypto.subtle.importKey('jwk', record.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed);
    return valid ? { signCount } : null;
  } catch { return null; }
}

/**
 * Complete an OAuth transaction from a Cloudflare Access-protected login
 * route. The Access email header is only accepted on this dedicated route;
 * the route itself must be protected by a Cloudflare Access application.
 */
async function photonOAuthAccessLogin(request: Request, storage: PhotonOAuthStorage, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const txId = url.searchParams.get('oauth_state') ?? url.searchParams.get('tx');
  if (!txId) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'oauth_state is required');
  const tx = await storage.get<any>('oauth:tx:' + txId);
  if (!tx || tx.expiresAt < Date.now()) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'authorization transaction expired');

  const subject = request.headers.get('Cf-Access-Authenticated-User-Email')?.trim().toLowerCase();
  if (!subject || !subject.includes('@')) return photonOAuthErrorForRequest(request, 401, 'login_required', 'Cloudflare Access identity is required');

  const hostSubjects = String((env as any).PHOTON_MCP_OAUTH_HOST_SUBJECTS ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const role = hostSubjects.includes(subject) ? 'host' : 'user';
  await storage.put('oauth:tx:' + tx.id, { ...tx, sub: subject, role, name: subject });
  return new Response(null, {
    status: 302,
    headers: { Location: origin + '/consent?tx=' + encodeURIComponent(tx.id), 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

function photonOAuthConstantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

async function photonOAuthConsentPage(tx: any): Promise<Response> {
  const scopeValues = String(tx.scope ?? '').split(/\s+/).filter(Boolean);
  return photonOAuthHtml(200, photonOAuthRenderConsent({
    pageTitle: 'Connect ' + String(tx.clientName ?? tx.clientId),
    clientName: String(tx.clientName ?? tx.clientId),
    clientSubtitle: 'wants to connect',
    resourceName: MCP_OAUTH_PHOTON_DISPLAY_NAME,
    resourceIcon: MCP_OAUTH_PHOTON_ICON,
    resourceDescription: MCP_OAUTH_PHOTON_DESCRIPTION,
    description: 'Review the access ' + String(tx.clientName ?? tx.clientId) + ' will have to your ' + MCP_OAUTH_PHOTON_DISPLAY_NAME + ' account.',
    subject: String(tx.name ?? tx.sub ?? 'Authenticated account'),
    subjectSubtitle: 'Signed-in account',
    scopes: scopeValues,
    formAction: '/consent',
    transactionField: 'tx',
    transactionValue: String(tx.id),
    decisionField: 'action',
    approveValue: 'approve',
    denyValue: 'deny',
    hiddenFields: [],
    allowScopeSelection: true,
    customCss: MCP_OAUTH_CUSTOM_CSS,
  }), [String(tx.redirectUri)]);
}

async function handlePhotonMcpOAuth(
  request: Request,
  storage: PhotonOAuthStorage,
  photonName: string,
  toolDefinitions: any[],
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const isOAuthPath = pathname === '/oauth/login' || pathname === '/authorize' || pathname === '/token' || pathname === '/register' || pathname === '/consent' || pathname === '/revoke' || pathname === '/introspect' || pathname === '/.well-known/jwks.json' || pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-authorization-server';
  if (!isOAuthPath) return null;
  // All OAuth metadata, issuer claims, redirects, and resource identifiers
  // must use the configured canonical issuer. Request aliases are not OAuth
  // issuers and must never be allowed to change this value.
  const origin = MCP_OAUTH_ISSUER;
  const resource = origin + '/mcp';
  const scopes = MCP_OAUTH_DEFAULT_SCOPES.length > 0 ? MCP_OAUTH_DEFAULT_SCOPES : ['mcp:read'];

  if (pathname === '/oauth/login' && request.method === 'GET') {
    const txId = url.searchParams.get('oauth_state') ?? url.searchParams.get('tx');
    if (MCP_OAUTH_AUTH_METHODS.includes('email')) {
      if (!txId) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'oauth_state is required');
      const tx = await storage.get<any>('oauth:tx:' + txId);
      if (!tx || tx.expiresAt < Date.now()) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'authorization transaction expired');
      return photonOAuthLoginPage(tx.id);
    }
    return photonOAuthAccessLogin(request, storage, env, origin);
  }

  if (pathname === '/oauth/login' && request.method === 'POST') {
    if (!MCP_OAUTH_AUTH_METHODS.includes('email')) return photonOAuthError(405, 'method_not_allowed', 'Email authentication is not enabled');
    let form: URLSearchParams;
    try { form = photonOAuthForm(request, await request.text()); } catch { return photonOAuthError(400, 'invalid_request', 'Invalid login form'); }
    const txId = form.get('oauth_state') ?? form.get('tx');
    const tx = txId ? await storage.get<any>('oauth:tx:' + txId) : null;
    if (!tx || tx.expiresAt < Date.now()) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'authorization transaction expired');
    if (form.get('action') === 'request_code') return photonOAuthEmailChallenge(storage, env, tx, form.get('email') ?? '');
    if (form.get('action') === 'verify_code') return photonOAuthVerifyEmailCode(storage, env, tx, form.get('challenge_id') ?? '', form.get('code') ?? '');
    if (form.get('action') === 'passkey_begin_register') return photonOAuthBeginPasskeyRegister(storage, tx);
    if (form.get('action') === 'passkey_begin_auth') return photonOAuthBeginPasskeyAuth(storage, tx, form.get('email') ?? '');
    if (form.get('action') === 'passkey_finish_register') {
      let payload: any;
      try { payload = JSON.parse(form.get('payload') ?? '{}'); } catch { return photonOAuthError(400, 'invalid_request', 'Invalid passkey payload'); }
      return photonOAuthFinishPasskeyRegister(storage, env, tx, payload);
    }
    if (form.get('action') === 'passkey_finish_auth') {
      let payload: any;
      try { payload = JSON.parse(form.get('payload') ?? '{}'); } catch { return photonOAuthError(400, 'invalid_request', 'Invalid passkey payload'); }
      return photonOAuthFinishPasskeyAuth(storage, env, tx, payload);
    }
    return photonOAuthError(400, 'invalid_request', 'Unknown login action');
  }

  if (pathname === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
    return photonOAuthJson(200, { resource, authorization_servers: [origin], scopes_supported: scopes });
  }
  if (pathname === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
    return photonOAuthJson(200, {
      issuer: origin,
      authorization_endpoint: origin + '/authorize',
      token_endpoint: origin + '/token',
      registration_endpoint: origin + '/register',
      jwks_uri: origin + '/.well-known/jwks.json',
      scopes_supported: scopes,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      client_id_metadata_document_supported: false,
    });
  }
  if (pathname === '/.well-known/jwks.json' && request.method === 'GET') {
    const material = await photonOAuthKeyMaterial(storage);
    return photonOAuthJson(200, { keys: [material.publicJwk] });
  }

  if (pathname === '/register' && request.method === 'POST') {
    let body = '';
    try { body = await request.text(); } catch { return photonOAuthError(400, 'invalid_request', 'Unable to read request body'); }
    let form: URLSearchParams;
    try { form = photonOAuthForm(request, body); } catch { return photonOAuthError(400, 'invalid_client_metadata', 'Invalid registration payload'); }
    let redirectUris: string[] = [];
    try { redirectUris = JSON.parse(form.get('redirect_uris') ?? '[]'); } catch { redirectUris = form.getAll('redirect_uris'); }
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.some((uri) => typeof uri !== 'string' || !photonOAuthSafeRedirect(uri))) return photonOAuthError(400, 'invalid_redirect_uri', 'redirect_uris must contain HTTPS or loopback URLs');
    const clientId = 'photon_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(18)));
    const publicClient = form.get('token_endpoint_auth_method') === 'none' || form.get('application_type') === 'native';
    const secret = publicClient ? undefined : photonOAuthB64(crypto.getRandomValues(new Uint8Array(32)));
    const client = { clientId, clientName: form.get('client_name') ?? photonName, redirectUris, scope: form.get('scope') ?? scopes.join(' '), ...(secret ? { clientSecretHash: await photonOAuthHashKey(secret) } : {}), createdAt: Date.now() };
    await storage.put('oauth:client:' + clientId, client);
    return photonOAuthJson(201, { client_id: clientId, ...(secret ? { client_secret: secret } : {}), client_name: client.clientName, redirect_uris: redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: publicClient ? 'none' : 'client_secret_post' });
  }

  if (pathname === '/authorize' && request.method === 'GET') {
    const responseType = url.searchParams.get('response_type');
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const challenge = url.searchParams.get('code_challenge');
    const challengeMethod = url.searchParams.get('code_challenge_method');
    const state = url.searchParams.get('state');
    const requestedResource = url.searchParams.get('resource');
    const client = clientId ? await photonOAuthClient(storage, clientId) : null;
    if (responseType !== 'code' || !client || !redirectUri || !client.redirectUris.includes(redirectUri) || !challenge || challengeMethod !== 'S256' || (requestedResource && requestedResource !== resource)) return photonOAuthError(400, 'invalid_request', 'response_type, client, redirect_uri, resource, and S256 PKCE are required');
    const tx = { id: 'tx_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(18))), clientId, clientName: client.clientName, redirectUri, scope: (url.searchParams.get('scope') ?? client.scope ?? scopes.join(' ')).split(/\s+/).filter((value) => scopes.includes(value)).join(' '), codeChallenge: challenge, state, resource, createdAt: Date.now(), expiresAt: Date.now() + MCP_OAUTH_TX_TTL * 1000 };
    const subject = await photonOAuthSubject(request, env);
    if (subject) {
      await storage.put('oauth:tx:' + tx.id, { ...tx, ...subject });
      return new Response(null, { status: 302, headers: { Location: origin + '/consent?tx=' + encodeURIComponent(tx.id), 'Cache-Control': 'no-store', ...CORS_HEADERS } });
    }
    const loginUrl = (env as any).PHOTON_MCP_OAUTH_LOGIN_URL;
    if (typeof loginUrl !== 'string' || !loginUrl) return photonOAuthError(501, 'temporarily_unavailable', 'Configure PHOTON_MCP_OAUTH_LOGIN_URL or Cloudflare Access identity before using OAuth');
    await storage.put('oauth:tx:' + tx.id, tx);
    const login = new URL(loginUrl);
    login.searchParams.set('return_to', origin + '/consent?tx=' + tx.id);
    login.searchParams.set('oauth_state', tx.id);
    if (MCP_OAUTH_AUTH_METHODS.length > 0) {
      login.searchParams.set('auth_methods', MCP_OAUTH_AUTH_METHODS.join(' '));
    }
    return new Response(null, { status: 302, headers: { Location: login.toString(), 'Cache-Control': 'no-store', ...CORS_HEADERS } });
  }

  if (pathname === '/consent' && request.method === 'GET') {
    const txId = url.searchParams.get('tx');
    if (!txId) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'tx is required');
    const tx = await storage.get<any>('oauth:tx:' + txId);
    if (!tx || tx.expiresAt < Date.now()) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'authorization transaction expired');
    if (!tx.sub) {
      const callbackSubject = await photonOAuthVerifyLoginCallback(request, env, tx);
      if (callbackSubject) { tx.sub = callbackSubject.sub; tx.role = callbackSubject.role; tx.name = callbackSubject.name; await storage.put('oauth:tx:' + tx.id, tx); }
    }
    if (!tx.sub) return photonOAuthErrorForRequest(request, 401, 'login_required', 'The authorization transaction has no authenticated subject');
    return photonOAuthConsentPage(tx);
  }

  if (pathname === '/consent' && request.method === 'POST') {
    const form = photonOAuthForm(request, await request.text());
    const txId = form.get('tx');
    const tx = txId ? await storage.get<any>('oauth:tx:' + txId) : null;
    if (!tx || tx.expiresAt < Date.now() || !tx.sub) return photonOAuthErrorForRequest(request, 400, 'invalid_request', 'authorization transaction expired');
    if (form.get('action') !== 'approve') return photonOAuthRedirectError(tx.redirectUri, tx.state, 'access_denied', 'The resource owner denied the request');
    const allowedScopes = new Set(String(tx.scope ?? '').split(/\s+/).filter(Boolean));
    const selectedScopes = form.getAll('scope').filter((value) => allowedScopes.has(value));
    const grantedScope = selectedScopes.join(' ');
    // Browsers and MCP clients can retry the consent POST while following the
    // redirect. Keep the short-lived transaction until the authorization code
    // is exchanged and return the same code for a duplicate approval instead
    // of turning a harmless retry into an "expired" authorization error.
    const code = tx.consentCode ?? ('code_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(32))));
    if (!tx.consentCode) {
      await storage.put('oauth:tx:' + tx.id, { ...tx, consentCode: code });
      await storage.put('oauth:code:' + code, { ...tx, scope: grantedScope, code, role: tx.role ?? 'user', createdAt: Date.now(), expiresAt: Date.now() + MCP_OAUTH_CODE_TTL * 1000 });
    }
    const target = new URL(tx.redirectUri);
    target.searchParams.set('code', code);
    if (tx.state) target.searchParams.set('state', tx.state);
    target.searchParams.set('iss', origin);
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store', ...CORS_HEADERS } });
  }

  if (pathname === '/token' && request.method === 'POST') {
    const form = photonOAuthForm(request, await request.text());
    const grantType = form.get('grant_type');
    const clientId = form.get('client_id');
    const client = clientId ? await photonOAuthClient(storage, clientId) : null;
    if (!client) return photonOAuthError(401, 'invalid_client', 'Unknown client');
    if (client.clientSecretHash) {
      const presented = form.get('client_secret') ?? '';
      if (await photonOAuthHashKey(presented) !== client.clientSecretHash) return photonOAuthError(401, 'invalid_client', 'Invalid client credentials');
    }
    if (grantType === 'authorization_code') {
      const codeValue = form.get('code');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = photonOAuthB64(await photonOAuthHash(verifier));
      const code = codeValue ? await storage.transaction(async (transaction) => {
        const candidate = await transaction.get<any>('oauth:code:' + codeValue);
        if (!candidate || candidate.expiresAt < Date.now() || candidate.clientId !== clientId || candidate.redirectUri !== form.get('redirect_uri') || candidate.codeChallenge !== challenge) return null;
        await transaction.delete('oauth:code:' + codeValue);
        await transaction.delete('oauth:tx:' + candidate.id);
        return candidate;
      }) : null;
      if (!code) return photonOAuthError(400, 'invalid_grant', 'Invalid authorization code or PKCE verifier');
      const scope = code.scope || scopes.join(' ');
      const accessToken = await photonOAuthJwt(storage, { sub: code.sub, role: code.role ?? 'user', name: code.name, scope, client_id: clientId }, MCP_OAUTH_ACCESS_TTL, request);
      const refreshToken = 'rt_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(32)));
      await storage.put('oauth:refresh:' + await photonOAuthHashKey(refreshToken), { sub: code.sub, role: code.role ?? 'user', name: code.name, scope, clientId, resource, expiresAt: Date.now() + MCP_OAUTH_REFRESH_TTL * 1000 });
      return photonOAuthJson(200, { access_token: accessToken, token_type: 'Bearer', expires_in: MCP_OAUTH_ACCESS_TTL, refresh_token: refreshToken, scope });
    }
    if (grantType === 'refresh_token') {
      const old = form.get('refresh_token') ?? '';
      const key = 'oauth:refresh:' + await photonOAuthHashKey(old);
      const grant = await storage.transaction(async (transaction) => {
        const candidate = await transaction.get<any>(key);
        if (!candidate || candidate.expiresAt < Date.now() || candidate.clientId !== clientId) return null;
        await transaction.delete(key);
        return candidate;
      });
      if (!grant) return photonOAuthError(400, 'invalid_grant', 'Invalid refresh token');
      const accessToken = await photonOAuthJwt(storage, { sub: grant.sub, role: grant.role, name: grant.name, scope: grant.scope, client_id: clientId }, MCP_OAUTH_ACCESS_TTL, request);
      const refreshToken = 'rt_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(32)));
      await storage.put('oauth:refresh:' + await photonOAuthHashKey(refreshToken), { ...grant, expiresAt: Date.now() + MCP_OAUTH_REFRESH_TTL * 1000 });
      return photonOAuthJson(200, { access_token: accessToken, token_type: 'Bearer', expires_in: MCP_OAUTH_ACCESS_TTL, refresh_token: refreshToken, scope: grant.scope });
    }
    return photonOAuthError(400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  }

  if ((pathname === '/revoke' || pathname === '/introspect') && request.method === 'POST') {
    const form = photonOAuthForm(request, await request.text());
    const token = form.get('token') ?? '';
    const clientId = form.get('client_id');
    if (!clientId) return photonOAuthError(401, 'invalid_client', 'Client authentication is required');
    const client = await photonOAuthClient(storage, clientId);
    if (!client) return photonOAuthError(401, 'invalid_client', 'Unknown client');
    if (client.clientSecretHash && await photonOAuthHashKey(form.get('client_secret') ?? '') !== client.clientSecretHash) return photonOAuthError(401, 'invalid_client', 'Invalid client credentials');
    if (pathname === '/revoke') {
      await storage.delete('oauth:refresh:' + await photonOAuthHashKey(token));
      return new Response(null, { status: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } });
    }
    const claims = await photonOAuthVerifyJwt(storage, token, request);
    if (!claims) return photonOAuthJson(200, { active: false });
    return photonOAuthJson(200, { active: true, client_id: claims.client_id, sub: claims.sub, scope: claims.scope, aud: claims.aud, iss: claims.iss, exp: claims.exp, iat: claims.iat, token_type: 'Bearer' });
  }

  return photonOAuthError(405, 'method_not_allowed', 'Unsupported OAuth method', { Allow: 'GET, POST' });
}
`;
}
