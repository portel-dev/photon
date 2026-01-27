/**
 * Daemon Event Buffer Tests
 *
 * Tests for the event buffer, replay, and global daemon features
 */

import { strict as assert } from 'assert';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import { isValidDaemonRequest, isValidDaemonResponse } from '../dist/daemon/protocol.js';
import type { DaemonRequest, DaemonResponse } from '../dist/daemon/protocol.js';

// Track test results
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

// ============================================================================
// Protocol Validation Tests - New Fields
// ============================================================================

async function testNewProtocolFields() {
  console.log('\nNew Protocol Fields Validation:');

  await test('accepts get_events_since with channel', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'get_events_since',
        id: '1',
        channel: 'test-channel',
        lastEventId: '42',
      }),
      true
    );
  });

  await test('accepts subscribe with lastEventId', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'subscribe',
        id: '1',
        channel: 'test',
        lastEventId: '10',
      }),
      true
    );
  });

  await test('accepts request with photonName', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'command',
        id: '1',
        method: 'test',
        photonName: 'my-photon',
      }),
      true
    );
  });

  await test('accepts publish with photonName', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'publish',
        id: '1',
        channel: 'test',
        message: { foo: 'bar' },
        photonName: 'kanban',
      }),
      true
    );
  });

  await test('accepts refresh_needed response', () => {
    assert.equal(
      isValidDaemonResponse({
        type: 'refresh_needed',
        id: '1',
        channel: 'test-channel',
      }),
      true
    );
  });

  await test('accepts channel_message with eventId', () => {
    assert.equal(
      isValidDaemonResponse({
        type: 'channel_message',
        id: '1',
        channel: 'test',
        message: { data: 'test' },
        eventId: '42',
      }),
      true
    );
  });
}

// ============================================================================
// Mock Daemon Server with Event Buffer
// ============================================================================

interface BufferedEvent {
  id: number;
  channel: string;
  message: unknown;
  timestamp: number;
}

interface ChannelBuffer {
  events: BufferedEvent[];
  nextId: number;
}

class MockDaemonServerWithBuffer {
  private server: net.Server;
  private socketPath: string;
  private channelSubscriptions = new Map<string, Set<net.Socket>>();
  private channelEventBuffers = new Map<string, ChannelBuffer>();
  private bufferSize = 10; // Small buffer for testing

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  private handleConnection(socket: net.Socket) {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const request: DaemonRequest = JSON.parse(line);
          const response = this.handleRequest(request, socket);
          if (response) {
            socket.write(JSON.stringify(response) + '\n');
          }
        } catch {
          socket.write(
            JSON.stringify({ type: 'error', id: 'unknown', error: 'Parse error' }) + '\n'
          );
        }
      }
    });

    socket.on('end', () => this.cleanupSocket(socket));
    socket.on('error', () => this.cleanupSocket(socket));
  }

  private handleRequest(request: DaemonRequest, socket: net.Socket): DaemonResponse | null {
    if (request.type === 'ping') {
      return { type: 'pong', id: request.id };
    }

    if (request.type === 'subscribe') {
      const channel = request.channel!;
      let subs = this.channelSubscriptions.get(channel);
      if (!subs) {
        subs = new Set();
        this.channelSubscriptions.set(channel, subs);
      }
      subs.add(socket);

      // Handle lastEventId for replay
      if (request.lastEventId !== undefined) {
        const lastId = parseInt(String(request.lastEventId), 10) || 0;
        const { events, refreshNeeded } = this.getEventsSince(channel, lastId);

        if (refreshNeeded) {
          // Send refresh-needed signal
          socket.write(
            JSON.stringify({
              type: 'refresh_needed',
              id: request.id,
              channel,
            }) + '\n'
          );
        } else if (events.length > 0) {
          // Replay events
          for (const event of events) {
            socket.write(
              JSON.stringify({
                type: 'channel_message',
                id: `replay_${event.id}`,
                eventId: String(event.id),
                channel: event.channel,
                message: event.message,
              }) + '\n'
            );
          }
        }
      }

      return { type: 'result', id: request.id, success: true, data: { subscribed: true, channel } };
    }

    if (request.type === 'unsubscribe') {
      const channel = request.channel!;
      const subs = this.channelSubscriptions.get(channel);
      if (subs) {
        subs.delete(socket);
        if (subs.size === 0) {
          this.channelSubscriptions.delete(channel);
        }
      }
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: { unsubscribed: true, channel },
      };
    }

    if (request.type === 'publish') {
      const channel = request.channel!;
      const message = request.message;
      const eventId = this.bufferAndPublish(channel, message, socket);
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: { published: true, channel, eventId },
      };
    }

    if (request.type === 'get_events_since') {
      const channel = request.channel!;
      const lastId = parseInt(String(request.lastEventId || '0'), 10) || 0;
      const { events, refreshNeeded } = this.getEventsSince(channel, lastId);
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: {
          events: events.map((e) => ({ eventId: String(e.id), message: e.message })),
          refreshNeeded,
        },
      };
    }

    return { type: 'error', id: request.id, error: `Unknown request type: ${request.type}` };
  }

  private bufferAndPublish(
    channel: string,
    message: unknown,
    excludeSocket: net.Socket
  ): number {
    // Buffer the event
    let buffer = this.channelEventBuffers.get(channel);
    if (!buffer) {
      buffer = { events: [], nextId: 1 };
      this.channelEventBuffers.set(channel, buffer);
    }

    const eventId = buffer.nextId++;
    const event: BufferedEvent = {
      id: eventId,
      channel,
      message,
      timestamp: Date.now(),
    };

    buffer.events.push(event);

    // Keep only last N events (circular buffer)
    if (buffer.events.length > this.bufferSize) {
      buffer.events.shift();
    }

    // Publish to subscribers
    const subs = this.channelSubscriptions.get(channel);
    if (subs) {
      const payload =
        JSON.stringify({
          type: 'channel_message',
          id: `ch_${eventId}`,
          eventId: String(eventId),
          channel,
          message,
        }) + '\n';

      for (const socket of subs) {
        if (socket !== excludeSocket && !socket.destroyed) {
          socket.write(payload);
        }
      }
    }

    return eventId;
  }

  private getEventsSince(
    channel: string,
    lastEventId: number
  ): { events: BufferedEvent[]; refreshNeeded: boolean } {
    const buffer = this.channelEventBuffers.get(channel);

    if (!buffer || buffer.events.length === 0) {
      return { events: [], refreshNeeded: false };
    }

    const oldestEvent = buffer.events[0];

    // If lastEventId is older than our oldest buffered event, client needs full refresh
    if (lastEventId > 0 && lastEventId < oldestEvent.id) {
      return { events: [], refreshNeeded: true };
    }

    // Return all events after lastEventId
    const events = buffer.events.filter((e) => e.id > lastEventId);
    return { events, refreshNeeded: false };
  }

  private cleanupSocket(socket: net.Socket) {
    for (const [channel, subs] of this.channelSubscriptions.entries()) {
      subs.delete(socket);
      if (subs.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }
  }

  // Test helpers
  publishDirectly(channel: string, message: unknown): number {
    let buffer = this.channelEventBuffers.get(channel);
    if (!buffer) {
      buffer = { events: [], nextId: 1 };
      this.channelEventBuffers.set(channel, buffer);
    }

    const eventId = buffer.nextId++;
    buffer.events.push({
      id: eventId,
      channel,
      message,
      timestamp: Date.now(),
    });

    if (buffer.events.length > this.bufferSize) {
      buffer.events.shift();
    }

    return eventId;
  }

  getBufferSize(channel: string): number {
    return this.channelEventBuffers.get(channel)?.events.length || 0;
  }

  getOldestEventId(channel: string): number | undefined {
    const buffer = this.channelEventBuffers.get(channel);
    return buffer?.events[0]?.id;
  }

  getNewestEventId(channel: string): number | undefined {
    const buffer = this.channelEventBuffers.get(channel);
    if (!buffer || buffer.events.length === 0) return undefined;
    return buffer.events[buffer.events.length - 1].id;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => resolve());
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

// ============================================================================
// Event Buffer Tests
// ============================================================================

async function testEventBuffer() {
  console.log('\nEvent Buffer:');

  const socketPath = path.join(os.tmpdir(), `photon-buffer-test-${Date.now()}.sock`);
  const server = new MockDaemonServerWithBuffer(socketPath);

  try {
    await server.start();

    await test('publish returns eventId', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'publish',
        id: 'pub_1',
        channel: 'buffer-test',
        message: { data: 'test1' },
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal(response.success, true);
      assert.equal(typeof (response.data as any).eventId, 'number');
      assert.ok((response.data as any).eventId > 0);

      client.destroy();
    });

    await test('events are buffered', async () => {
      // Publish several events directly
      for (let i = 0; i < 5; i++) {
        server.publishDirectly('buffered-channel', { index: i });
      }

      assert.equal(server.getBufferSize('buffered-channel'), 5);
    });

    await test('buffer is circular (oldest events evicted)', async () => {
      // Buffer size is 10, publish 15 events
      for (let i = 0; i < 15; i++) {
        server.publishDirectly('overflow-channel', { index: i });
      }

      assert.equal(server.getBufferSize('overflow-channel'), 10);
      // Oldest event should be index 5 (first 5 were evicted)
      const oldest = server.getOldestEventId('overflow-channel');
      assert.ok(oldest !== undefined && oldest > 5);
    });

    await test('get_events_since returns events after lastEventId', async () => {
      // Publish 5 events
      for (let i = 0; i < 5; i++) {
        server.publishDirectly('replay-channel', { index: i });
      }

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Get events since ID 2
      const request: DaemonRequest = {
        type: 'get_events_since',
        id: 'get_1',
        channel: 'replay-channel',
        lastEventId: '2',
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      const data = response.data as { events: any[]; refreshNeeded: boolean };
      assert.equal(data.refreshNeeded, false);
      assert.ok(data.events.length >= 2); // Should have events 3, 4, 5

      client.destroy();
    });

    await test('get_events_since returns refreshNeeded when too old', async () => {
      // Publish enough to overflow buffer
      for (let i = 0; i < 15; i++) {
        server.publishDirectly('old-channel', { index: i });
      }

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Request events from ID 1 (which was evicted)
      const request: DaemonRequest = {
        type: 'get_events_since',
        id: 'get_old',
        channel: 'old-channel',
        lastEventId: '1',
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      const data = response.data as { events: any[]; refreshNeeded: boolean };
      assert.equal(data.refreshNeeded, true);
      assert.equal(data.events.length, 0);

      client.destroy();
    });
  } finally {
    await server.stop();
  }
}

// ============================================================================
// Replay on Subscribe Tests
// ============================================================================

async function testReplayOnSubscribe() {
  console.log('\nReplay on Subscribe:');

  const socketPath = path.join(os.tmpdir(), `photon-replay-test-${Date.now()}.sock`);
  const server = new MockDaemonServerWithBuffer(socketPath);

  try {
    await server.start();

    await test('subscribe with lastEventId replays missed events', async () => {
      // Publish 5 events before subscribing
      for (let i = 0; i < 5; i++) {
        server.publishDirectly('replay-sub-channel', { index: i });
      }

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Subscribe with lastEventId=2 (should get events 3, 4, 5)
      const request: DaemonRequest = {
        type: 'subscribe',
        id: 'sub_replay',
        channel: 'replay-sub-channel',
        lastEventId: '2',
      };

      client.write(JSON.stringify(request) + '\n');

      // Collect all messages
      const messages: DaemonResponse[] = [];
      await new Promise<void>((resolve) => {
        let buffer = '';
        const timeout = setTimeout(resolve, 200); // Wait for all messages

        client.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              messages.push(JSON.parse(line));
            }
          }
        });
      });

      // Should have replayed events + subscription confirmation
      const replayMessages = messages.filter((m) => m.type === 'channel_message');
      const confirmMessage = messages.find((m) => m.type === 'result');

      assert.ok(replayMessages.length >= 2, `Expected at least 2 replay messages, got ${replayMessages.length}`);
      assert.ok(confirmMessage, 'Should have subscription confirmation');

      client.destroy();
    });

    await test('subscribe with old lastEventId sends refresh_needed', async () => {
      // Publish enough to overflow
      for (let i = 0; i < 15; i++) {
        server.publishDirectly('refresh-channel', { index: i });
      }

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Subscribe with very old lastEventId
      const request: DaemonRequest = {
        type: 'subscribe',
        id: 'sub_refresh',
        channel: 'refresh-channel',
        lastEventId: '1',
      };

      client.write(JSON.stringify(request) + '\n');

      // Collect all messages
      const messages: DaemonResponse[] = [];
      await new Promise<void>((resolve) => {
        let buffer = '';
        setTimeout(resolve, 200);

        client.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              messages.push(JSON.parse(line));
            }
          }
        });
      });

      const refreshMessage = messages.find((m) => m.type === 'refresh_needed');
      assert.ok(refreshMessage, 'Should have received refresh_needed signal');
      assert.equal(refreshMessage!.channel, 'refresh-channel');

      client.destroy();
    });

    await test('subscribe without lastEventId does not replay', async () => {
      // Publish some events
      for (let i = 0; i < 3; i++) {
        server.publishDirectly('no-replay-channel', { index: i });
      }

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Subscribe without lastEventId
      const request: DaemonRequest = {
        type: 'subscribe',
        id: 'sub_no_replay',
        channel: 'no-replay-channel',
      };

      client.write(JSON.stringify(request) + '\n');

      // Collect messages
      const messages: DaemonResponse[] = [];
      await new Promise<void>((resolve) => {
        let buffer = '';
        setTimeout(resolve, 200);

        client.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              messages.push(JSON.parse(line));
            }
          }
        });
      });

      // Should only have confirmation, no replayed events
      const replayMessages = messages.filter((m) => m.type === 'channel_message');
      const confirmMessage = messages.find((m) => m.type === 'result');

      assert.equal(replayMessages.length, 0, 'Should not have replayed messages');
      assert.ok(confirmMessage, 'Should have subscription confirmation');

      client.destroy();
    });
  } finally {
    await server.stop();
  }
}

// ============================================================================
// Multi-Photon Routing Tests
// ============================================================================

async function testPhotonNameRouting() {
  console.log('\nPhotonName Routing:');

  await test('requests can include photonName', () => {
    const request: DaemonRequest = {
      type: 'command',
      id: '1',
      method: 'getBoard',
      photonName: 'kanban',
      args: { board: 'photon' },
    };

    assert.equal(isValidDaemonRequest(request), true);
    assert.equal(request.photonName, 'kanban');
  });

  await test('subscribe can include photonName', () => {
    const request: DaemonRequest = {
      type: 'subscribe',
      id: '1',
      channel: 'board-updates',
      photonName: 'kanban',
      lastEventId: '10',
    };

    assert.equal(isValidDaemonRequest(request), true);
    assert.equal(request.photonName, 'kanban');
    assert.equal(request.lastEventId, '10');
  });

  await test('publish can include photonName', () => {
    const request: DaemonRequest = {
      type: 'publish',
      id: '1',
      channel: 'task-moved',
      message: { taskId: '123', from: 'Todo', to: 'Done' },
      photonName: 'kanban',
    };

    assert.equal(isValidDaemonRequest(request), true);
    assert.equal(request.photonName, 'kanban');
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runTests() {
  console.log('Daemon Event Buffer Tests');
  console.log('==================================================');

  await testNewProtocolFields();
  await testEventBuffer();
  await testReplayOnSubscribe();
  await testPhotonNameRouting();

  console.log('\n==================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nSome tests failed!');
    process.exit(1);
  } else {
    console.log('\nAll daemon event buffer tests passed!');
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
