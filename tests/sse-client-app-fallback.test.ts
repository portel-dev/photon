import { strict as assert } from 'assert';
import { createServer } from 'node:net';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PhotonServer } from '../src/server.js';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-sse-client-app-'));
  await fs.mkdir(path.join(dir, 'ui'), { recursive: true });
  const photonPath = path.join(dir, 'direct-app.photon.ts');

  await fs.writeFile(
    photonPath,
    `
/**
 * Direct app fallback test
 * @ui app
 */
export default class DirectApp {
  /**
   * @ui app
   * @internal
   * @audience user
   * @readOnly
   */
  async client_ui() {
    return { ok: true };
  }

  /** @get /explicit */
  async explicit() {
    return new Response('explicit route');
  }
}
`,
    'utf-8'
  );

  await fs.writeFile(
    path.join(dir, 'ui', 'app.tsx'),
    `
const root = document.getElementById('root');
render(<main><h1>Direct client app</h1></main>, root);
`,
    'utf-8'
  );

  const port = await findFreePort();
  const server = new PhotonServer({
    filePath: photonPath,
    transport: 'sse',
    port,
    logOptions: { level: 'error' },
  });

  try {
    await server.start();
    const base = `http://localhost:${port}`;

    // The .tsx view is served as a tiny cache-busting shell that
    // references a content-hashed bundle; the app code lives in the JS.
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type') || '', /text\/html/);
    assert.equal(root.headers.get('cache-control'), 'no-cache');
    const shell = await root.text();
    const m = shell.match(/src="\.\/(app\.[0-9a-f]{12}\.js)"/);
    assert.ok(m, 'shell references a hashed bundle');
    const jsName = m![1];

    const bundle = await fetch(`${base}/${jsName}`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type') || '', /javascript/);
    assert.match(bundle.headers.get('cache-control') || '', /immutable/);
    assert.match(await bundle.text(), /Direct client app/);

    // Nested SPA route: shell again, and the relatively-resolved bundle
    // URL must still hit the immutable JS (basename match).
    const nested = await fetch(`${base}/threads/t_123`);
    assert.equal(nested.status, 200);
    assert.match(nested.headers.get('content-type') || '', /text\/html/);
    assert.match(await nested.text(), new RegExp(jsName.replace(/\./g, '\\.')));
    const nestedJs = await fetch(`${base}/threads/${jsName}`);
    assert.equal(nestedJs.status, 200);
    assert.match(await nestedJs.text(), /Direct client app/);

    const explicit = await fetch(`${base}/explicit`);
    assert.equal(explicit.status, 200);
    assert.equal(await explicit.text(), 'explicit route');

    const mcpAbort = new AbortController();
    const mcp = await fetch(`${base}/mcp`, { signal: mcpAbort.signal });
    assert.equal(mcp.status, 200);
    assert.match(mcp.headers.get('content-type') || '', /text\/event-stream/);
    mcpAbort.abort();

    const legacy = await fetch(`${base}/threads?legacy=1`);
    assert.equal(legacy.status, 404);
  } finally {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }

  console.log('SSE client app fallback tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
