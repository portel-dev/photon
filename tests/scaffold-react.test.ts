import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as child_process from 'child_process';

import { scaffoldPhoton } from '../src/cli/commands/maker.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn().mockImplementation(() => Buffer.alloc(0)),
  };
});

const tmpDirs: string[] = [];
let originalCwd: () => string;

beforeEach(() => {
  originalCwd = process.cwd;
});

afterEach(() => {
  process.cwd = originalCwd;
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-scaffold-test-'));
  tmpDirs.push(dir);
  process.cwd = () => dir;
  return dir;
}

describe('scaffoldPhoton React template', () => {
  test('scaffolds a standard photon-react backend and react-vite frontend project', async () => {
    const dir = makeTempWorkspace();
    const photonName = 'my-react-app';

    await scaffoldPhoton(photonName, { react: true });

    // Assert backend photon is created
    const photonPath = join(dir, `${photonName}.photon.ts`);
    expect(existsSync(photonPath)).toBe(true);

    const photonContent = readFileSync(photonPath, 'utf8');
    expect(photonContent).toContain('@ui app ./ui/dist/index.html');
    expect(photonContent).toContain('class MyReactApp');
    expect(photonContent).toContain('async main()');

    // Assert UI directory is scaffolded
    const uiDir = join(dir, 'ui');
    expect(existsSync(uiDir)).toBe(true);
    expect(existsSync(join(uiDir, 'package.json'))).toBe(true);
    expect(existsSync(join(uiDir, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(uiDir, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(uiDir, 'index.html'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/main.tsx'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/App.tsx'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/styles.css'))).toBe(true);

    // Verify UI file contents
    const packageJson = JSON.parse(readFileSync(join(uiDir, 'package.json'), 'utf8'));
    expect(packageJson.dependencies.react).toBeDefined();

    const viteConfig = readFileSync(join(uiDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('proxy: {');
    expect(viteConfig).toContain("'/api': 'http://127.0.0.1:8888'");

    const appComponent = readFileSync(join(uiDir, 'src/App.tsx'), 'utf8');
    expect(appComponent).toContain('Photon React Dashboard');
  });

  test('scaffolds a standard Vue + Vite frontend project', async () => {
    const dir = makeTempWorkspace();
    const photonName = 'my-vue-app';

    await scaffoldPhoton(photonName, { vue: true });

    // Assert UI directory is scaffolded
    const uiDir = join(dir, 'ui');
    expect(existsSync(uiDir)).toBe(true);
    expect(existsSync(join(uiDir, 'package.json'))).toBe(true);
    expect(existsSync(join(uiDir, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(uiDir, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(uiDir, 'index.html'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/main.ts'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/App.vue'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/styles.css'))).toBe(true);

    // Verify UI file contents
    const packageJson = JSON.parse(readFileSync(join(uiDir, 'package.json'), 'utf8'));
    expect(packageJson.dependencies.vue).toBeDefined();

    const viteConfig = readFileSync(join(uiDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('@vitejs/plugin-vue');

    const appComponent = readFileSync(join(uiDir, 'src/App.vue'), 'utf8');
    expect(appComponent).toContain('Photon Vue Dashboard');
  });

  test('scaffolds a standard Svelte + Vite frontend project', async () => {
    const dir = makeTempWorkspace();
    const photonName = 'my-svelte-app';

    await scaffoldPhoton(photonName, { svelte: true });

    // Assert UI directory is scaffolded
    const uiDir = join(dir, 'ui');
    expect(existsSync(uiDir)).toBe(true);
    expect(existsSync(join(uiDir, 'package.json'))).toBe(true);
    expect(existsSync(join(uiDir, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(uiDir, 'svelte.config.js'))).toBe(true);
    expect(existsSync(join(uiDir, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(uiDir, 'index.html'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/main.ts'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/App.svelte'))).toBe(true);
    expect(existsSync(join(uiDir, 'src/styles.css'))).toBe(true);

    // Verify UI file contents
    const packageJson = JSON.parse(readFileSync(join(uiDir, 'package.json'), 'utf8'));
    expect(packageJson.dependencies.svelte).toBeDefined();

    const viteConfig = readFileSync(join(uiDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('@sveltejs/vite-plugin-svelte');

    const appComponent = readFileSync(join(uiDir, 'src/App.svelte'), 'utf8');
    expect(appComponent).toContain('Photon Svelte Dashboard');
  });
});
