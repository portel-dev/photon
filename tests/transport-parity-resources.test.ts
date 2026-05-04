/**
 * Transport-parity test for resources/prompts surfaces.
 *
 * Both transports must expose the same set of method-level @resource /
 * @Static URIs and the same @prompt / @Template names. STDIO surfaces
 * them via ResourceServer (src/resource-server.ts); streamable-HTTP
 * surfaces them inline in src/auto-ui/streamable-http-transport.ts.
 *
 * This test loads one fixture photon and:
 *   1. asks ResourceServer.handleListResources for the STDIO list;
 *   2. asks ResourceServer.handleListResourceTemplates for STDIO templates;
 *   3. mirrors the streamable-HTTP iteration against the same loaded mcp;
 *   4. asserts both transports surface the same URIs and template URIs.
 *
 * If the SSE handlers in streamable-http-transport.ts drift, the mirrored
 * iteration here will too (it lives next to the assertion), so update
 * both sides together — the assertion fails loudly the moment they diverge.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhotonLoader } from '../dist/loader.js';
import {
  ResourceServer,
  isUriTemplate,
  matchUriTemplate,
  parseUriTemplateParams,
} from '../dist/resource-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'resources-parity.photon.ts');

describe('transport parity: resources/prompts surfaces', () => {
  let mcp: any;

  beforeAll(async () => {
    const loader = new PhotonLoader();
    mcp = await loader.loadFile(FIXTURE);
  });

  it('STDIO and streamable-HTTP surface the same non-templated resources', () => {
    const rs = new ResourceServer(
      {
        executeTool: async () => null,
        getLoadedPhotons: () => new Map([[mcp.name, mcp]]),
      },
      { filePath: FIXTURE }
    );

    const stdioList = rs.handleListResources(mcp).resources;
    const stdioStaticUris = stdioList
      .map((r: any) => r.uri)
      .filter((u: string) => !isUriTemplate(u));

    // Mirror the streamable-HTTP iteration over a single photon.
    const sseStaticUris: string[] = [];
    if (mcp.statics) {
      for (const stat of mcp.statics) {
        if (isUriTemplate(stat.uri)) continue;
        sseStaticUris.push(stat.uri);
      }
    }
    if (mcp.assets?.prompts) {
      for (const p of mcp.assets.prompts) {
        sseStaticUris.push(`photon://${mcp.name}/prompts/${p.id}`);
      }
    }
    if (mcp.assets?.resources) {
      for (const r of mcp.assets.resources) {
        sseStaticUris.push(`photon://${mcp.name}/resources/${r.id}`);
      }
    }
    if (mcp.assets?.ui) {
      for (const u of mcp.assets.ui) {
        sseStaticUris.push(u.uri || `ui://${mcp.name}/${u.id}`);
      }
    }

    // Order doesn't matter; equality of the sets does.
    expect(new Set(sseStaticUris)).toEqual(new Set(stdioStaticUris));
  });

  it('STDIO and streamable-HTTP surface the same templated resources', () => {
    const rs = new ResourceServer(
      {
        executeTool: async () => null,
        getLoadedPhotons: () => new Map([[mcp.name, mcp]]),
      },
      { filePath: FIXTURE }
    );

    const stdioTemplates = rs
      .handleListResourceTemplates(mcp)
      .resourceTemplates.map((t: any) => t.uriTemplate);

    const sseTemplates = (mcp.statics || [])
      .filter((s: any) => isUriTemplate(s.uri))
      .map((s: any) => s.uri);

    expect(new Set(sseTemplates)).toEqual(new Set(stdioTemplates));
  });

  it('legacy @Static surfaces alongside canonical @resource', () => {
    const uris: string[] = (mcp.statics || []).map((s: any) => s.uri);
    expect(uris).toContain('api://docs'); // canonical @resource
    expect(uris).toContain('person://{slug}'); // canonical @resource template
    expect(uris).toContain('legacy://thing'); // legacy @Static back-compat
  });

  it('legacy @Template surfaces alongside canonical @prompt', () => {
    const names: string[] = (mcp.templates || []).map((t: any) => t.name);
    expect(names).toContain('codeReview'); // canonical @prompt
    expect(names).toContain('legacyPrompt'); // legacy @Template back-compat
  });

  it('URI template helpers parse params correctly', () => {
    expect(isUriTemplate('person://{slug}')).toBe(true);
    expect(isUriTemplate('api://docs')).toBe(false);
    expect(matchUriTemplate('person://{slug}', 'person://alice')).toBe(true);
    expect(matchUriTemplate('person://{slug}', 'api://docs')).toBe(false);
    expect(parseUriTemplateParams('person://{slug}', 'person://alice')).toEqual({
      slug: 'alice',
    });
  });
});
