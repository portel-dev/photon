import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { strict as assert } from 'assert';

const dir = mkdtempSync(join(tmpdir(), 'photon-catalog-'));

try {
  mkdirSync(join(dir, '.marketplace'), { recursive: true });
  writeFileSync(
    join(dir, 'README.md'),
    '<!-- PHOTON_MARKETPLACE_START -->\n<!-- PHOTON_MARKETPLACE_END -->\n'
  );
  writeFileSync(
    join(dir, 'kept.photon.ts'),
    `/**
 * Kept - Useful app
 *
 * @version 1.0.0
 * @tags useful, app
 */
export default class Kept {
  /** Run the tool */
  async run(params: { name: string }) {
    return \`Hello \${params.name}\`;
  }
}
`
  );
  writeFileSync(
    join(dir, 'hidden.photon.ts'),
    `/**
 * Hidden - Demo-only photon
 */
export default class Hidden {
  async run() {
    return 'hidden';
  }
}
`
  );
  writeFileSync(join(dir, 'hidden.md'), '# stale hidden doc\n');
  writeFileSync(
    join(dir, '.marketplace', 'catalog.json'),
    JSON.stringify(
      {
        kind: 'apps',
        title: 'Curated Apps',
        description: 'A curated marketplace.',
        quickStart: { photon: 'kept' },
        removeExcludedDocs: true,
        sections: [{ title: 'Ready', photons: ['kept'] }],
        overrides: {
          kept: {
            label: 'Kept App',
            summary: 'A polished app summary.',
            category: 'Apps',
            tags: ['curated', 'app'],
          },
        },
      },
      null,
      2
    )
  );

  execFileSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'cli.js'), 'maker', 'sync', '--dir', dir],
    {
      cwd: process.cwd(),
      stdio: 'pipe',
    }
  );

  const manifest = JSON.parse(readFileSync(join(dir, '.marketplace', 'photons.json'), 'utf-8'));
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(
    manifest.photons.map((p: any) => p.name),
    ['kept']
  );
  assert.equal(manifest.photons[0].label, 'Kept App');
  assert.equal(manifest.photons[0].summary, 'A polished app summary.');
  assert.deepEqual(manifest.photons[0].tags, ['curated', 'app']);

  const readme = readFileSync(join(dir, 'README.md'), 'utf-8');
  assert.match(readme, /# Curated Apps/);
  assert.match(readme, /\*\*Kept App\*\*/);
  assert.match(readme, /A polished app summary\./);
  assert.doesNotMatch(readme, /Hidden/);

  try {
    readFileSync(join(dir, 'hidden.md'), 'utf-8');
    assert.fail('Expected hidden generated doc to be removed');
  } catch {
    // Expected.
  }

  console.log('✓ Marketplace catalog curation');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
