export interface LocalWebSocketEndpoint extends EventTarget {
  readonly readyState: number;
  accept(): void;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

class LocalEndpoint extends EventTarget implements LocalWebSocketEndpoint {
  readyState = 0;
  peer: LocalEndpoint | null = null;

  accept(): void {
    if (this.readyState === 0) this.readyState = 1;
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1 || !this.peer || this.peer.readyState > 1) return;
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer.readyState > 1) return;
      const event = new Event('message') as Event & { data: typeof data };
      Object.defineProperty(event, 'data', { value: data, enumerable: true });
      peer.dispatchEvent(event);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState > 1) return;
    this.readyState = 3;
    const peer = this.peer;
    if (peer && peer.readyState < 2) peer.readyState = 3;
    for (const target of [this, peer]) {
      if (!target) continue;
      const event = new Event('close') as Event & { code: number; reason: string };
      Object.defineProperties(event, {
        code: { value: code, enumerable: true },
        reason: { value: reason, enumerable: true },
      });
      queueMicrotask(() => target.dispatchEvent(event));
    }
  }
}

export class LocalWebSocketPair {
  0: LocalWebSocketEndpoint;
  1: LocalWebSocketEndpoint;

  constructor() {
    const client = new LocalEndpoint();
    const server = new LocalEndpoint();
    client.peer = server;
    server.peer = client;
    this[0] = client;
    this[1] = server;
  }
}

/**
 * Create the Workers-style 101 response used by Photon WebSocket routes.
 *
 * Node's Fetch implementation rejects status 101 and Bun currently drops the
 * non-standard `webSocket` ResponseInit member. Build an otherwise ordinary
 * Response and attach the upgrade fields explicitly so the same Photon route
 * works in both runtimes.
 */
export function createWebSocketUpgradeResponse(
  webSocket: LocalWebSocketEndpoint
): Response & { webSocket: LocalWebSocketEndpoint } {
  let response: Response;
  try {
    response = new Response(null, {
      status: 101,
      webSocket,
    } as ResponseInit & { webSocket: LocalWebSocketEndpoint });
  } catch {
    response = new Response(null);
  }
  const upgradeResponse = response as Response & { webSocket?: LocalWebSocketEndpoint };
  if (response.status !== 101) {
    Object.defineProperty(response, 'status', { value: 101, enumerable: true });
  }
  if (!response.statusText) {
    Object.defineProperty(response, 'statusText', {
      value: 'Switching Protocols',
      enumerable: true,
    });
  }
  if (upgradeResponse.webSocket !== webSocket) {
    Object.defineProperty(response, 'webSocket', { value: webSocket, enumerable: false });
  }
  return response as Response & { webSocket: LocalWebSocketEndpoint };
}

/** Install the Workers-compatible primitive used by local Photon web routes. */
export function installLocalWebSocketPair(): void {
  const target = globalThis as typeof globalThis & { WebSocketPair?: typeof LocalWebSocketPair };
  if (!target.WebSocketPair) target.WebSocketPair = LocalWebSocketPair;
}
