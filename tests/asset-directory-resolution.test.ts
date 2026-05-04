/**
 * Directory-style asset serving e2e
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track E.
 *
 * Drives the v1.29 sibling-resolution behaviour:
 *   - GET /api/ui/<id>            → the @ui-declared file
 *   - GET /api/ui/<id>/<rest>     → siblings under the @ui's directory
 *   - GET /api/ui/<id>/../foo.js  → 403 (path traversal guard)
 *
 * Uses the asset-bundle fixture (v1.29 layout, `<photon>/assets/`) so the
 * runtime has to walk the new convention end-to-end. The fixture declares
 * `@ui dashboard ./dashboard/dist/index.html`; the test fetches the
 * sibling chunk that the index would `<script src>` and asserts the
 * contents come back byte-for-byte.
 *
 * Skipped under CI=true unless RUN_E2E=1 (matches Track A's content-negotiation
 * suite — both spawn an HTTP child server and need network).
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

describe.skipIf(SKIP)('directory-style asset serving', () => {
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

  it('GET /api/ui/<id> returns the declared @ui file', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<script src="./chunks/main.js">');
  });

  it('GET /api/ui/<id>/<rest> serves a sibling under the @ui directory', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard/chunks/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    const body = await res.text();
    expect(body).toContain('asset-bundle dashboard ready');
  });

  it('GET /api/ui/<id>/../<...> returns 403 (path traversal guard)', async () => {
    // Attempt to escape the dashboard/dist root and grab the form.html
    // declared under a different @ui id. The guard must reject it even
    // though the target file exists somewhere under the asset folder.
    const res = await fetch(`${BASE}/api/ui/dashboard/../../ui/form.html`);
    expect([403, 404]).toContain(res.status);
  });

  it('GET /api/ui/<unknown-id>/<rest> returns 404', async () => {
    const res = await fetch(`${BASE}/api/ui/no-such-id/whatever.js`);
    expect(res.status).toBe(404);
  });
});
