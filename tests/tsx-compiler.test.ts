import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { compileTsx } from '../src/tsx-compiler.js';

const tmpDirs: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-tsx-'));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('compileTsx', () => {
  test('keeps Photon JSX runtime when tsconfig does not override JSX', async () => {
    const dir = makeFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          moduleResolution: 'Bundler',
        },
      }),
      'app.tsx': `
        const root = document.getElementById('root')!;
        render(<main><h1>Photon UI</h1></main>, root);
      `,
    });

    const compiled = await compileTsx(join(dir, 'app.tsx'));

    // The bundle now lives in a content-hashed sidecar, not inlined.
    expect(compiled.js).toContain('function render(');
    expect(compiled.js).toContain('function h(');
    expect(compiled.js).not.toContain('React.createElement');
    expect(compiled.html).not.toContain('TSX Build Error');
    // Cache-busting contract: a hash, and a shell that references it.
    expect(compiled.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(compiled.jsFileName).toBe(`app.${compiled.hash}.js`);
    expect(compiled.html).toContain(`src="./${compiled.jsFileName}"`);
    expect(compiled.html).not.toContain('function render(');
  });

  test('hash changes when an imported module changes', async () => {
    const mk = () =>
      makeFixture({
        'tsconfig.json': JSON.stringify({
          compilerOptions: { target: 'ES2020', moduleResolution: 'Bundler' },
        }),
        'child.tsx': `export const Label = () => <span>v1</span>;`,
        'app.tsx': `
          import { Label } from './child';
          render(<main><Label /></main>, document.getElementById('root')!);
        `,
      });

    const a = await compileTsx(join(mk(), 'app.tsx'));
    const dir2 = mk();
    writeFileSync(join(dir2, 'child.tsx'), `export const Label = () => <span>v2</span>;`);
    const b = await compileTsx(join(dir2, 'app.tsx'));

    expect(a.hash).not.toBe(b.hash);
    expect(a.inputs.some((p) => p.endsWith('child.tsx'))).toBe(true);
  });
});
