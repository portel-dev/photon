/**
 * Daemon Pub/Sub Tests
 *
 * Tests for the daemon protocol extensions for channel-based pub/sub
 */

import { strict as assert } from 'assert';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { isValidDaemonRequest, isValidDaemonResponse } from '../src/daemon/protocol.js';
import type { DaemonRequest, DaemonResponse } from '../src/daemon/protocol.js';

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
// Protocol Validation Tests
// ============================================================================

async function testRequestValidation() {
  console.log('\nDaemonRequest Validation:');

  await test('rejects non-objects', () => {
    assert.equal(isValidDaemonRequest(null), false);
    assert.equal(isValidDaemonRequest(undefined), false);
    assert.equal(isValidDaemonRequest('string'), false);
    assert.equal(isValidDaemonRequest(123), false);
  });

  await test('rejects missing id', () => {
    assert.equal(isValidDaemonRequest({ type: 'ping' }), false);
  });

  await test('rejects invalid type', () => {
    assert.equal(isValidDaemonRequest({ type: 'invalid', id: '1' }), false);
  });

  await test('accepts ping request', () => {
    assert.equal(isValidDaemonRequest({ type: 'ping', id: '1' }), true);
  });

  await test('accepts shutdown request', () => {
    assert.equal(isValidDaemonRequest({ type: 'shutdown', id: '1' }), true);
  });

  await test('accepts command with method', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'command', id: '1', method: 'test' }),
      true
    );
  });

  await test('rejects command without method', () => {
    assert.equal(isValidDaemonRequest({ type: 'command', id: '1' }), false);
  });

  await test('accepts subscribe with channel', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'subscribe', id: '1', channel: 'test' }),
      true
    );
  });

  await test('rejects subscribe without channel', () => {
    assert.equal(isValidDaemonRequest({ type: 'subscribe', id: '1' }), false);
  });

  await test('accepts unsubscribe with channel', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'unsubscribe', id: '1', channel: 'test' }),
      true
    );
  });

  await test('rejects unsubscribe without channel', () => {
    assert.equal(isValidDaemonRequest({ type: 'unsubscribe', id: '1' }), false);
  });

  await test('accepts publish with channel', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'publish',
        id: '1',
        channel: 'test',
        message: { data: 'hello' },
      }),
      true
    );
  });

  await test('rejects publish without channel', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'publish', id: '1', message: { data: 'hello' } }),
      false
    );
  });

  await test('accepts prompt_response', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'prompt_response', id: '1', promptValue: 'yes' }),
      true
    );
  });
}

async function testResponseValidation() {
  console.log('\nDaemonResponse Validation:');

  await test('rejects non-objects', () => {
    assert.equal(isValidDaemonResponse(null), false);
    assert.equal(isValidDaemonResponse(undefined), false);
    assert.equal(isValidDaemonResponse('string'), false);
  });

  await test('rejects missing id', () => {
    assert.equal(isValidDaemonResponse({ type: 'result' }), false);
  });

  await test('rejects invalid type', () => {
    assert.equal(isValidDaemonResponse({ type: 'invalid', id: '1' }), false);
  });

  await test('accepts result response', () => {
    assert.equal(
      isValidDaemonResponse({ type: 'result', id: '1', success: true }),
      true
    );
  });

  await test('accepts error response', () => {
    assert.equal(
      isValidDaemonResponse({ type: 'error', id: '1', error: 'failed' }),
      true
    );
  });

  await test('accepts pong response', () => {
    assert.equal(isValidDaemonResponse({ type: 'pong', id: '1' }), true);
  });

  await test('accepts prompt response', () => {
    assert.equal(
      isValidDaemonResponse({
        type: 'prompt',
        id: '1',
        prompt: { type: 'text', message: 'Enter value' },
      }),
      true
    );
  });

  await test('accepts channel_message response', () => {
    assert.equal(
      isValidDaemonResponse({
        type: 'channel_message',
        id: '1',
        channel: 'test',
        message: { event: 'update' },
      }),
      true
    );
  });
}

// ============================================================================
// Mock Server for Integration Tests
// ============================================================================

class MockDaemonServer {
  private server: net.Server;
  private socketPath: string;
  private channelSubscriptions = new Map<string, Set<net.Socket>>();

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
        } catch (err) {
          socket.write(JSON.stringify({ type: 'error', id: 'unknown', error: 'Parse error' }) + '\n');
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
      return { type: 'result', id: request.id, success: true, data: { unsubscribed: true, channel } };
    }

    if (request.type === 'publish') {
      const channel = request.channel!;
      const message = request.message;
      this.publishToSubscribers(channel, message, socket);
      return { type: 'result', id: request.id, success: true, data: { published: true, channel } };
    }

    return { type: 'error', id: request.id, error: `Unknown request type: ${request.type}` };
  }

  private publishToSubscribers(channel: string, message: unknown, excludeSocket: net.Socket) {
    const subs = this.channelSubscriptions.get(channel);
    if (!subs) return;

    const payload = JSON.stringify({
      type: 'channel_message',
      id: `ch_${Date.now()}`,
      channel,
      message,
    }) + '\n';

    for (const socket of subs) {
      if (socket !== excludeSocket && !socket.destroyed) {
        socket.write(payload);
      }
    }
  }

  private cleanupSocket(socket: net.Socket) {
    for (const [channel, subs] of this.channelSubscriptions.entries()) {
      subs.delete(socket);
      if (subs.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }
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

  getSubscriberCount(channel: string): number {
    return this.channelSubscriptions.get(channel)?.size || 0;
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

async function testPubSubIntegration() {
  console.log('\nPub/Sub Integration:');

  const socketPath = path.join(os.tmpdir(), `photon-test-${Date.now()}.sock`);
  const server = new MockDaemonServer(socketPath);

  try {
    await server.start();

    await test('subscribe to channel', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'subscribe',
        id: 'sub_1',
        channel: 'test-channel',
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal(response.success, true);
      assert.deepEqual(response.data, { subscribed: true, channel: 'test-channel' });
      assert.equal(server.getSubscriberCount('test-channel'), 1);

      client.destroy();
    });

    await test('unsubscribe from channel', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Subscribe first
      client.write(JSON.stringify({ type: 'subscribe', id: '1', channel: 'unsub-test' }) + '\n');
      await new Promise<void>((resolve) => {
        client.once('data', () => resolve());
      });

      assert.equal(server.getSubscriberCount('unsub-test'), 1);

      // Now unsubscribe
      client.write(JSON.stringify({ type: 'unsubscribe', id: '2', channel: 'unsub-test' }) + '\n');
      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.deepEqual(response.data, { unsubscribed: true, channel: 'unsub-test' });
      assert.equal(server.getSubscriberCount('unsub-test'), 0);

      client.destroy();
    });

    await test('publish delivers to subscribers', async () => {
      const subscriber = net.createConnection(socketPath);
      const publisher = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((resolve) => subscriber.on('connect', resolve)),
        new Promise<void>((resolve) => publisher.on('connect', resolve)),
      ]);

      // Subscribe
      subscriber.write(JSON.stringify({ type: 'subscribe', id: 's1', channel: 'pub-test' }) + '\n');
      await new Promise<void>((resolve) => {
        subscriber.once('data', () => resolve());
      });

      // Set up message receiver
      const messagePromise = new Promise<DaemonResponse>((resolve) => {
        subscriber.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      // Publish
      publisher.write(
        JSON.stringify({
          type: 'publish',
          id: 'p1',
          channel: 'pub-test',
          message: { event: 'task-moved', taskId: '123' },
        }) + '\n'
      );

      // Wait for publisher confirmation (need to consume it)
      await new Promise<void>((resolve) => {
        publisher.once('data', () => resolve());
      });

      // Check subscriber received the message
      const message = await messagePromise;
      assert.equal(message.type, 'channel_message');
      assert.equal(message.channel, 'pub-test');
      assert.deepEqual(message.message, { event: 'task-moved', taskId: '123' });

      subscriber.destroy();
      publisher.destroy();
    });

    await test('publisher does not receive own message', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Subscribe
      client.write(JSON.stringify({ type: 'subscribe', id: 's1', channel: 'self-test' }) + '\n');
      await new Promise<void>((resolve) => {
        client.once('data', () => resolve());
      });

      // Publish from same client
      client.write(
        JSON.stringify({
          type: 'publish',
          id: 'p1',
          channel: 'self-test',
          message: { test: 'data' },
        }) + '\n'
      );

      // Should only receive the publish confirmation, not the message
      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal(response.id, 'p1');
      assert.deepEqual(response.data, { published: true, channel: 'self-test' });

      client.destroy();
    });

    await test('disconnect cleans up subscriptions', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      client.write(JSON.stringify({ type: 'subscribe', id: '1', channel: 'cleanup-test' }) + '\n');
      await new Promise<void>((resolve) => {
        client.once('data', () => resolve());
      });

      assert.equal(server.getSubscriberCount('cleanup-test'), 1);

      // Disconnect
      client.destroy();

      // Wait a bit for cleanup
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(server.getSubscriberCount('cleanup-test'), 0);
    });

  } finally {
    await server.stop();
    // Clean up socket file
    try {
      await fs.unlink(socketPath);
    } catch {
      // Ignore if already removed
    }
  }
}

// ============================================================================
// Run All Tests
// ============================================================================

(async () => {
  console.log('Daemon Pub/Sub Tests\n' + '='.repeat(50));

  await testRequestValidation();
  await testResponseValidation();
  await testPubSubIntegration();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nAll daemon pub/sub tests passed!');
})();
