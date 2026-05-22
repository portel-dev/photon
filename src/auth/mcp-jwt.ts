import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  type JsonWebKey,
} from 'node:crypto';

export interface PhotonAuthIssuer {
  issuer: string;
  algorithm: 'ES256';
  kid: string;
  defaultTtlSeconds: number;
}

export interface PhotonAuthTokenOptions {
  agent: string;
  audience: string;
  tenant?: string;
  scopes?: string[];
  ttlSeconds?: number;
  now?: Date;
  jti?: string;
}

export interface PhotonAuthVerifyOptions {
  issuer: string;
  audience: string;
  jwks: { keys: JsonWebKey[] };
  now?: Date;
  clockSkewSeconds?: number;
  requiredScopes?: string[];
}

export type PhotonJwtVerifyReason =
  | 'missing_token'
  | 'malformed_token'
  | 'unsupported_alg'
  | 'unknown_kid'
  | 'bad_signature'
  | 'expired_token'
  | 'token_not_yet_valid'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'insufficient_scope'
  | 'tenant_mismatch';

export interface PhotonJwtClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  tenant_id: string;
  client_id: string;
  scope?: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
}

export type PhotonJwtVerifyResult =
  | { ok: true; claims: PhotonJwtClaims }
  | { ok: false; reason: PhotonJwtVerifyReason };

export function createPhotonAuthKeypair(
  name: string,
  now = new Date()
): {
  issuer: PhotonAuthIssuer;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  jwks: { keys: JsonWebKey[] };
} {
  const date = now.toISOString().slice(0, 10);
  const kid = `${name}-${date}`;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  for (const jwk of [privateJwk, publicJwk]) {
    jwk.alg = 'ES256';
    jwk.kid = kid;
    jwk.use = 'sig';
  }
  return {
    issuer: {
      issuer: `photon-local:${name}`,
      algorithm: 'ES256',
      kid,
      defaultTtlSeconds: 15 * 60,
    },
    privateJwk,
    publicJwk,
    jwks: { keys: [publicJwk] },
  };
}

export function signPhotonAuthToken(
  issuer: PhotonAuthIssuer,
  privateJwk: JsonWebKey,
  options: PhotonAuthTokenOptions
): string {
  const nowSec = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? issuer.defaultTtlSeconds;
  const scopes = normalizeScopes(options.scopes ?? []);
  const payload: PhotonJwtClaims = {
    iss: issuer.issuer,
    sub: `agent:${options.agent}`,
    aud: options.audience,
    tenant_id: options.tenant ?? 'default',
    client_id: options.agent,
    ...(scopes.length > 0 ? { scope: scopes.join(' ') } : {}),
    iat: nowSec,
    nbf: nowSec,
    exp: nowSec + ttl,
    jti: options.jti ?? `tok_${randomBytes(16).toString('base64url')}`,
  };
  return signJwt(payload, privateJwk, issuer.kid);
}

export function verifyPhotonAuthToken(
  token: string | null | undefined,
  options: PhotonAuthVerifyOptions
): PhotonJwtVerifyResult {
  if (!token) return { ok: false, reason: 'missing_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' };
  let header: Record<string, unknown>;
  let claims: PhotonJwtClaims;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
    claims = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (header.alg !== 'ES256') return { ok: false, reason: 'unsupported_alg' };
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const jwk = options.jwks.keys.find((key) => key.kid === kid);
  if (!kid || !jwk) return { ok: false, reason: 'unknown_kid' };
  if (!verifyJwtSignature(parts, jwk)) return { ok: false, reason: 'bad_signature' };
  if (claims.iss !== options.issuer) return { ok: false, reason: 'wrong_issuer' };
  const audMatches = Array.isArray(claims.aud)
    ? claims.aud.includes(options.audience)
    : claims.aud === options.audience;
  if (!audMatches) return { ok: false, reason: 'wrong_audience' };

  const now = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (typeof claims.exp !== 'number' || claims.exp < now - skew) {
    return { ok: false, reason: 'expired_token' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf > now + skew) {
    return { ok: false, reason: 'token_not_yet_valid' };
  }
  if (typeof claims.iat === 'number' && claims.iat > now + skew) {
    return { ok: false, reason: 'token_not_yet_valid' };
  }

  const required = normalizeScopes(options.requiredScopes ?? []);
  if (required.length > 0) {
    const granted = new Set(normalizeScopes((claims.scope ?? '').split(/\s+/)));
    for (const scope of required) {
      if (!granted.has(scope)) return { ok: false, reason: 'insufficient_scope' };
    }
  }

  return { ok: true, claims };
}

export function normalizeScopes(scopes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of scopes) {
    for (const scope of raw.split(/\s+/)) {
      const trimmed = scope.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function signJwt(payload: Record<string, unknown>, privateJwk: JsonWebKey, kid: string): string {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const input = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signer = createSign('sha256');
  signer.update(input);
  signer.end();
  const der = signer.sign(key);
  return `${input}.${derToP1363(der, 32).toString('base64url')}`;
}

function verifyJwtSignature(parts: string[], publicJwk: JsonWebKey): boolean {
  try {
    const key = createPublicKey({ key: publicJwk, format: 'jwk' });
    const verifier = createVerify('sha256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    return verifier.verify(key, p1363ToDer(Buffer.from(parts[2], 'base64url')));
  } catch {
    return false;
  }
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

function derToP1363(der: Buffer, componentLen: number): Buffer {
  if (der[0] !== 0x30) throw new Error('invalid DER signature');
  let offset = 2;
  if ((der[1] & 0x80) !== 0) offset += der[1] & 0x7f;
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error('invalid DER signature');
    const len = der[offset + 1];
    const start = offset + 2;
    let value = der.subarray(start, start + len);
    offset = start + len;
    while (value.length > 1 && value[0] === 0x00) value = value.subarray(1);
    if (value.length > componentLen) throw new Error('ECDSA component overflow');
    return value;
  };
  const r = readInt();
  const s = readInt();
  const out = Buffer.alloc(componentLen * 2);
  r.copy(out, componentLen - r.length);
  s.copy(out, componentLen * 2 - s.length);
  return out;
}

function p1363ToDer(p1363: Buffer): Buffer {
  if (p1363.length % 2 !== 0) throw new Error('invalid P1363 signature');
  const half = p1363.length / 2;
  const encodeInt = (value: Buffer): Buffer => {
    let v = value;
    while (v.length > 1 && v[0] === 0x00) v = v.subarray(1);
    if ((v[0] & 0x80) !== 0) v = Buffer.concat([Buffer.from([0x00]), v]);
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const body = Buffer.concat([encodeInt(p1363.subarray(0, half)), encodeInt(p1363.subarray(half))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}
