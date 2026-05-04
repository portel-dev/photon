/**
 * `<photon>/assets/` companion-folder discovery
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track E.
 *
 * Asserts the dual-layout contract:
 *   - New: <photon>/<name>/assets/{ui,prompts,resources}/...
 *   - Old: <photon>/<name>/{ui,prompts,resources}/...           (kept working)
 *
 * The discoverer prefers the nested assets/ root when present; otherwise it
 * falls through to the legacy root. Both layouts auto-pick prompts/resources
 * and resolve declared @ui paths.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAssets } from '@portel/photon-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

describe('assets/ companion folder', () => {
  it('discovers under <photon>/assets/ when the nested root exists', async () => {
    const photonPath = path.join(FIXTURES, 'asset-bundle.photon.ts');
    const source = await fs.readFile(photonPath, 'utf-8');

    const assets = await discoverAssets(photonPath, source);

    expect(assets, 'fixture should produce a PhotonAssets').toBeDefined();
    expect(assets!.ui.find((u) => u.id === 'form')?.resolvedPath).toBe(
      path.join(FIXTURES, 'asset-bundle', 'assets', 'ui', 'form.html')
    );
    expect(assets!.ui.find((u) => u.id === 'dashboard')?.resolvedPath).toBe(
      path.join(FIXTURES, 'asset-bundle', 'assets', 'dashboard', 'dist', 'index.html')
    );

    // Auto-discovered prompts/resources from <photon>/assets/{prompts,resources}/
    expect(assets!.prompts.map((p) => p.id).sort()).toContain('system');
    expect(assets!.resources.map((r) => r.id).sort()).toContain('config');
    const config = assets!.resources.find((r) => r.id === 'config');
    expect(config?.resolvedPath).toBe(
      path.join(FIXTURES, 'asset-bundle', 'assets', 'resources', 'config.json')
    );
  });

  it('falls back to the legacy <photon>/<name>/ root when assets/ is absent', async () => {
    const photonPath = path.join(FIXTURES, 'v128-compat.photon.ts');
    const source = await fs.readFile(photonPath, 'utf-8');

    const assets = await discoverAssets(photonPath, source);

    expect(assets, 'legacy fixture should still resolve').toBeDefined();
    const form = assets!.ui.find((u) => u.id === 'form');
    expect(form?.resolvedPath).toBe(path.join(FIXTURES, 'v128-compat', 'ui', 'form.html'));
    // No assets/ wrapper exists for this fixture; resolved path must NOT
    // contain /assets/.
    expect(form?.resolvedPath?.includes(`${path.sep}assets${path.sep}`)).toBe(false);
  });
});
