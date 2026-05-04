/**
 * HTTP content negotiation e2e
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track A.
 *
 * Drives the @get/@post HTTP dispatcher with a fixture whose handler returns
 * a plain value (not a Response). The runtime negotiates Accept against the
 * registered FormatRegistry and writes the rendered body.
 *
 * Coverage:
 *   - Accept: text/html -> HTML table
 *   - Accept: application/json -> JSON
 *   - Accept: text/csv -> CSV
 *   - Accept wildcard with declared @format table -> text/html
 *   - Accept: text/csv on non-tabular value -> JSON fallback (explicit contract)
 *   - Response pass-through stays byte-identical
 *
 * Skipped under CI=true unless RUN_E2E=1 (matches dynamic-resources-subscribe-sse.e2e).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'http-content-negotiation.photon.ts');

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

describe.skipIf(SKIP)('HTTP content negotiation', () => {
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

  it('Accept: text/html → HTML table', async () => {
    const res = await fetch(`${BASE}/users`, { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<table>');
    expect(body).toContain('Alice');
    expect(body).toContain('Bob');
  });

  it('Accept: application/json → JSON', async () => {
    const res = await fetch(`${BASE}/users`, { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.map((u) => u.name)).toEqual(['Alice', 'Bob']);
  });

  it('Accept: text/csv on tabular value → CSV', async () => {
    const res = await fetch(`${BASE}/users`, { headers: { Accept: 'text/csv' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    expect(body).toBe('name,role\nAlice,Eng\nBob,PM\n');
  });

  it('Accept: */* with declared @format table → HTML', async () => {
    const res = await fetch(`${BASE}/users`, { headers: { Accept: '*/*' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('Accept: text/csv on non-tabular value → JSON fallback', async () => {
    const res = await fetch(`${BASE}/status`, { headers: { Accept: 'text/csv' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('Response pass-through stays byte-identical (regression for Track A)', async () => {
    const res = await fetch(`${BASE}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('raw bytes');
  });
});
