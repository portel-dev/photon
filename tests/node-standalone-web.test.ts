import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PhotonServer } from '../src/server.js';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function postMcp(base: string, id: number, method: string): Promise<any> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params:
        method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              clientInfo: { name: 'standalone-web-test', version: '1.0.0' },
              capabilities: { tools: {} },
            }
          : {},
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function run(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-node-standalone-web-'));
  const ordinaryPath = path.join(dir, 'ordinary.photon.ts');
  const explicitPath = path.join(dir, 'explicit.photon.ts');
  await fs.writeFile(
    ordinaryPath,
    `
export default class Ordinary {
  get role() { return this.caller?.anonymous ? 'user' : 'host'; }
  /** @class Ordinary {@role user} */
  /** Visible operation */
  async visible() { return { ok: true }; }
  /** @class Ordinary {@role host} */
  /** Hidden admin console description */
  async hiddenAdmin() { return { secret: true }; }
  caller: any;
}
`,
    'utf8'
  );
  await fs.writeFile(
    explicitPath,
    `
export default class Explicit {
  /** @get / */
  async root() { return new Response('explicit root'); }
  async ordinary() { return 'not a shell'; }
}
`,
    'utf8'
  );

  const ordinaryPort = await freePort();
  const ordinary = new PhotonServer({
    filePath: ordinaryPath,
    transport: 'sse',
    port: ordinaryPort,
    logOptions: { level: 'error' },
  });
  try {
    await ordinary.start();
    const base = `http://localhost:${ordinaryPort}`;
    const shell = await fetch(`${base}/`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type') || '', /text\/html/);
    const html = await shell.text();
    assert.match(html, /tools\/list/);
    assert.match(html, /photon-form\.bundle\.js/);
    assert.match(html, /api\/photon-renderers\.js/);
    assert.doesNotMatch(html, /hiddenAdmin|Hidden admin console description/);

    const webShell = await fetch(`${base}/web/ordinary/`);
    assert.equal(webShell.status, 200);
    assert.match(await webShell.text(), /standalone-app/);

    const initialized = await postMcp(base, 1, 'initialize');
    assert.ok(initialized.result);
    const listed = await postMcp(base, 2, 'tools/list');
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes('visible'));
    assert.ok(!names.includes('hiddenAdmin'));

    const form = await fetch(`${base}/photon-form.bundle.js`);
    assert.equal(form.status, 200);
    assert.match(form.headers.get('content-type') || '', /javascript/);
    assert.match(await form.text(), /invoke-form/);

    const renderers = await fetch(`${base}/api/photon-renderers.js`);
    assert.equal(renderers.status, 200);
    assert.match(renderers.headers.get('content-type') || '', /javascript/);
    assert.match(await renderers.text(), /_photonRenderers/);
  } finally {
    await ordinary.stop();
  }

  const explicitPort = await freePort();
  const explicit = new PhotonServer({
    filePath: explicitPath,
    transport: 'sse',
    port: explicitPort,
    logOptions: { level: 'error' },
  });
  try {
    await explicit.start();
    const response = await fetch(`http://localhost:${explicitPort}/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'explicit root');
  } finally {
    await explicit.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
