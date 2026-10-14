import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PhotonStatusService } from '../src/server-status-service.js';

class FakeResponse extends EventEmitter {
  writes: string[] = [];
  ended = false;
  writeHead(_status: number, _headers: Record<string, string>) {}
  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
}

describe('PhotonStatusService', () => {
  it('streams snapshots, status updates, and cleans up clients', async () => {
    const response = new FakeResponse();
    let sent: unknown;
    const service = new PhotonStatusService({
      getPhoton: () =>
        ({
          name: 'demo',
          tools: [{ name: 'ping', description: 'Ping' }],
          instance: { _photonConfigError: true },
          assets: { ui: [{ id: 'app', linkedTool: 'ping' }], prompts: [], resources: [] },
        }) as any,
      getDevMode: () => true,
      getHotReloadDisabled: () => false,
      getLastReloadError: () => null,
      now: () => 123,
      notificationPort: {
        broadcast: async (status) => {
          sent = status;
        },
      },
    });

    service.handleStream({ headers: {} } as any, response as any);
    expect(JSON.parse(response.writes[0].slice(6)).photon).toBe('demo');
    await service.broadcast('success', 'Reloaded');
    expect(JSON.parse(response.writes[1].slice(6)).message).toBe('Reloaded');
    expect(sent).toEqual({ type: 'success', message: 'Reloaded', timestamp: 123 });
    response.emit('close');
    await service.broadcast('info', 'No stale client');
    service.close();
    expect(response.ended).toBe(false);
  });
});
