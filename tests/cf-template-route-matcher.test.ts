/**
 * Unit tests for the `:param` path matcher used by the Cloudflare worker
 * template's `@get`/`@post` route dispatcher.
 *
 * The function under test lives inline in
 * `templates/cloudflare/worker.ts.template` (see `matchHttpRoute` /
 * `matchPathPattern`). It can't be imported here because the template is
 * rendered into the generated Worker bundle, not loaded as a module.
 * Keep the two definitions in sync; the template comment points back here.
 */
import { describe, expect, it } from 'vitest';

type Route = { method: string; path: string; handler: string };

function matchHttpRoute(
  routes: Route[],
  method: string,
  pathname: string
): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (!route.path.includes(':') && route.path === pathname) {
      return { route, params: {} };
    }
  }
  for (const route of routes) {
    if (route.method !== method) continue;
    if (!route.path.includes(':')) continue;
    const params = matchPathPattern(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

function matchPathPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const rp = pathParts[i];
    if (pp.startsWith(':')) {
      try {
        params[pp.slice(1)] = decodeURIComponent(rp);
      } catch {
        return null;
      }
    } else if (pp !== rp) {
      return null;
    }
  }
  return params;
}

const ICAL: Route = { method: 'GET', path: '/calendar.ics', handler: 'ical' };
const SLUG: Route = { method: 'GET', path: '/:slug', handler: 'bookingPage' };
const TOKEN: Route = { method: 'GET', path: '/b/:token', handler: 'manage' };
const BOOK: Route = { method: 'POST', path: '/api/book', handler: 'book' };

describe('matchHttpRoute', () => {
  const routes = [ICAL, SLUG, TOKEN, BOOK];

  it('matches an exact static path', () => {
    expect(matchHttpRoute(routes, 'GET', '/calendar.ics')).toEqual({
      route: ICAL,
      params: {},
    });
  });

  it('matches a single-segment :param', () => {
    expect(matchHttpRoute(routes, 'GET', '/15min')).toEqual({
      route: SLUG,
      params: { slug: '15min' },
    });
  });

  it('matches a nested :param', () => {
    expect(matchHttpRoute(routes, 'GET', '/b/abc123')).toEqual({
      route: TOKEN,
      params: { token: 'abc123' },
    });
  });

  it('prefers an exact static match over a :param pattern', () => {
    // /:slug would match /calendar.ics, but the static route wins because
    // exact matches are tested in the first pass.
    const match = matchHttpRoute(routes, 'GET', '/calendar.ics');
    expect(match?.route.handler).toBe('ical');
  });

  it('returns null when the method does not match', () => {
    expect(matchHttpRoute(routes, 'POST', '/calendar.ics')).toBeNull();
    expect(matchHttpRoute(routes, 'POST', '/15min')).toBeNull();
  });

  it('returns null when no route matches', () => {
    expect(matchHttpRoute(routes, 'GET', '/nope/extra/segments')).toBeNull();
  });

  it('respects segment count, partial prefix is not a match', () => {
    // /b/:token should NOT match /b/abc/extra.
    expect(matchHttpRoute(routes, 'GET', '/b/abc/extra')).toBeNull();
  });

  it('decodes percent-encoded path segments', () => {
    const match = matchHttpRoute(routes, 'GET', '/b/foo%40bar');
    expect(match?.params.token).toBe('foo@bar');
  });

  it('matches POST routes independently of GET routes', () => {
    expect(matchHttpRoute(routes, 'POST', '/api/book')).toEqual({
      route: BOOK,
      params: {},
    });
  });
});
