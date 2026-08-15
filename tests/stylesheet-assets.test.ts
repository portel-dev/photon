import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolvePhotonStylesheetAssets } from '../src/auto-ui/stylesheet-assets.js';

const temporaryDirectories: string[] = [];

async function createPhoton(layout: 'assets' | 'legacy' | 'none' = 'assets') {
  const directory = await mkdtemp(join(tmpdir(), 'photon-stylesheets-'));
  temporaryDirectories.push(directory);

  const photonPath = join(directory, 'sample.photon.ts');
  await writeFile(photonPath, 'export default class Sample {}\n');

  if (layout === 'none') return { directory, photonPath };

  const companion = join(directory, 'sample');
  const root = layout === 'assets' ? join(companion, 'assets') : companion;
  await mkdir(root, { recursive: true });
  return { directory, photonPath, companion, root };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Photon stylesheet companion assets', () => {
  it('resolves canonical Photon, OAuth, and format stylesheets', async () => {
    const { photonPath, root } = await createPhoton();
    await writeFile(join(root!, 'photon.css'), ':root { --brand: blue; }');
    await writeFile(join(root!, 'oauth.css'), '.oauth { color: blue; }');
    await mkdir(join(root!, 'formats'), { recursive: true });
    await writeFile(join(root!, 'formats', 'cards.css'), '.card { color: blue; }');

    const assets = await resolvePhotonStylesheetAssets(
      photonPath,
      'export default class Sample {}'
    );

    expect(assets.assetRoot).toBe(root);
    expect(assets.photon?.relativePath).toBe('sample/assets/photon.css');
    expect(assets.oauth?.relativePath).toBe('sample/assets/oauth.css');
    expect(assets.formats.cards?.relativePath).toBe('sample/assets/formats/cards.css');
    expect(assets.formats.cards?.mimeType).toBe('text/css');
    await expect(readFile(assets.formats.cards!.resolvedPath, 'utf8')).resolves.toContain('.card');
  });

  it('retains the existing legacy companion-root fallback', async () => {
    const { photonPath, root } = await createPhoton('legacy');
    await writeFile(join(root!, 'photon.css'), 'body { color: black; }');
    await mkdir(join(root!, 'formats'), { recursive: true });
    await writeFile(join(root!, 'formats', 'table.css'), 'table { border: 0; }');

    const assets = await resolvePhotonStylesheetAssets(
      photonPath,
      'export default class Sample {}'
    );

    expect(assets.assetRoot).toBe(root);
    expect(assets.photon?.relativePath).toBe('sample/photon.css');
    expect(assets.formats.table?.relativePath).toBe('sample/formats/table.css');
  });

  it('can limit format resolution without changing the companion convention', async () => {
    const { photonPath, root } = await createPhoton();
    await mkdir(join(root!, 'formats'), { recursive: true });
    await writeFile(join(root!, 'formats', 'cards.css'), '.card {}');
    await writeFile(join(root!, 'formats', 'table.css'), 'table {}');

    const assets = await resolvePhotonStylesheetAssets(
      photonPath,
      'export default class Sample {}',
      {
        formats: ['cards', 'missing', 'cards'],
      }
    );

    expect(Object.keys(assets.formats)).toEqual(['cards']);
  });

  it('discovers all safe format stylesheets when no filter is supplied', async () => {
    const { photonPath, root } = await createPhoton();
    await mkdir(join(root!, 'formats'), { recursive: true });
    await writeFile(join(root!, 'formats', 'cards.css'), '.card {}');
    await writeFile(join(root!, 'formats', 'date-range.css'), '.date {}');
    await writeFile(join(root!, 'formats', '../unsafe.css'), '.unsafe {}');
    await writeFile(join(root!, 'formats', 'ignored.txt'), 'not css');

    const assets = await resolvePhotonStylesheetAssets(
      photonPath,
      'export default class Sample {}'
    );

    expect(Object.keys(assets.formats).sort()).toEqual(['cards', 'date-range']);
  });

  it('ignores traversal and unsafe format names', async () => {
    const { photonPath, root, directory } = await createPhoton();
    await mkdir(join(root!, 'formats'), { recursive: true });
    await writeFile(join(root!, 'formats', 'cards.css'), '.card {}');
    await writeFile(join(directory, 'escape.css'), '.escape {}');

    const assets = await resolvePhotonStylesheetAssets(
      photonPath,
      'export default class Sample {}',
      {
        formats: [
          '../escape',
          '../../escape',
          'formats/cards',
          'cards/../escape',
          '/absolute',
          'cards',
        ],
      }
    );

    expect(Object.keys(assets.formats)).toEqual(['cards']);
    expect(assets.formats['../escape']).toBeUndefined();
    expect(assets.formats.escape).toBeUndefined();
  });

  it('fails safely when the companion folder or stylesheet files are absent', async () => {
    const missingCompanion = await createPhoton('none');
    await expect(
      resolvePhotonStylesheetAssets(missingCompanion.photonPath, 'export default class Sample {}')
    ).resolves.toEqual({ formats: {} });

    const emptyCompanion = await createPhoton();
    await expect(
      resolvePhotonStylesheetAssets(emptyCompanion.photonPath, 'export default class Sample {}')
    ).resolves.toMatchObject({ assetRoot: emptyCompanion.root, formats: {} });
  });
});
