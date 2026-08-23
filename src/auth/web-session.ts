/**
 * Browser-session primitives shared by Photon web surfaces.
 *
 * The browser receives only an opaque, random cookie. The authoritative
 * identity and role stay server-side in the deployment's durable store.
 */

export interface PhotonWebSession {
  id: string;
  sub: string;
  role: string;
  name?: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export const PHOTON_WEB_SESSION_COOKIE = '__photon_session';
export const PHOTON_WEB_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      // Ignore a malformed cookie value rather than exposing a partial token.
    }
  }
  return cookies;
}

export function buildSessionCookie(
  token: string,
  maxAgeSeconds = PHOTON_WEB_SESSION_TTL_SECONDS
): string {
  return `${PHOTON_WEB_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; Secure; SameSite=Lax`;
}

export function buildExpiredSessionCookie(): string {
  return `${PHOTON_WEB_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function isSafeReturnPath(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, 'https://photon.invalid');
    return (
      url.origin === 'https://photon.invalid' &&
      url.pathname.startsWith('/') &&
      !url.pathname.startsWith('//')
    );
  } catch {
    return false;
  }
}
