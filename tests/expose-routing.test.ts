/**
 * @expose auto-RPC e2e
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track C.
 *
 * Drives the dispatcher's route precedence:
 *   1. Explicit @get/@post wins.
 *   2. @expose'd methods auto-bind at POST /api/<kebab>.
 *   3. Methods without @expose stay MCP-only and 404 on /api/<kebab>.
 *   4. Visibility gate: private rejects cross-site, public accepts anyone.
 *   5. Response-returning @expose handlers pass bytes through unchanged.
 *
 * Skipped under CI=true unless RUN_E2E=1 (matches the other v1.29 e2e suites).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'expose.photon.ts');

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

describe.skipIf(SKIP)('@expose auto-RPC routing', () => {
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

  it('POST /api/<kebab> with @expose public dispatches anonymously', async () => {
    const res = await fetch(`${BASE}/api/billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: string };
    expect(body.plan).toBe('enterprise');
  });

  it('POST /api/<kebab> with @expose private rejects cross-site fetches (403)', async () => {
    const res = await fetch(`${BASE}/api/get-current-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Browser would set Sec-Fetch-Site: cross-site for cross-origin
        // fetches. Spoofing it here proves the guard reads the header
        // (and isn't tricked by the localhost dev allowance).
        'Sec-Fetch-Site': 'cross-site',
        // Forge a non-loopback X-Forwarded-For so isLocalRequest fails too;
        // otherwise the dev allowance lets the call through. The dispatcher
        // then leans on Sec-Fetch-Site, which we've set to cross-site.
        'X-Forwarded-For': '203.0.113.1',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/<kebab> with @expose private accepts same-origin SPA fetches', async () => {
    const res = await fetch(`${BASE}/api/get-current-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: string; private: boolean };
    expect(body).toEqual({ user: 'me', private: true });
  });

  it('@get path takes precedence over the auto-RPC slot', async () => {
    // The fixture declares @get /calendar.ics on the same method, so the
    // /api/calendar slot must NOT activate — the explicit path wins.
    const res = await fetch(`${BASE}/calendar.ics`, {
      headers: { Accept: 'text/calendar' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toContain('BEGIN:VCALENDAR');

    // The auto-RPC slot stays unclaimed for this method.
    const auto = await fetch(`${BASE}/api/calendar`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(auto.status).toBe(404);
  });

  it('un-@exposed methods do not auto-bind and 404 on /api/<kebab>', async () => {
    const res = await fetch(`${BASE}/api/list-secrets`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('Response-returning @expose handler passes bytes through unchanged', async () => {
    const res = await fetch(`${BASE}/api/raw-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(await res.text()).toBe('raw-payload');
  });
});
