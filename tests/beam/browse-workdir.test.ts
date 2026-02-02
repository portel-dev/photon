/**
 * Browse API Workdir Resolution Test
 *
 * Verifies that /api/browse correctly resolves a photon's workdir
 * from the running instance, not just from env vars.
 *
 * This test was added after a bug where the file picker showed files
 * from ~/.photon but the photon rejected them — because the browse
 * endpoint only checked env vars (which aren't set for constructor defaults).
 *
 * Run: npx tsx tests/beam/browse-workdir.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const BEAM_PORT = 3600 + Math.floor(Math.random() * 100);
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let tmpDir: string;

// Create a test photon with a workdir default (not set via env var)
async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beam-browse-test-'));
  const workdir = path.join(tmpDir, 'data');
  await fs.mkdir(workdir);
  await fs.writeFile(path.join(workdir, 'test-file.txt'), 'hello');
  await fs.mkdir(path.join(workdir, 'subdir'));

  const photonSource = `
import * as path from 'path';

/**
 * Test photon with workdir default
 * @description Browse test photon
 */
export default class BrowseTest {
  private workdir: string;

  constructor(workdir: string = '${workdir.replace(/\\/g, '\\\\')}') {
    this.workdir = path.resolve(workdir);
  }

  async read(params: { path: string }) {
    const resolved = path.isAbsolute(params.path)
      ? params.path
      : path.resolve(this.workdir, params.path);

    if (!resolved.startsWith(this.workdir)) {
      throw new Error('Access denied: Path outside working directory');
    }
    return { success: true, path: resolved };
  }
}
`;

  await fs.writeFile(path.join(tmpDir, 'browse-test.photon.ts'), photonSource);
  return { workdir };
}

async function startBeam(): Promise<void> {
  return new Promise((resolve, reject) => {
    beamProcess = spawn('node', [
      'dist/cli.js',
      `--dir=${tmpDir}`,
      'beam',
      '--port', String(BEAM_PORT),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let started = false;

    beamProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (output.includes('Photon Beam') && !started) {
        started = true;
        // Wait for server to be fully ready
        setTimeout(async () => {
          for (let i = 0; i < 10; i++) {
            try {
              const res = await fetch(`${BEAM_URL}/api/photons`);
              if (res.ok) { resolve(); return; }
            } catch { /* retry */ }
            await new Promise(r => setTimeout(r, 500));
          }
          resolve();
        }, 1000);
      }
    });

    beamProcess.stderr?.on('data', (data: Buffer) => {
      if (process.env.DEBUG) {
        console.error('[BEAM]', data.toString().trim());
      }
    });

    beamProcess.on('error', reject);
    setTimeout(() => { if (!started) reject(new Error('Beam start timeout')); }, 20000);
  });
}

async function cleanup() {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    beamProcess = null;
  }
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
  }

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

  tests.push({
    name: 'browse without photon param returns items (no root constraint)',
    fn: async () => {
      const res = await fetch(`${BEAM_URL}/api/browse`);
      const data = await res.json();
      assert(res.ok, `Expected 200, got ${res.status}`);
      assert(data.path !== undefined, 'Response should have path');
      assert(data.root === null || data.root === undefined || data.root === null,
        'Root should be null when no photon specified');
    },
  });

  tests.push({
    name: 'browse with photon param resolves workdir as root from instance',
    fn: async () => {
      const res = await fetch(`${BEAM_URL}/api/browse?photon=browse-test`);
      const data = await res.json();
      assert(res.ok, `Expected 200, got ${res.status}`);
      assert(data.root !== null && data.root !== undefined,
        `Root should be set from photon instance workdir, got: ${JSON.stringify(data.root)}`);
      assert(data.items.some((i: any) => i.name === 'test-file.txt'),
        'Should list files in photon workdir');
      assert(data.items.some((i: any) => i.name === 'subdir'),
        'Should list subdirectories in photon workdir');
    },
  });

  tests.push({
    name: 'browse constrains navigation to workdir root',
    fn: async () => {
      // Try to navigate above the workdir
      const res = await fetch(`${BEAM_URL}/api/browse?photon=browse-test&path=${encodeURIComponent(tmpDir)}`);
      assert(res.status === 403, `Expected 403 for path outside workdir, got ${res.status}`);
    },
  });

  tests.push({
    name: 'invoke with file from workdir succeeds',
    fn: async () => {
      const res = await fetch(`${BEAM_URL}/api/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photon: 'browse-test',
          method: 'read',
          args: { path: 'test-file.txt' },
        }),
      });
      const data = await res.json();
      assert(res.ok, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
      assert(data.result?.success === true, 'Read should succeed for file in workdir');
    },
  });

  console.log('🧪 Browse API Workdir Resolution Tests\n');

  for (const t of tests) {
    process.stdout.write(`  ${t.name}... `);
    try {
      await t.fn();
      console.log('✅');
      passed++;
    } catch (err: any) {
      console.log('❌');
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  return failed;
}

// Main
(async () => {
  try {
    const { workdir } = await setup();
    console.log(`📁 Test workdir: ${workdir}`);
    console.log(`🚀 Starting Beam on port ${BEAM_PORT}...\n`);
    await startBeam();

    const failures = await runTests();
    await cleanup();
    process.exit(failures > 0 ? 1 : 0);
  } catch (err) {
    console.error('💥 Test setup failed:', err);
    await cleanup();
    process.exit(1);
  }
})();
