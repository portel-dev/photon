import { describe, expect, test, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock child_process at the top level
const mockExecSync = vi.fn().mockImplementation(() => Buffer.from('mocked'));
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execSync: (cmd: any, opts: any) => mockExecSync(cmd, opts),
    spawn: () => ({
      on: (event: string, cb: any) => {
        if (event === 'close') cb(0);
      },
    }),
  };
});

// Mock wrangler check to bypass login check
vi.mock('../src/deploy/cloudflare.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/deploy/cloudflare.ts')>();
  return {
    ...actual,
    resolveCloudflareApiToken: () => null,
    wranglerEnv: () => ({}),
  };
});

import { deployToCloudflare } from '../src/deploy/cloudflare.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('Cloudflare Deploy with Companion UI assets', () => {
  test('bundles compiled UI assets into public/ directory and enables [assets] in wrangler.toml', async () => {
    // Create a temporary workspace
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photon-ui-deploy-'));
    tmpDirs.push(tempDir);

    // Create a mock photon file
    const photonPath = path.join(tempDir, 'todo.photon.ts');
    await fsp.writeFile(photonPath, 'export default class Todo {}');

    // Create mock companion ui project and dist output
    const uiDir = path.join(tempDir, 'ui');
    const uiDist = path.join(uiDir, 'dist');
    await fsp.mkdir(uiDist, { recursive: true });
    await fsp.writeFile(path.join(uiDist, 'index.html'), '<html>Mocked Frontend</html>');

    // Set up output directory
    const outputDir = path.join(tempDir, 'output');

    // Run deployToCloudflare with dryRun: true to verify codegen output
    await deployToCloudflare({
      photonPath,
      dryRun: true,
      outputDir,
    });

    // Verify UI build command was executed
    expect(mockExecSync).toHaveBeenCalled();
    const buildCmdCall = mockExecSync.mock.calls.find((c) => c[0].includes('run build'));
    expect(buildCmdCall).toBeDefined();

    // Verify index.html was copied into outputDir/public/
    const publicHtml = path.join(outputDir, 'public', 'index.html');
    expect(fs.existsSync(publicHtml)).toBe(true);
    const content = await fsp.readFile(publicHtml, 'utf8');
    expect(content).toBe('<html>Mocked Frontend</html>');

    // Verify wrangler.toml contains [assets] block
    const tomlPath = path.join(outputDir, 'wrangler.toml');
    expect(fs.existsSync(tomlPath)).toBe(true);
    const tomlContent = await fsp.readFile(tomlPath, 'utf8');
    expect(tomlContent).toContain('[assets]');
    expect(tomlContent).toContain('directory = "./public"');
  });
});
