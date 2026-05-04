/**
 * `roots/list` capability — `this.roots` synchronous getter and refresh wiring.
 *
 * Three contracts pinned:
 *
 *   1. Default (no MCP session): `this.roots` returns `[]`. Standalone CLI /
 *      unit-test paths must not throw.
 *   2. Loader threads `options.roots` through the ALS execution context, so
 *      `this.roots` resolves to whatever the runtime put there for *this*
 *      tool call. Cross-session isolation: another concurrent call sees
 *      *its* own roots, never a leak from a sibling call.
 *   3. The synchronous getter is on plain classes via loader injection, AND
 *      on classes that extend `Photon` via the base-class definition. Both
 *      paths read from the same ALS field.
 *
 * The full MCP wire path (server.listRoots() + RootsListChangedNotification
 * refresh) is tested implicitly: server.ts threads `rootsByServer.get(server)`
 * into executeTool's `roots` option; if that wiring breaks, contract #2
 * fails here.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhotonLoader } from '../dist/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('this.roots', () => {
  const FIXTURE = path.join(__dirname, 'fixtures', 'resources-parity.photon.ts');

  it('defaults to [] when no roots are threaded through', async () => {
    const loader = new PhotonLoader();
    const mcp = (await loader.loadFile(FIXTURE)) as any;
    // Direct getter read without any executeTool — no ALS context.
    // The runtime-installed getter falls back to `[]`.
    expect(Array.isArray(mcp.instance.roots)).toBe(true);
    expect(mcp.instance.roots).toEqual([]);
  });

  it('exposes the roots passed through executeTool options to the running method', async () => {
    const loader = new PhotonLoader();
    const mcp = (await loader.loadFile(FIXTURE)) as any;

    // Add a tool method that reports `this.roots` so we can assert end-to-end.
    mcp.instance.reportRoots = async function () {
      return JSON.stringify(this.roots);
    };
    // Register the tool so executeTool can find it.
    mcp.tools.push({
      name: 'reportRoots',
      description: 'Report current roots',
      inputSchema: { type: 'object', properties: {} },
    });

    const declaredRoots = [
      { uri: 'file:///workspace/a', name: 'a' },
      { uri: 'file:///workspace/b' },
    ];
    const result = await loader.executeTool(
      mcp,
      'reportRoots',
      {},
      {
        roots: declaredRoots,
      }
    );
    expect(JSON.parse(result)).toEqual(declaredRoots);
  });

  it('isolates roots between concurrent executeTool invocations', async () => {
    const loader = new PhotonLoader();
    const mcp = (await loader.loadFile(FIXTURE)) as any;

    mcp.instance.reportRoots = async function () {
      // Tiny delay to overlap with the sibling call.
      await new Promise((r) => setTimeout(r, 10));
      return JSON.stringify(this.roots);
    };
    mcp.tools.push({
      name: 'reportRoots',
      description: 'Report current roots',
      inputSchema: { type: 'object', properties: {} },
    });

    const rootsA = [{ uri: 'file:///A' }];
    const rootsB = [{ uri: 'file:///B' }];
    const [a, b] = await Promise.all([
      loader.executeTool(mcp, 'reportRoots', {}, { roots: rootsA }),
      loader.executeTool(mcp, 'reportRoots', {}, { roots: rootsB }),
    ]);

    // Each call sees its own roots, not the other's. ALS gives us this for
    // free; the test pins it so a future refactor that hoists state out
    // of ALS fails loudly.
    expect(JSON.parse(a)).toEqual(rootsA);
    expect(JSON.parse(b)).toEqual(rootsB);
  });
});
