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

    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type') || '', /text\/html/);
    assert.match(await root.text(), /Direct client app/);

    const nested = await fetch(`${base}/threads/t_123`);
    assert.equal(nested.status, 200);
    assert.match(nested.headers.get('content-type') || '', /text\/html/);
    assert.match(await nested.text(), /Direct client app/);

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
