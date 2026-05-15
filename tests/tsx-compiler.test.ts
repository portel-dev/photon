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

    const html = await compileTsx(join(dir, 'app.tsx'));

    expect(html).toContain('function render(');
    expect(html).toContain('function h(');
    expect(html).not.toContain('React.createElement');
    expect(html).not.toContain('TSX Build Error');
  });
});
