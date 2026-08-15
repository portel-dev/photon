import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PhotonServer } from '../src/server.js';
import {
  LocalWebSocketPair,
  createWebSocketUpgradeResponse,
} from '../src/shared/local-websocket-pair.js';

async function unusedPort(): Promise<number> {
  // Avoid listen(0): some managed macOS environments reject ephemeral-port
  // allocation even though explicit loopback ports are available.
  const first = 39000 + (process.pid % 1000);
  for (let offset = 0; offset < 32; offset++) {
    const port = first + offset;
    const probe = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', () => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
      return port;
    } catch (error: any) {
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Unable to find an available loopback test port');
}

describe('Photon local WebSocket routes', () => {
  let photon: PhotonServer | undefined;
  let browser: WebSocket | undefined;

  afterEach(async () => {
    browser?.terminate();
    browser = undefined;
    await photon?.stop();
    photon = undefined;
  });

  it('creates a cross-runtime 101 response with its local endpoint attached', () => {
    const pair = new LocalWebSocketPair();
    const response = createWebSocketUpgradeResponse(pair[0]);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(101);
    expect(response.statusText).toBe('Switching Protocols');
    expect(response.webSocket).toBe(pair[0]);
  });

  it('upgrades an @get route and bridges messages in both directions', async () => {
    const port = await unusedPort();
    const fixture = fileURLToPath(new URL('./fixtures/websocket-echo.photon.ts', import.meta.url));
    photon = new PhotonServer({
      filePath: fixture,
      transport: 'sse',
      port,
    });
    await photon.start();

    browser = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    await new Promise<void>((resolve, reject) => {
      browser!.once('open', resolve);
      browser!.once('error', reject);
    });

    const echoed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('echo timed out')), 1000);
      browser!.once('message', (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
    });
    browser.send('terminal-byte');

    await expect(echoed).resolves.toBe('echo:terminal-byte');
  });
});
