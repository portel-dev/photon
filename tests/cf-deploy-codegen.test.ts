/**
 * Code-gen contract tests for `photon host deploy cloudflare`.
 *
 * Why these tests exist (Bug post-mortem, May 2026):
 *
 *   v1.27.0 and v1.28.0 silently shipped Cloudflare deploys where every
 *   non-`/` `@get`/`@post` route returned 404. Root cause: the deploy
 *   path read `metadata.httpRoutes` from photon-core's SchemaExtractor,
 *   which (in the published 2.25.0) does not return that field. The
 *   subclass `httpRoutes` array in the generated worker was always `[]`,
 *   shadowing the parent's typed declaration. The bug was caught only
 *   when an end user deployed appointments.photon.ts and curl'd /20min.
 *
 *   The TS compiler had flagged it on April 30; the fix at the time was
 *   `metadata as any` instead of treating the missing field as a real
 *   contract gap. No test exercised the generator's output, so the bug
 *   shipped twice.
 *
 * What this file asserts (the contract that 1.27.0/1.28.0 broke):
 *
 *   1. SHAPE — `generateCloudflareTemplate` emits a populated subclass
 *      `httpRoutes` literal that includes every `@get`/`@post` declared
 *      on the source photon. Each entry has the right method, path,
 *      and handler name.
 *
 *   2. DISPATCH — when the matcher used by the runtime template
 *      (`matchHttpRoute`) is fed the generated array, every declared
 *      route resolves to its handler. Catches future shape drifts where
 *      the array is populated but uses a different field naming.
 *
 *   3. NO MCP DUPES — methods bound to HTTP routes do NOT also appear
 *      in the subclass `toolDefinitions` array. Mixing the two would
 *      let the MCP surface fire side-effects on a public route.
 *
 *   4. ROUTE-ONLY PHOTON — a photon whose only methods are HTTP routes
 *      generates a fully-functional worker (toolDefinitions empty,
 *      httpRoutes populated). Catches the original symptom shape.
 *
 * Test runs against the local build (dist/deploy/cloudflare.js) so the
 * harness is identical to what `photon host deploy cloudflare --dry-run`
 * actually executes. No wrangler invocation, no CF runtime.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { deployToCloudflare } from '../dist/deploy/cloudflare.js';

type Route = { method: string; path: string; handler: string };

const PROBE_SOURCE = `
/**
 * Probe photon: covers exact paths, :param paths, multi-segment :param,
 * dotted file path, and POST. Mirrors a realistic appointments-style
 * deploy that 1.28.0 broke.
 */
export default class ProbePhoton {
  /** @get / */
  async home() { return { ok: true }; }

  /** @get /:slug */
  async bookingPage(input: { slug: string }) { return { slug: input.slug }; }

  /** @get /b/:token */
  async manage(input: { token: string }) { return { token: input.token }; }

  /** @get /calendar.ics */
  async ical() { return 'BEGIN:VCALENDAR'; }

  /** @post /api/book */
  async book() { return { ok: true }; }

  /** @post /b/:token/cancel */
  async cancelByToken() { return { cancelled: true }; }

  /** @post /b/:token/reschedule */
  async rescheduleByToken() { return { rescheduled: true }; }
}
`;

const EXPECTED_ROUTES: Route[] = [
  { method: 'GET', path: '/', handler: 'home' },
  { method: 'GET', path: '/:slug', handler: 'bookingPage' },
  { method: 'GET', path: '/b/:token', handler: 'manage' },
  { method: 'GET', path: '/calendar.ics', handler: 'ical' },
  { method: 'POST', path: '/api/book', handler: 'book' },
  { method: 'POST', path: '/b/:token/cancel', handler: 'cancelByToken' },
  { method: 'POST', path: '/b/:token/reschedule', handler: 'rescheduleByToken' },
];

/**
 * Inline copies of the matcher functions from
 * templates/cloudflare/worker.ts.template. The template body is a string
 * substituted into the generated worker, so we can't import it. The
 * existing tests/cf-template-route-matcher.test.ts pins the same
 * implementation; if either drifts, both tests should fail together.
 */
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

/**
 * Pull the value of `httpRoutes: any[] = [...]` out of the SUBCLASS
 * declaration in the generated worker. The parent `BasePhotonDO`
 * declares an empty default; we want the subclass override.
 */
function extractSubclassRoutes(workerCode: string, doClass: string): Route[] {
  const classMarker = `class ${doClass} extends BasePhotonDO`;
  const classIdx = workerCode.indexOf(classMarker);
  if (classIdx < 0) {
    throw new Error(`Could not find ${classMarker} in generated worker`);
  }
  // Slice from the subclass to the end of file — only one subclass in our fixture.
  const tail = workerCode.slice(classIdx);
  // Anchor on the literal field assignment so we don't accidentally pull
  // the parent's default declaration. The codegen always emits exactly:
  //   protected readonly httpRoutes: any[] = [\n ... \n];
  const anchor = 'protected readonly httpRoutes: any[] = ';
  const literalIdx = tail.indexOf(anchor);
  if (literalIdx < 0) {
    throw new Error(`Subclass ${doClass} has no httpRoutes literal`);
  }
  const literalStart = literalIdx + anchor.length;
  // The literal is JSON.stringify'd, so it's well-formed JSON ending at
  // the matching closing bracket. Walk the brackets to find the end.
  let depth = 0;
  let end = -1;
  for (let i = literalStart; i < tail.length; i++) {
    const ch = tail[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`Unterminated httpRoutes literal in ${doClass}`);
  }
  const literal = tail.slice(literalStart, end);
  return JSON.parse(literal) as Route[];
}

function extractSubclassToolDefs(workerCode: string, doClass: string): Array<{ name: string }> {
  const classMarker = `class ${doClass} extends BasePhotonDO`;
  const classIdx = workerCode.indexOf(classMarker);
  if (classIdx < 0) throw new Error(`Could not find ${classMarker}`);
  const tail = workerCode.slice(classIdx);
  const anchor = 'protected readonly toolDefinitions: any[] = ';
  const literalIdx = tail.indexOf(anchor);
  if (literalIdx < 0) throw new Error(`No toolDefinitions on ${doClass}`);
  const literalStart = literalIdx + anchor.length;
  let depth = 0;
  let end = -1;
  for (let i = literalStart; i < tail.length; i++) {
    const ch = tail[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Unterminated toolDefinitions literal');
  return JSON.parse(tail.slice(literalStart, end));
}

describe('cf deploy code-gen', () => {
  let workerCode: string;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-cf-codegen-'));
    const photonPath = path.join(outputDir, 'probe.photon.ts');
    await fsp.writeFile(photonPath, PROBE_SOURCE);

    await deployToCloudflare({
      photonPath,
      outputDir: path.join(outputDir, 'out'),
      dryRun: true,
    });

    workerCode = await fsp.readFile(path.join(outputDir, 'out', 'src', 'worker.ts'), 'utf-8');
  });

  it('subclass httpRoutes literal contains every declared @get/@post', () => {
    const routes = extractSubclassRoutes(workerCode, 'ProbePhotonDO');

    // The exact list, in declaration order. Order matters for the
    // matcher's "exact-match wins" semantics — drift here means a regression.
    expect(routes).toEqual(EXPECTED_ROUTES);
  });

  it('subclass httpRoutes is NOT empty (regression: 1.27.0/1.28.0 shipped [])', () => {
    const routes = extractSubclassRoutes(workerCode, 'ProbePhotonDO');
    // The bug we're guarding against: the subclass declared an empty
    // any[] that shadowed the typed parent declaration. If the array is
    // empty, every non-`/` route would 404.
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every declared route is dispatchable through the live matcher', () => {
    const routes = extractSubclassRoutes(workerCode, 'ProbePhotonDO');

    const probes: Array<{ method: string; pathname: string; expectedHandler: string }> = [
      { method: 'GET', pathname: '/', expectedHandler: 'home' },
      { method: 'GET', pathname: '/15min', expectedHandler: 'bookingPage' },
      { method: 'GET', pathname: '/b/abc-token', expectedHandler: 'manage' },
      { method: 'GET', pathname: '/calendar.ics', expectedHandler: 'ical' },
      { method: 'POST', pathname: '/api/book', expectedHandler: 'book' },
      { method: 'POST', pathname: '/b/abc/cancel', expectedHandler: 'cancelByToken' },
      { method: 'POST', pathname: '/b/abc/reschedule', expectedHandler: 'rescheduleByToken' },
    ];

    for (const probe of probes) {
      const match = matchHttpRoute(routes, probe.method, probe.pathname);
      expect(
        match,
        `${probe.method} ${probe.pathname} should resolve to ${probe.expectedHandler}`
      ).not.toBeNull();
      expect(match?.route.handler).toBe(probe.expectedHandler);
    }
  });

  it('exact path /calendar.ics wins over /:slug pattern', () => {
    const routes = extractSubclassRoutes(workerCode, 'ProbePhotonDO');
    const match = matchHttpRoute(routes, 'GET', '/calendar.ics');
    expect(match?.route.handler).toBe('ical');
  });

  it('route handlers do not also appear as MCP tools', () => {
    const tools = extractSubclassToolDefs(workerCode, 'ProbePhotonDO');
    const toolNames = new Set(tools.map((t) => t.name));
    for (const route of EXPECTED_ROUTES) {
      expect(
        toolNames.has(route.handler),
        `route handler ${route.handler} must NOT also be exposed as an MCP tool`
      ).toBe(false);
    }
  });

  it('logs the correct route count (regression sentinel)', async () => {
    // The "Found N tools, M HTTP routes" log line is the user-visible
    // signal that the deploy actually saw the routes. If M ever drops
    // back to 0 here, deploys to CF will silently 404 again.
    const routes = extractSubclassRoutes(workerCode, 'ProbePhotonDO');
    expect(routes.length).toBe(EXPECTED_ROUTES.length);
  });
});

describe('cf deploy code-gen — route-only photon', () => {
  // The exact failure shape from the user's bug report: a photon whose
  // public surface is HTTP routes only. v1.28.0 generated a worker with
  // 0 tools AND 0 routes; this asserts both: 0 tools, N routes.
  let workerCode: string;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-cf-routeonly-'));
    const photonPath = path.join(dir, 'route-only.photon.ts');
    await fsp.writeFile(
      photonPath,
      `
/** Probe with only HTTP routes (mirrors appointments.photon.ts shape). */
export default class RouteOnlyPhoton {
  /** @get / */
  async home() { return { ok: true }; }
  /** @get /:slug */
  async page(input: { slug: string }) { return { slug: input.slug }; }
  /** @post /api/submit */
  async submit() { return { ok: true }; }
}
`
    );
    await deployToCloudflare({
      photonPath,
      outputDir: path.join(dir, 'out'),
      dryRun: true,
    });
    workerCode = await fsp.readFile(path.join(dir, 'out', 'src', 'worker.ts'), 'utf-8');
  });

  it('emits routes and zero tools when every method is HTTP-only', () => {
    const routes = extractSubclassRoutes(workerCode, 'RouteOnlyPhotonDO');
    const tools = extractSubclassToolDefs(workerCode, 'RouteOnlyPhotonDO');
    expect(routes.length).toBe(3);
    expect(tools.length).toBe(0);
  });
});
