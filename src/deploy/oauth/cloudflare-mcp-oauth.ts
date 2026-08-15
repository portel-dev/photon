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

export interface CloudflareMcpOAuthCodegenOptions {
  photonName: string;
  scopes: string[];
  /** Stable canonical issuer/resource origin for RFC 8414 and RFC 8707. */
  issuer: string;
  /** Whether anonymous MCP discovery and public user tools are allowed. */
  oauthAuthMode: 'optional' | 'required';
  /** Optional KV namespace id supplied by the deploy environment. */
  kvNamespaceId?: string;
}

export function renderCloudflareMcpOAuthBindings(kvNamespaceId?: string): string {
  if (!kvNamespaceId) {
    return `# MCP OAuth state is authoritative in the host Durable Object ctx.storage.
# Public authorization requires a trusted identity adapter: configure
# PHOTON_MCP_OAUTH_LOGIN_URL and PHOTON_MCP_OAUTH_LOGIN_SECRET as Worker
# bindings.
# Optional external state contract: set PHOTON_MCP_OAUTH_KV_ID at deploy time
# to emit a PHOTON_OAUTH_KV binding for migration/caching integrations.`;
  }
  return `[[kv_namespaces]]
binding = "PHOTON_OAUTH_KV"
id = "${escapeToml(kvNamespaceId)}"
# MCP OAuth remains authoritative in Durable Object storage; this binding is
# available for deployment-specific replication, audit, or migration code.
# Configure PHOTON_MCP_OAUTH_LOGIN_URL and PHOTON_MCP_OAUTH_LOGIN_SECRET for
# a public-user login callback.`;
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
  const callSite = `      body\n    );`;
  if (!output.includes(callSite)) {
    throw new Error('Cloudflare OAuth injection seam missing: checkMcpAuth call site');
  }
  output = output.replace(callSite, `      body,\n      this.ctx.storage\n    );`);

  const fetchMarker = `    const url = new URL(request.url);\n\n    // Internal cross-photon call`;
  if (!output.includes(fetchMarker)) {
    throw new Error('Cloudflare OAuth injection seam missing: Durable Object fetch');
  }
  output = output.replace(
    fetchMarker,
    `    const url = new URL(request.url);\n\n    if (MCP_AUTH_MODE === 'oauth') {\n      const oauthResponse = await handlePhotonMcpOAuth(\n        request,\n        this.ctx.storage,\n        this.photonName,\n        this.toolDefinitions,\n        this.env\n      );\n      if (oauthResponse) return oauthResponse;\n    }\n\n    // Internal cross-photon call`
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
  const issuer = JSON.stringify(options.issuer);
  return String.raw`
// ════════════════════════════════════════════════════════════════════════════
// Generated inbound MCP OAuth (RFC 8414 / 7591 / 7636 / 7662)
// ════════════════════════════════════════════════════════════════════════════

const MCP_OAUTH_DEFAULT_SCOPES: string[] = ${scopes};
const MCP_OAUTH_PHOTON_NAME = ${photonName};
const MCP_OAUTH_ISSUER = ${issuer};
const MCP_OAUTH_AUTH_MODE = ${JSON.stringify(options.oauthAuthMode)};
const MCP_OAUTH_ACCESS_TTL = 15 * 60;
const MCP_OAUTH_REFRESH_TTL = 30 * 24 * 60 * 60;
const MCP_OAUTH_CODE_TTL = 60;
const MCP_OAUTH_TX_TTL = 10 * 60;

type PhotonOAuthStorage = DurableObjectStorage;

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

function photonOAuthHtml(status: number, html: string): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
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
  // authenticated OAuth subject defaults to the ordinary customer role.
  const role = typeof claims.role === 'string' ? claims.role : 'customer';
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
    if (typeof configured === 'string' && configured.trim()) return { sub: configured.trim(), role: 'customer' };
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
  const role = url.searchParams.get('role') ?? 'customer';
  const signature = url.searchParams.get('signature');
  const secret = (env as any).PHOTON_MCP_OAUTH_LOGIN_SECRET;
  if (!sub || !signature || typeof secret !== 'string' || !secret) return null;
  if (role !== 'customer' && role !== 'host') return null;
  const expected = await photonOAuthLoginSignature(secret, [tx.id, sub, role].join('.'));
  if (!photonOAuthConstantTimeEqual(expected, signature)) return null;
  return { sub, role };
}

/**
 * Complete an OAuth transaction from a Cloudflare Access-protected login
 * route. The Access email header is only accepted on this dedicated route;
 * the route itself must be protected by a Cloudflare Access application.
 */
async function photonOAuthAccessLogin(request: Request, storage: PhotonOAuthStorage, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const txId = url.searchParams.get('oauth_state') ?? url.searchParams.get('tx');
  if (!txId) return photonOAuthError(400, 'invalid_request', 'oauth_state is required');
  const tx = await storage.get<any>('oauth:tx:' + txId);
  if (!tx || tx.expiresAt < Date.now()) return photonOAuthError(400, 'invalid_request', 'authorization transaction expired');

  const subject = request.headers.get('Cf-Access-Authenticated-User-Email')?.trim().toLowerCase();
  if (!subject || !subject.includes('@')) return photonOAuthError(401, 'login_required', 'Cloudflare Access identity is required');

  const hostSubjects = String((env as any).PHOTON_MCP_OAUTH_HOST_SUBJECTS ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const role = hostSubjects.includes(subject) ? 'host' : 'customer';
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
  const scope = String(tx.scope ?? '').replace(/[<&>"']/g, '');
  const clientName = String(tx.clientName ?? tx.clientId).replace(/[<&>"']/g, '');
  return photonOAuthHtml(200, '<!doctype html><title>Authorize ' + clientName + '</title><main style="font:16px system-ui;max-width:36rem;margin:4rem auto"><h1>Authorize ' + clientName + '</h1><p>This MCP client is requesting: <code>' + scope + '</code></p><form method="post" action="/consent"><input type="hidden" name="tx" value="' + encodeURIComponent(tx.id) + '"><button name="action" value="approve">Allow</button> <button name="action" value="deny">Deny</button></form></main>');
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
    return photonOAuthAccessLogin(request, storage, env, origin);
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
    return new Response(null, { status: 302, headers: { Location: login.toString(), 'Cache-Control': 'no-store', ...CORS_HEADERS } });
  }

  if (pathname === '/consent' && request.method === 'GET') {
    const txId = url.searchParams.get('tx');
    if (!txId) return photonOAuthError(400, 'invalid_request', 'tx is required');
    const tx = await storage.get<any>('oauth:tx:' + txId);
    if (!tx || tx.expiresAt < Date.now()) return photonOAuthError(400, 'invalid_request', 'authorization transaction expired');
    if (!tx.sub) {
      const callbackSubject = await photonOAuthVerifyLoginCallback(request, env, tx);
      if (callbackSubject) { tx.sub = callbackSubject.sub; tx.role = callbackSubject.role; tx.name = callbackSubject.name; await storage.put('oauth:tx:' + tx.id, tx); }
    }
    if (!tx.sub) return photonOAuthError(401, 'login_required', 'The authorization transaction has no authenticated subject');
    return photonOAuthConsentPage(tx);
  }

  if (pathname === '/consent' && request.method === 'POST') {
    const form = photonOAuthForm(request, await request.text());
    const txId = form.get('tx');
    const tx = txId ? await storage.get<any>('oauth:tx:' + txId) : null;
    if (!tx || tx.expiresAt < Date.now() || !tx.sub) return photonOAuthError(400, 'invalid_request', 'authorization transaction expired');
    await storage.delete('oauth:tx:' + tx.id);
    if (form.get('action') !== 'approve') return photonOAuthRedirectError(tx.redirectUri, tx.state, 'access_denied', 'The resource owner denied the request');
    const code = 'code_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(32)));
    await storage.put('oauth:code:' + code, { ...tx, code, role: tx.role ?? 'customer', createdAt: Date.now(), expiresAt: Date.now() + MCP_OAUTH_CODE_TTL * 1000 });
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
        return candidate;
      }) : null;
      if (!code) return photonOAuthError(400, 'invalid_grant', 'Invalid authorization code or PKCE verifier');
      const scope = code.scope || scopes.join(' ');
      const accessToken = await photonOAuthJwt(storage, { sub: code.sub, role: code.role ?? 'customer', name: code.name, scope, client_id: clientId }, MCP_OAUTH_ACCESS_TTL, request);
      const refreshToken = 'rt_' + photonOAuthB64(crypto.getRandomValues(new Uint8Array(32)));
      await storage.put('oauth:refresh:' + await photonOAuthHashKey(refreshToken), { sub: code.sub, role: code.role ?? 'customer', name: code.name, scope, clientId, resource, expiresAt: Date.now() + MCP_OAUTH_REFRESH_TTL * 1000 });
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
