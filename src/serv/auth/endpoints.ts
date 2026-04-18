/**
 * OAuth 2.1 Authorization Server HTTP handlers.
 *
 * Pure functions (no HTTP framework coupling): each handler takes an
 * `AuthRequest` describing the inbound HTTP request, plus a `Deps` object
 * with the stores it needs, and returns an `AuthResponse` `{status, headers, body}`.
 *
 * The HTTP-framework adapter (Express/Fetch/Cloudflare Worker) is responsible
 * for parsing the request, authenticating the user session (if any), and
 * translating the response back to its native HTTP primitive.
 *
 * Implements:
 * - `/authorize`                  — RFC 6749 §4.1 authorization code grant (PKCE required)
 * - `/token`                      — RFC 6749 §4.1.3 / §6 / §4.4 (code, refresh, client_credentials)
 * - `/register`                   — RFC 7591 dynamic client registration
 * - `/consent`                    — HTML consent screen + POST approve/deny
 *
 * CIMD (HTTPS client_id) is resolved via `resolveClientMetadata` from
 * `./well-known.js`. Both CIMD and DCR clients are accepted at `/authorize`
 * and `/token`; `/register` writes DCR-only.
 */

import type {
  AuthorizationCode,
  RefreshToken,
  RegisteredClient,
  ConsentRecord,
  Tenant,
} from '../types/index.js';
import type {
  AuthCodeStore,
  RefreshTokenStore,
  ClientRegistry,
  ConsentStore,
  PendingAuthorizationStore,
  PendingAuthorization,
} from './auth-store.js';
import {
  generateSecureToken,
  hashClientSecret,
  verifyClientSecret,
  normalizeScopes,
} from './auth-store.js';
import { JwtService, verifyCodeChallenge } from './jwt.js';
import { resolveClientMetadata, CimdCache } from './well-known.js';

// ============================================================================
// Request / Response Types
// ============================================================================

export interface AuthRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw body for POST — form-urlencoded or JSON depending on endpoint. */
  body?: string;
  /**
   * Resolved authenticated user id. The HTTP adapter fills this in from
   * its session middleware before invoking the handler. `undefined` means
   * no valid session; `/authorize` will redirect to login.
   */
  userId?: string;
}

export interface AuthResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// ============================================================================
// Dependencies / Config
// ============================================================================

export interface EndpointConfig {
  /** Absolute base URL of this AS; used for `iss` claim + building login redirect. */
  issuer: string;
  /** Absolute URL of this AS's `/authorize` endpoint; used for login return_to. */
  authorizeUrl: string;
  /** Absolute URL of this AS's `/consent` endpoint. */
  consentUrl: string;
  /** Absolute URL of the login/federated-auth entry point. */
  loginUrl: string;
  /** First-party clients that bypass the consent screen. */
  firstPartyClientIds: Set<string>;
  /** Default scopes granted if client omits scope parameter. */
  defaultScopes: string[];
  /** Consent-record TTL. Default 30 days. */
  consentTtlDays: number;
  /** Authorization code TTL in seconds. Default 60 per RFC 6749. */
  codeTtlSeconds: number;
  /** Access-token TTL in seconds. Default 15 min. */
  accessTokenTtlSeconds: number;
  /** Refresh-token TTL in seconds. Default 30 days. */
  refreshTokenTtlSeconds: number;
  /** Pending-authorization TTL in seconds. Default 10 min. */
  pendingTtlSeconds: number;
  /** DCR client idle-TTL in milliseconds. Default 30 days. */
  clientIdleTtlMs: number;
  /** PHOTON_SINGLE_USER self-host mode: always treat caller as this user id. */
  singleUserId?: string;
}

export const DEFAULT_ENDPOINT_CONFIG: Omit<
  EndpointConfig,
  'issuer' | 'authorizeUrl' | 'consentUrl' | 'loginUrl'
> = {
  firstPartyClientIds: new Set(['photon-cli', 'photon-beam']),
  defaultScopes: ['mcp:read'],
  consentTtlDays: 30,
  codeTtlSeconds: 60,
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  pendingTtlSeconds: 10 * 60,
  clientIdleTtlMs: 30 * 24 * 60 * 60 * 1000,
};

export interface EndpointDeps {
  tenant: Tenant;
  config: EndpointConfig;
  codeStore: AuthCodeStore;
  refreshTokenStore: RefreshTokenStore;
  clientRegistry: ClientRegistry;
  consentStore: ConsentStore;
  pendingStore: PendingAuthorizationStore;
  jwtService: JwtService;
  cimdCache: CimdCache;
  /** Optional override for testing. */
  now?: () => Date;
  /** Optional logger hook. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;
}

// ============================================================================
// Response Helpers
// ============================================================================

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

function jsonResponse(status: number, body: unknown): AuthResponse {
  return { status, headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
}

function errorResponse(
  status: number,
  error: string,
  errorDescription: string,
  errorUri?: string
): AuthResponse {
  const body: Record<string, string> = { error, error_description: errorDescription };
  if (errorUri) body.error_uri = errorUri;
  return jsonResponse(status, body);
}

function redirectResponse(
  location: string,
  extraHeaders: Record<string, string> = {}
): AuthResponse {
  return {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', ...extraHeaders },
    body: '',
  };
}

function htmlResponse(status: number, html: string): AuthResponse {
  return {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; img-src https:",
    },
    body: html,
  };
}

/**
 * Build a redirect URL for an authorization error per RFC 6749 §4.1.2.1.
 */
function authorizeErrorRedirect(
  redirectUri: string,
  state: string | undefined,
  error: string,
  errorDescription: string
): AuthResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', errorDescription);
  if (state) url.searchParams.set('state', state);
  return redirectResponse(url.toString());
}

// ============================================================================
// /authorize
// ============================================================================

export async function handleAuthorize(req: AuthRequest, deps: EndpointDeps): Promise<AuthResponse> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(405, 'invalid_request', 'method not allowed');
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type');
  const scope = params.get('scope') ?? '';
  const state = params.get('state') ?? undefined;
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const prompt = params.get('prompt') ?? undefined;

  // Pre-redirect validations return error JSON (can't trust the redirect_uri yet).
  if (!clientId) {
    return errorResponse(400, 'invalid_request', 'client_id is required');
  }
  if (!redirectUri) {
    return errorResponse(400, 'invalid_request', 'redirect_uri is required');
  }
  if (responseType !== 'code') {
    return errorResponse(400, 'unsupported_response_type', 'only response_type=code is supported');
  }
  if (!codeChallenge) {
    return errorResponse(400, 'invalid_request', 'code_challenge is required (PKCE)');
  }
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return errorResponse(400, 'invalid_request', 'only code_challenge_method=S256 is supported');
  }

  // Resolve client: CIMD (HTTPS URL) or DCR registry
  const clientInfo = await resolveClient(clientId, deps);
  if (!clientInfo) {
    return errorResponse(400, 'invalid_client', `unknown or invalid client_id: ${clientId}`);
  }

  // Validate redirect_uri against client's allowed list (exact match)
  if (!clientInfo.redirectUris.includes(redirectUri)) {
    return errorResponse(
      400,
      'invalid_request',
      'redirect_uri does not match any registered URI for this client'
    );
  }

  // Everything below here may redirect to redirect_uri with error params.

  // Determine subject
  const userId = deps.config.singleUserId ?? req.userId;
  if (!userId) {
    if (prompt === 'none') {
      return authorizeErrorRedirect(redirectUri, state, 'login_required', 'user not authenticated');
    }
    // Redirect to login with return_to pointing back at /authorize with full query
    const loginUrl = new URL(deps.config.loginUrl);
    loginUrl.searchParams.set('return_to', req.url);
    return redirectResponse(loginUrl.toString());
  }

  // Normalize scopes
  const requestedScopes = scope ? scope.split(/\s+/).filter(Boolean) : deps.config.defaultScopes;

  // Consent check
  const isFirstParty = deps.config.firstPartyClientIds.has(clientId);
  const alreadyConsented = isFirstParty
    ? true
    : await deps.consentStore.covers(userId, deps.tenant.id, clientId, requestedScopes);

  const forceConsent = prompt === 'consent';
  const needConsent = forceConsent || !alreadyConsented;

  if (needConsent) {
    if (prompt === 'none') {
      return authorizeErrorRedirect(
        redirectUri,
        state,
        'consent_required',
        'user consent required but prompt=none'
      );
    }
    // Stash pending request, redirect to consent page
    const pendingId = generateSecureToken(24);
    const now = (deps.now ?? (() => new Date()))();
    const pending: PendingAuthorization = {
      id: pendingId,
      clientId,
      redirectUri,
      scope: normalizeScopes(requestedScopes.join(' ')),
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      userId,
      tenantId: deps.tenant.id,
      responseType: 'code',
      expiresAt: new Date(now.getTime() + deps.config.pendingTtlSeconds * 1000),
      createdAt: now,
    };
    await deps.pendingStore.save(pending);
    const consentUrl = new URL(deps.config.consentUrl);
    consentUrl.searchParams.set('req', pendingId);
    return redirectResponse(consentUrl.toString());
  }

  // Consent granted (or skipped) — mint code and redirect
  return await issueCodeAndRedirect(
    {
      clientId,
      redirectUri,
      scope: requestedScopes.join(' '),
      state,
      codeChallenge,
      userId,
    },
    deps
  );
}

/**
 * Issue an authorization code and redirect back to the client.
 * Extracted so `/consent` can resume the flow symmetrically.
 */
async function issueCodeAndRedirect(
  args: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state?: string;
    codeChallenge: string;
    userId: string;
  },
  deps: EndpointDeps
): Promise<AuthResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const code = generateSecureToken(32);
  const authCode: AuthorizationCode = {
    code,
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    scope: args.scope,
    userId: args.userId,
    tenantId: deps.tenant.id,
    codeChallenge: args.codeChallenge,
    codeChallengeMethod: 'S256',
    expiresAt: new Date(now.getTime() + deps.config.codeTtlSeconds * 1000),
    createdAt: now,
  };
  await deps.codeStore.save(authCode);

  const redirect = new URL(args.redirectUri);
  redirect.searchParams.set('code', code);
  if (args.state) redirect.searchParams.set('state', args.state);

  deps.log?.('info', 'authorization_code_issued', {
    client_id: args.clientId,
    user_id: args.userId,
    scope: args.scope,
  });

  return redirectResponse(redirect.toString());
}

// ============================================================================
// /consent (GET = screen, POST = approve/deny)
// ============================================================================

export async function handleConsent(req: AuthRequest, deps: EndpointDeps): Promise<AuthResponse> {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const pendingId = url.searchParams.get('req');
    if (!pendingId) {
      return errorResponse(400, 'invalid_request', 'missing pending request id');
    }
    // Peek without consuming — we consume on POST approve.
    // A tiny race exists here (expiry between GET and POST); acceptable for 10-min window.
    const pending = await peekPending(deps.pendingStore, pendingId);
    if (!pending) {
      return errorResponse(400, 'invalid_request', 'pending request not found or expired');
    }
    const client = await resolveClient(pending.clientId, deps);
    return htmlResponse(200, renderConsentPage(pending, client, deps.tenant));
  }

  if (req.method === 'POST') {
    const userId = deps.config.singleUserId ?? req.userId;
    if (!userId) return errorResponse(401, 'unauthorized', 'login required');

    const form = parseFormBody(req.body ?? '');
    const pendingId = form.get('req');
    const decision = form.get('decision');
    if (!pendingId) {
      return errorResponse(400, 'invalid_request', 'missing req field');
    }
    const pending = await deps.pendingStore.consume(pendingId);
    if (!pending) {
      return errorResponse(400, 'invalid_request', 'pending request not found or expired');
    }
    if (pending.userId !== userId || pending.tenantId !== deps.tenant.id) {
      deps.log?.('warn', 'consent_user_mismatch', {
        pending_user: pending.userId,
        actual_user: userId,
      });
      return errorResponse(403, 'forbidden', 'pending request does not belong to this user');
    }

    if (decision !== 'approve') {
      return authorizeErrorRedirect(
        pending.redirectUri,
        pending.state,
        'access_denied',
        'user denied consent'
      );
    }

    // Save remembered consent
    const now = (deps.now ?? (() => new Date()))();
    const record: ConsentRecord = {
      userId,
      tenantId: deps.tenant.id,
      clientId: pending.clientId,
      scopes: pending.scope,
      expiresAt: new Date(now.getTime() + deps.config.consentTtlDays * 24 * 60 * 60 * 1000),
      createdAt: now,
    };
    await deps.consentStore.save(record);

    return await issueCodeAndRedirect(
      {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        scope: pending.scope,
        state: pending.state,
        codeChallenge: pending.codeChallenge,
        userId,
      },
      deps
    );
  }

  return errorResponse(405, 'invalid_request', 'method not allowed');
}

// ============================================================================
// /token
// ============================================================================

export async function handleToken(req: AuthRequest, deps: EndpointDeps): Promise<AuthResponse> {
  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_request', 'method must be POST');
  }
  const form = parseFormBody(req.body ?? '');
  const grantType = form.get('grant_type');

  // Client authentication (Basic or post-body)
  const authedClient = await authenticateTokenClient(req, form, deps);
  // Some grants allow public clients (no auth). We return the failure only
  // where it's actually required.

  switch (grantType) {
    case 'authorization_code':
      return await handleAuthorizationCodeGrant(form, authedClient, deps);
    case 'refresh_token':
      return await handleRefreshTokenGrant(form, authedClient, deps);
    case 'client_credentials':
      return await handleClientCredentialsGrant(authedClient, form, deps);
    default:
      return errorResponse(
        400,
        'unsupported_grant_type',
        `grant_type '${grantType ?? ''}' is not supported`
      );
  }
}

async function handleAuthorizationCodeGrant(
  form: URLSearchParams,
  authedClient: AuthenticatedClient | null,
  deps: EndpointDeps
): Promise<AuthResponse> {
  const code = form.get('code');
  const redirectUri = form.get('redirect_uri');
  const codeVerifier = form.get('code_verifier');
  const clientIdParam = form.get('client_id');

  if (!code || !redirectUri || !codeVerifier) {
    return errorResponse(
      400,
      'invalid_request',
      'code, redirect_uri, and code_verifier are required'
    );
  }

  const stored = await deps.codeStore.consume(code);
  if (!stored) {
    return errorResponse(400, 'invalid_grant', 'authorization code is invalid or expired');
  }

  // Client identity: either from Basic auth (confidential) or client_id form param (public)
  const effectiveClientId = authedClient?.clientId ?? clientIdParam;
  if (effectiveClientId !== stored.clientId) {
    return errorResponse(400, 'invalid_grant', 'client_id does not match the code issuer');
  }

  if (stored.redirectUri !== redirectUri) {
    return errorResponse(400, 'invalid_grant', 'redirect_uri does not match original request');
  }

  // PKCE verify
  if (!verifyCodeChallenge(codeVerifier, stored.codeChallenge)) {
    return errorResponse(400, 'invalid_grant', 'code_verifier does not match code_challenge');
  }

  // If the client is registered as confidential, it MUST authenticate
  const registered = await deps.clientRegistry.find(stored.clientId);
  if (registered && !registered.isPublic && !authedClient) {
    return errorResponse(401, 'invalid_client', 'confidential client must authenticate');
  }

  await deps.clientRegistry.touch(stored.clientId);

  return await issueTokens(
    {
      clientId: stored.clientId,
      userId: stored.userId,
      scope: stored.scope,
    },
    deps
  );
}

async function handleRefreshTokenGrant(
  form: URLSearchParams,
  authedClient: AuthenticatedClient | null,
  deps: EndpointDeps
): Promise<AuthResponse> {
  const refreshToken = form.get('refresh_token');
  if (!refreshToken) {
    return errorResponse(400, 'invalid_request', 'refresh_token is required');
  }
  const clientIdParam = form.get('client_id');
  const existing = await deps.refreshTokenStore.find(refreshToken);
  if (!existing) {
    return errorResponse(400, 'invalid_grant', 'refresh_token is invalid or expired');
  }

  const effectiveClientId = authedClient?.clientId ?? clientIdParam;
  if (effectiveClientId !== existing.clientId) {
    return errorResponse(400, 'invalid_grant', 'client_id does not match refresh token');
  }

  const registered = await deps.clientRegistry.find(existing.clientId);
  if (registered && !registered.isPublic && !authedClient) {
    return errorResponse(401, 'invalid_client', 'confidential client must authenticate');
  }

  // Optional scope narrowing
  const requestedScope = form.get('scope');
  let scope = existing.scope;
  if (requestedScope) {
    const existingSet = new Set(existing.scope.split(' ').filter(Boolean));
    const requested = requestedScope.split(/\s+/).filter(Boolean);
    if (!requested.every((s) => existingSet.has(s))) {
      return errorResponse(400, 'invalid_scope', 'requested scope exceeds original grant');
    }
    scope = requested.join(' ');
  }

  // Rotate the refresh token (OAuth 2.1 requires rotation for public clients)
  const now = (deps.now ?? (() => new Date()))();
  const newRefreshToken = generateSecureToken(32);
  const rotated = await deps.refreshTokenStore.rotate(refreshToken, {
    token: newRefreshToken,
    clientId: existing.clientId,
    userId: existing.userId,
    tenantId: existing.tenantId,
    scope,
    expiresAt: new Date(now.getTime() + deps.config.refreshTokenTtlSeconds * 1000),
    createdAt: now,
    supersedes: hashClientSecret(refreshToken), // hashed for replay detection
  });
  if (!rotated) {
    return errorResponse(400, 'invalid_grant', 'refresh_token rotation failed');
  }
  await deps.clientRegistry.touch(existing.clientId);

  return await issueTokens(
    { clientId: existing.clientId, userId: existing.userId, scope, preRotated: newRefreshToken },
    deps
  );
}

async function handleClientCredentialsGrant(
  authedClient: AuthenticatedClient | null,
  form: URLSearchParams,
  deps: EndpointDeps
): Promise<AuthResponse> {
  if (!authedClient) {
    return errorResponse(
      401,
      'invalid_client',
      'client_credentials grant requires client authentication'
    );
  }
  if (authedClient.registered.isPublic) {
    return errorResponse(
      400,
      'unauthorized_client',
      'public clients cannot use client_credentials'
    );
  }
  const requestedScope = form.get('scope');
  const allowedScopes = new Set(authedClient.registered.scope.split(' ').filter(Boolean));
  let scope: string;
  if (requestedScope) {
    const requested = requestedScope.split(/\s+/).filter(Boolean);
    if (!requested.every((s) => allowedScopes.has(s))) {
      return errorResponse(400, 'invalid_scope', 'requested scope not permitted for client');
    }
    scope = requested.join(' ');
  } else {
    scope = authedClient.registered.scope;
  }

  await deps.clientRegistry.touch(authedClient.clientId);

  // No refresh token for client_credentials per RFC 6749 §4.4.3
  const now = (deps.now ?? (() => new Date()))();
  const accessToken = deps.jwtService.generateAccessToken({
    sub: `client:${authedClient.clientId}`,
    tenantId: deps.tenant.id,
    scope,
    clientId: authedClient.clientId,
    expiresInSeconds: deps.config.accessTokenTtlSeconds,
    now,
  });

  return jsonResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: deps.config.accessTokenTtlSeconds,
    scope,
  });
}

async function issueTokens(
  args: {
    clientId: string;
    userId: string;
    scope: string;
    /** If provided, use this refresh token value instead of generating. */
    preRotated?: string;
  },
  deps: EndpointDeps
): Promise<AuthResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const accessToken = deps.jwtService.generateAccessToken({
    sub: args.userId,
    tenantId: deps.tenant.id,
    scope: args.scope,
    clientId: args.clientId,
    expiresInSeconds: deps.config.accessTokenTtlSeconds,
    now,
  });

  let refreshToken = args.preRotated;
  if (!refreshToken) {
    refreshToken = generateSecureToken(32);
    const record: RefreshToken = {
      token: refreshToken,
      clientId: args.clientId,
      userId: args.userId,
      tenantId: deps.tenant.id,
      scope: args.scope,
      expiresAt: new Date(now.getTime() + deps.config.refreshTokenTtlSeconds * 1000),
      createdAt: now,
    };
    await deps.refreshTokenStore.save(record);
  }

  return jsonResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: deps.config.accessTokenTtlSeconds,
    refresh_token: refreshToken,
    scope: args.scope,
  });
}

// ============================================================================
// /register (RFC 7591 DCR)
// ============================================================================

export async function handleRegister(req: AuthRequest, deps: EndpointDeps): Promise<AuthResponse> {
  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_request', 'method must be POST');
  }

  let body: RegisterRequestBody;
  try {
    body = JSON.parse(req.body ?? '{}') as RegisterRequestBody;
  } catch {
    return errorResponse(400, 'invalid_client_metadata', 'body must be valid JSON');
  }

  if (
    !body.redirect_uris ||
    !Array.isArray(body.redirect_uris) ||
    body.redirect_uris.length === 0
  ) {
    return errorResponse(400, 'invalid_redirect_uri', 'redirect_uris must be a non-empty array');
  }

  for (const uri of body.redirect_uris) {
    if (typeof uri !== 'string' || !/^https?:\/\//.test(uri)) {
      return errorResponse(
        400,
        'invalid_redirect_uri',
        `redirect_uri '${uri}' must be an http(s) URL`
      );
    }
  }

  const clientName = typeof body.client_name === 'string' ? body.client_name : 'Unnamed Client';
  const grantTypes =
    Array.isArray(body.grant_types) && body.grant_types.length > 0
      ? body.grant_types.filter((g): g is string => typeof g === 'string')
      : ['authorization_code', 'refresh_token'];
  const responseTypes =
    Array.isArray(body.response_types) && body.response_types.length > 0
      ? body.response_types.filter((r): r is string => typeof r === 'string')
      : ['code'];

  const tokenEndpointAuthMethod =
    typeof body.token_endpoint_auth_method === 'string'
      ? body.token_endpoint_auth_method
      : 'client_secret_basic';

  const isPublic = tokenEndpointAuthMethod === 'none';

  const clientId = generateSecureToken(32);
  const clientSecret = isPublic ? undefined : generateSecureToken(32);

  const now = (deps.now ?? (() => new Date()))();
  const record: RegisteredClient = {
    clientId,
    clientSecretHash: clientSecret ? hashClientSecret(clientSecret) : undefined,
    clientName,
    redirectUris: body.redirect_uris,
    grantTypes,
    responseTypes,
    scope:
      typeof body.scope === 'string' && body.scope
        ? body.scope
        : deps.config.defaultScopes.join(' '),
    contacts: Array.isArray(body.contacts)
      ? body.contacts.filter((c): c is string => typeof c === 'string')
      : undefined,
    logoUri: typeof body.logo_uri === 'string' ? body.logo_uri : undefined,
    tosUri: typeof body.tos_uri === 'string' ? body.tos_uri : undefined,
    policyUri: typeof body.policy_uri === 'string' ? body.policy_uri : undefined,
    isPublic,
    createdAt: now,
    lastUsedAt: now,
    registrationContext: {
      userAgent: firstHeaderValue(req.headers['user-agent']),
      ipAddress: firstHeaderValue(req.headers['x-forwarded-for'])?.split(',')[0]?.trim(),
    },
  };
  await deps.clientRegistry.save(record);

  deps.log?.('warn', 'dcr_client_registered', {
    client_id: clientId,
    client_name: clientName,
    user_agent: record.registrationContext?.userAgent,
    ip: record.registrationContext?.ipAddress,
    // warn-level so operators see the deprecation signal in logs
    hint: 'CIMD is preferred over DCR — see docs/internals/oauth-authorization-server.md',
  });

  return jsonResponse(201, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    ...(clientSecret ? { client_secret_expires_at: 0 } : {}), // 0 = never expires per RFC 7591
    client_name: clientName,
    redirect_uris: record.redirectUris,
    grant_types: record.grantTypes,
    response_types: record.responseTypes,
    scope: record.scope,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    ...(record.contacts ? { contacts: record.contacts } : {}),
    ...(record.logoUri ? { logo_uri: record.logoUri } : {}),
    ...(record.tosUri ? { tos_uri: record.tosUri } : {}),
    ...(record.policyUri ? { policy_uri: record.policyUri } : {}),
  });
}

interface RegisterRequestBody {
  redirect_uris?: unknown;
  client_name?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
  scope?: unknown;
  contacts?: unknown;
  logo_uri?: unknown;
  tos_uri?: unknown;
  policy_uri?: unknown;
}

// ============================================================================
// Client Resolution (CIMD or DCR)
// ============================================================================

interface ResolvedClient {
  clientId: string;
  redirectUris: string[];
  clientName: string;
  /** CIMD origin URL (the HTTPS client_id itself) or null for DCR. */
  cimdUrl?: string;
}

async function resolveClient(clientId: string, deps: EndpointDeps): Promise<ResolvedClient | null> {
  if (clientId.startsWith('https://')) {
    const result = await resolveClientMetadata(clientId, {
      cache: deps.cimdCache,
      allowedDomains: deps.tenant.settings.allowedClientDomains,
    });
    if (!result.ok || !result.metadata) {
      deps.log?.('warn', 'cimd_resolution_failed', {
        client_id: clientId,
        error: result.error,
      });
      return null;
    }
    return {
      clientId,
      redirectUris: result.metadata.redirect_uris,
      clientName: result.metadata.client_name ?? clientId,
      cimdUrl: clientId,
    };
  }
  const registered = await deps.clientRegistry.find(clientId);
  if (!registered) return null;
  return {
    clientId,
    redirectUris: registered.redirectUris,
    clientName: registered.clientName,
  };
}

// ============================================================================
// Client Authentication for /token (Basic or form-post)
// ============================================================================

interface AuthenticatedClient {
  clientId: string;
  registered: RegisteredClient;
}

async function authenticateTokenClient(
  req: AuthRequest,
  form: URLSearchParams,
  deps: EndpointDeps
): Promise<AuthenticatedClient | null> {
  // Try HTTP Basic first
  const authHeader = firstHeaderValue(req.headers.authorization);
  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx < 0) return null;
      const clientId = decoded.slice(0, idx);
      const clientSecret = decoded.slice(idx + 1);
      return await verifyClient(clientId, clientSecret, deps);
    } catch {
      return null;
    }
  }
  // Fallback: client_secret_post
  const clientId = form.get('client_id');
  const clientSecret = form.get('client_secret');
  if (clientId && clientSecret) {
    return await verifyClient(clientId, clientSecret, deps);
  }
  return null;
}

async function verifyClient(
  clientId: string,
  clientSecret: string,
  deps: EndpointDeps
): Promise<AuthenticatedClient | null> {
  const registered = await deps.clientRegistry.find(clientId);
  if (!registered || !registered.clientSecretHash) return null;
  if (!verifyClientSecret(clientSecret, registered.clientSecretHash)) return null;
  return { clientId, registered };
}

// ============================================================================
// Form / header helpers
// ============================================================================

function parseFormBody(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function firstHeaderValue(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

async function peekPending(
  store: PendingAuthorizationStore,
  id: string
): Promise<PendingAuthorization | null> {
  const entry = await store.consume(id);
  if (!entry) return null;
  await store.save(entry); // put it back
  return entry;
}

// ============================================================================
// Consent screen HTML (minimal, inlined styles)
// ============================================================================

function renderConsentPage(
  pending: PendingAuthorization,
  client: ResolvedClient | null,
  tenant: Tenant
): string {
  const clientName = client?.clientName ?? pending.clientId;
  const cimdBadge = client?.cimdUrl
    ? `<span class="cimd">hosted metadata: ${escapeHtml(client.cimdUrl)}</span>`
    : '';
  const scopes = pending.scope.split(' ').filter(Boolean);
  const scopeList = scopes.length
    ? `<ul class="scopes">${scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
    : '<p class="muted">No specific scopes requested.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authorize ${escapeHtml(clientName)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 24px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .muted { color: #666; }
  .cimd { display: inline-block; font-size: 12px; color: #555; background: #f4f4f4; padding: 2px 8px; border-radius: 4px; margin-top: 8px; }
  .scopes { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 12px 24px; list-style: disc; }
  .scopes li { margin: 6px 0; font-family: monospace; font-size: 13px; }
  form { margin-top: 24px; display: flex; gap: 12px; }
  button { flex: 1; padding: 12px 16px; font-size: 15px; border-radius: 8px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  button.approve { background: #0066cc; color: #fff; border-color: #0066cc; }
  button:hover { filter: brightness(0.95); }
</style>
</head>
<body>
<h1>${escapeHtml(clientName)} wants to access ${escapeHtml(tenant.name)}</h1>
<p class="muted">The application is requesting permission to act on your behalf.</p>
${cimdBadge}
<p><strong>Requested scopes:</strong></p>
${scopeList}
<form method="POST" action="${escapeHtml(pendingConsentUrl(pending.id))}">
  <input type="hidden" name="req" value="${escapeHtml(pending.id)}">
  <button type="submit" name="decision" value="deny">Deny</button>
  <button type="submit" name="decision" value="approve" class="approve">Approve</button>
</form>
</body>
</html>`;
}

function pendingConsentUrl(id: string): string {
  // Relative to current host — the HTML template posts to the same /consent path.
  return `?req=${encodeURIComponent(id)}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
