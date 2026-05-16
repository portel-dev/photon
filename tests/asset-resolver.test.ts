import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { AssetResolver } from '../src/asset-resolver.js';

const tmpDirs: string[] = [];

function makePhoton(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-assets-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'ui'), { recursive: true });
  writeFileSync(join(dir, 'ui', 'app.tsx'), 'render(<main>ok</main>, document.body);');
  const photonPath = join(dir, 'sample.photon.ts');
  writeFileSync(photonPath, source);
  return photonPath;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('AssetResolver', () => {
  test('resolves root-relative UI paths next to the photon file', async () => {
    const source = `
      /**
       * @ui app ./ui/app.tsx
       */
      export default class Sample {}
    `;
    const photonPath = makePhoton(source);
    const assets = await new AssetResolver(() => {}).discover(photonPath, source);

    expect(assets?.ui[0]?.resolvedPath).toBe(join(photonPath, '..', 'ui', 'app.tsx'));
  });

  test('resolves pathless class-level UI declarations by convention', async () => {
    const source = `
      /**
       * @ui app
       */
      export default class Sample {}
    `;
    const photonPath = makePhoton(source);
    const assets = await new AssetResolver(() => {}).discover(photonPath, source);

    expect(assets?.ui[0]?.id).toBe('app');
    expect(assets?.ui[0]?.path).toBe('./ui/app.tsx');
    expect(assets?.ui[0]?.resolvedPath).toBe(join(photonPath, '..', 'ui', 'app.tsx'));
  });

  test('pathless UI prefers TSX app shell over HTML template with the same id', async () => {
    const source = `
      /**
       * @ui app
       */
      export default class Sample {}
    `;
    const photonPath = makePhoton(source);
    writeFileSync(join(photonPath, '..', 'ui', 'app.html'), '<main>html</main>');
    const assets = await new AssetResolver(() => {}).discover(photonPath, source);

    expect(assets?.ui.find((ui) => ui.id === 'app')?.resolvedPath).toBe(
      join(photonPath, '..', 'ui', 'app.tsx')
    );
  });

  test('does not link class-level UI declarations to export', async () => {
    const source = `
      /**
       * @ui app ./ui/app.tsx
       */
      export default class Sample {
        /**
         * @ui app
         */
        client_ui() {}
      }
    `;
    const photonPath = makePhoton(source);
    const assets = await new AssetResolver(() => {}).discover(photonPath, source);

    expect(assets?.ui[0]?.linkedTool).toBe('client_ui');
    expect(assets?.ui[0]?.linkedTools).toEqual(['client_ui']);
  });
});
