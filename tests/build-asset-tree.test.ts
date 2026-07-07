import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { discoverAssetTree } from '../src/cli/commands/build.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-build-test-'));
  tmpDirs.push(dir);
  return dir;
}

describe('discoverAssetTree', () => {
  test('recursively gathers files from legacy assets folder and @ui template directories', () => {
    const workspace = makeTempWorkspace();
    const photonPath = join(workspace, 'my-calc.photon.ts');

    // 1. Create legacy/canonical assets tree
    const legacyAssetsDir = join(workspace, 'my-calc', 'assets');
    mkdirSync(legacyAssetsDir, { recursive: true });
    writeFileSync(join(legacyAssetsDir, 'logo.png'), 'png-bytes-here');

    const nestedDir = join(legacyAssetsDir, 'subfolder');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'info.txt'), 'nested-text');

    // 2. Create Vite UI dist assets tree
    const viteUiDir = join(workspace, 'ui', 'dist');
    mkdirSync(join(viteUiDir, 'assets'), { recursive: true });
    writeFileSync(join(viteUiDir, 'index.html'), '<html>Index</html>');
    writeFileSync(join(viteUiDir, 'assets', 'index.js'), 'console.log("react");');

    // 3. Define photon code with @ui annotation
    const photonCode = `
    /**
     * MyCalc Photon
     * @ui app ./ui/dist/index.html
     */
    export default class MyCalc {}
    `;
    writeFileSync(photonPath, photonCode);

    // Call discoverAssetTree
    const assets = discoverAssetTree(photonPath, photonCode);

    // Verify legacy assets are present
    expect(assets.has('logo.png')).toBe(true);
    expect(assets.get('logo.png')).toContain('cG5nLWJ5dGVzLWhlcmU='); // base64 of png-bytes-here

    expect(assets.has('subfolder/info.txt')).toBe(true);
    expect(assets.get('subfolder/info.txt')).toContain('nested-text');

    // Verify Vite UI dist assets are present
    expect(assets.has('ui/dist/index.html')).toBe(true);
    expect(assets.has('ui/dist/assets/index.js')).toBe(true);
    expect(assets.get('ui/dist/assets/index.js')).toContain('console.log("react");');
  });
});
