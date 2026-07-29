import {
  createWebSocketUpgradeResponse,
  type LocalWebSocketEndpoint,
} from '../../src/shared/local-websocket-pair.js';

type WebSocketPairConstructor = new () => {
  0: LocalWebSocketEndpoint;
  1: LocalWebSocketEndpoint;
};

export default class WebSocketEcho {
  /**
   * Echo text through a Workers-compatible WebSocketPair.
   * @get /socket
   */
  async socket(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const Pair = (
      globalThis as typeof globalThis & {
        WebSocketPair: WebSocketPairConstructor;
      }
    ).WebSocketPair;
    const pair = new Pair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    server.addEventListener('message', (event) => {
      const data = (event as Event & { data: string }).data;
      server.send(`echo:${data}`);
    });
    return createWebSocketUpgradeResponse(client);
  }
}
