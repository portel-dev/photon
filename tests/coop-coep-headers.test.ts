/**
 * COOP/COEP capability unlock (Track D2)
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track D2.
 *
 * Standalone @ui pages must serve COOP `same-origin` + COEP `require-corp`
 * so SharedArrayBuffer / WebGPU / persistent OPFS / Service Workers light
 * up. Iframe embeds (Beam, Claude Apps) must NOT receive those headers,
 * since the parent host can be on another origin.
 *
 * Asset siblings under `<photon>/assets/` get CORP `same-origin` so a
 * standalone page asserting COEP can still fetch them.
 *
 * Skipped under CI=true unless RUN_E2E=1 (matches Track A's content-negotiation
 * suite — both spawn an HTTP child server).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'asset-bundle.photon.ts');

const PORT = 30000 + Math.floor(Math.random() * 30000);
const BASE = `http://127.0.0.1:${PORT}`;

const SKIP = process.env.CI === 'true' && process.env.RUN_E2E !== '1';

async function waitForPort(port: number, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
      if (res.status > 0) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start on port ${port} within ${timeoutMs}ms`);
}

describe.skipIf(SKIP)('COOP/COEP cross-origin isolation', () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawn(PHOTON_BIN, ['mcp', '--transport', 'sse', '--port', String(PORT), FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stderr.write(b);
    });
    await waitForPort(PORT);
  }, 15_000);

  afterAll(() => {
    server?.kill();
  });

  it('@ui HTML for a top-level navigation gets COOP/COEP headers', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });

  it('@ui HTML inside an iframe (Sec-Fetch-Dest: iframe) skips COOP/COEP', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard`, {
      headers: { 'Sec-Fetch-Dest': 'iframe' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('cross-origin-embedder-policy')).toBeNull();
  });

  it('@ui HTML with ?embed=1 manual override skips COOP/COEP', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard?embed=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('cross-origin-embedder-policy')).toBeNull();
  });

  it('asset sibling responses carry CORP same-origin', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard/chunks/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });
});
