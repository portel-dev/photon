/**
 * The other half of the cf-deploy-codegen contract: it must work even when
 * `@portel/photon-core`'s `SchemaExtractor` does NOT return `httpRoutes`
 * on its metadata object — which is the case in every published version
 * up to and including 2.25.0.
 *
 * Why this is a separate file: vitest's `vi.mock` is hoisted to the top
 * of the module and replaces `@portel/photon-core` for the entire file.
 * The companion test (cf-deploy-codegen.test.ts) needs the real extractor
 * so it can verify that route handlers don't double up as MCP tools.
 *
 * What this guards against: a future change that reverts to reading
 * `metadata.httpRoutes` from photon-core, OR an upgrade to photon-core
 * that removes the field. Either way, deploy must still emit routes
 * because it source-extracts unconditionally.
 *
 * Failure mode this catches: the exact bug that shipped in 1.27.0 and
 * 1.28.0 — empty subclass `httpRoutes` array → 404 on every route.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('@portel/photon-core', async (importOriginal) => {
  // Keep the rest of photon-core (Photon base class, decorators, etc.)
  // intact — we're only neutering the SchemaExtractor's HTTP-route field.
  // This simulates exactly what the published 2.25.0 dist returns: tools
  // and templates populate normally, but `httpRoutes` is absent.
  const actual = (await importOriginal()) as Record<string, unknown>;
  class StaleSchemaExtractor {
    extractAllFromSource(source: string) {
      // Naive method-name extraction so the deploy still has tools to bundle.
      const methodNameRe = /async\s+(\w+)\s*\(/g;
      const tools: Array<{ name: string; description: string; inputSchema: object }> = [];
      let m: RegExpExecArray | null;
      while ((m = methodNameRe.exec(source)) !== null) {
        tools.push({
          name: m[1],
          description: `${m[1]} tool`,
          inputSchema: { type: 'object', properties: {} },
        });
      }
      // CRITICAL: no httpRoutes key. Mirrors photon-core ≤2.25.0.
      return { tools, templates: [], statics: [], settingsSchema: undefined, auth: undefined };
    }
  }
  return {
    ...actual,
    SchemaExtractor: StaleSchemaExtractor,
  };
});

const PROBE_SOURCE = `
export default class StalePhoton {
  /** @get / */
  async home() { return { ok: true }; }
  /** @get /:slug */
  async page(input: { slug: string }) { return { slug: input.slug }; }
  /** @post /api/book */
  async book() { return { ok: true }; }
}
`;

type Route = { method: string; path: string; handler: string };

function extractSubclassRoutes(workerCode: string, doClass: string): Route[] {
  const classMarker = `class ${doClass} extends BasePhotonDO`;
  const classIdx = workerCode.indexOf(classMarker);
  if (classIdx < 0) throw new Error(`Could not find ${classMarker}`);
  const tail = workerCode.slice(classIdx);
  const anchor = 'protected readonly httpRoutes: any[] = ';
  const literalIdx = tail.indexOf(anchor);
  if (literalIdx < 0) throw new Error(`No httpRoutes literal on ${doClass}`);
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
  if (end < 0) throw new Error('Unterminated httpRoutes literal');
  return JSON.parse(tail.slice(literalStart, end)) as Route[];
}

describe('cf deploy code-gen with stale photon-core (no httpRoutes field)', () => {
  let workerCode: string;

  beforeAll(async () => {
    // Import the deploy module AFTER the mock is in place.
    const { deployToCloudflare } = await import('../dist/deploy/cloudflare.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-cf-stale-'));
    const photonPath = path.join(dir, 'stale.photon.ts');
    await fsp.writeFile(photonPath, PROBE_SOURCE);
    await deployToCloudflare({
      photonPath,
      outputDir: path.join(dir, 'out'),
      dryRun: true,
    });
    workerCode = await fsp.readFile(path.join(dir, 'out', 'src', 'worker.ts'), 'utf-8');
  });

  it('emits populated httpRoutes even when photon-core does not return them', () => {
    // The bug: photon-core ≤2.25.0 returns metadata without `httpRoutes`,
    // so the old `(metadata as any).httpRoutes ?? []` collapsed to `[]`.
    // The fix sources routes from the photon source directly, so this
    // test must always see populated routes.
    const routes = extractSubclassRoutes(workerCode, 'StalePhotonDO');
    expect(routes).toEqual([
      { method: 'GET', path: '/', handler: 'home' },
      { method: 'GET', path: '/:slug', handler: 'page' },
      { method: 'POST', path: '/api/book', handler: 'book' },
    ]);
  });

  it('includes the multi-segment :param path', () => {
    const routes = extractSubclassRoutes(workerCode, 'StalePhotonDO');
    expect(routes.find((r) => r.path === '/:slug')).toBeDefined();
  });
});
