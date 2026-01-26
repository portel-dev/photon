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

  await test('accepts reload with photonPath', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'reload', id: '1', photonPath: '/path/to/photon.ts' }),
      true
    );
  });

  await test('rejects reload without photonPath', () => {
    assert.equal(isValidDaemonRequest({ type: 'reload', id: '1' }), false);
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
// Lock Validation Tests
// ============================================================================

async function testLockRequestValidation() {
  console.log('\nLock Request Validation:');

  await test('accepts lock with lockName', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'lock', id: '1', lockName: 'my-lock' }),
      true
    );
  });

  await test('rejects lock without lockName', () => {
    assert.equal(isValidDaemonRequest({ type: 'lock', id: '1' }), false);
  });

  await test('accepts unlock with lockName', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'unlock', id: '1', lockName: 'my-lock' }),
      true
    );
  });

  await test('rejects unlock without lockName', () => {
    assert.equal(isValidDaemonRequest({ type: 'unlock', id: '1' }), false);
  });

  await test('accepts list_locks', () => {
    assert.equal(isValidDaemonRequest({ type: 'list_locks', id: '1' }), true);
  });
}

// ============================================================================
// Scheduled Jobs Validation Tests
// ============================================================================

async function testScheduleRequestValidation() {
  console.log('\nSchedule Request Validation:');

  await test('accepts schedule with all required fields', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'schedule',
        id: '1',
        jobId: 'job-1',
        method: 'myMethod',
        cron: '*/5 * * * *',
      }),
      true
    );
  });

  await test('rejects schedule without jobId', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'schedule',
        id: '1',
        method: 'myMethod',
        cron: '*/5 * * * *',
      }),
      false
    );
  });

  await test('rejects schedule without method', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'schedule',
        id: '1',
        jobId: 'job-1',
        cron: '*/5 * * * *',
      }),
      false
    );
  });

  await test('rejects schedule without cron', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'schedule',
        id: '1',
        jobId: 'job-1',
        method: 'myMethod',
      }),
      false
    );
  });

  await test('accepts unschedule with jobId', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'unschedule', id: '1', jobId: 'job-1' }),
      true
    );
  });

  await test('rejects unschedule without jobId', () => {
    assert.equal(isValidDaemonRequest({ type: 'unschedule', id: '1' }), false);
  });

  await test('accepts list_jobs', () => {
    assert.equal(isValidDaemonRequest({ type: 'list_jobs', id: '1' }), true);
  });
}

// ============================================================================
// Mock Server with Lock & Schedule Support
// ============================================================================

class MockDaemonServerWithLocks {
  private server: net.Server;
  private socketPath: string;
  private channelSubscriptions = new Map<string, Set<net.Socket>>();
  private locks = new Map<string, { holder: string; acquiredAt: number; expiresAt: number }>();
  private reloadCount = 0;
  private jobs = new Map<
    string,
    {
      id: string;
      method: string;
      cron: string;
      args?: Record<string, unknown>;
      nextRun: number;
      lastRun?: number;
      runCount: number;
      createdAt: number;
    }
  >();

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

    // Pub/Sub handlers
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
        if (subs.size === 0) this.channelSubscriptions.delete(channel);
      }
      return { type: 'result', id: request.id, success: true, data: { unsubscribed: true, channel } };
    }

    if (request.type === 'publish') {
      const channel = request.channel!;
      const message = request.message;
      this.publishToSubscribers(channel, message, socket);
      return { type: 'result', id: request.id, success: true, data: { published: true, channel } };
    }

    // Lock handlers
    if (request.type === 'lock') {
      const lockName = request.lockName!;
      const holder = request.sessionId || request.id;
      const timeout = request.lockTimeout || 30000;
      const now = Date.now();

      // Check if lock exists and not expired
      const existing = this.locks.get(lockName);
      if (existing && existing.expiresAt > now && existing.holder !== holder) {
        return { type: 'result', id: request.id, data: { acquired: false, holder: existing.holder } };
      }

      // Acquire lock
      this.locks.set(lockName, {
        holder,
        acquiredAt: now,
        expiresAt: now + timeout,
      });
      return { type: 'result', id: request.id, data: { acquired: true, expiresAt: now + timeout } };
    }

    if (request.type === 'unlock') {
      const lockName = request.lockName!;
      const holder = request.sessionId || request.id;

      const existing = this.locks.get(lockName);
      if (!existing) {
        return { type: 'result', id: request.id, data: { released: false, reason: 'Lock not found' } };
      }
      if (existing.holder !== holder) {
        return { type: 'result', id: request.id, data: { released: false, reason: 'Not lock holder' } };
      }

      this.locks.delete(lockName);
      return { type: 'result', id: request.id, data: { released: true } };
    }

    if (request.type === 'list_locks') {
      const now = Date.now();
      const activeLocks = Array.from(this.locks.entries())
        .filter(([_, lock]) => lock.expiresAt > now)
        .map(([name, lock]) => ({ name, ...lock }));
      return { type: 'result', id: request.id, data: { locks: activeLocks } };
    }

    // Schedule handlers
    if (request.type === 'schedule') {
      const { jobId, method, cron, args } = request;
      const now = Date.now();

      // Simple next run calculation (just add 60s for testing)
      const nextRun = now + 60000;

      this.jobs.set(jobId!, {
        id: jobId!,
        method: method!,
        cron: cron!,
        args,
        nextRun,
        runCount: 0,
        createdAt: now,
      });

      return { type: 'result', id: request.id, data: { scheduled: true, nextRun } };
    }

    if (request.type === 'unschedule') {
      const { jobId } = request;
      const existed = this.jobs.has(jobId!);
      this.jobs.delete(jobId!);
      return { type: 'result', id: request.id, data: { unscheduled: existed } };
    }

    if (request.type === 'list_jobs') {
      const jobList = Array.from(this.jobs.values());
      return { type: 'result', id: request.id, data: { jobs: jobList } };
    }

    // Reload handler
    if (request.type === 'reload') {
      const photonPath = request.photonPath;
      if (!photonPath) {
        return { type: 'result', id: request.id, success: false, data: { error: 'Missing photonPath' } };
      }
      // Simulate reload - in real daemon this re-imports the module
      this.reloadCount++;
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: { message: 'Reload complete', sessionsUpdated: 1, reloadCount: this.reloadCount },
      };
    }

    return { type: 'error', id: request.id, error: `Unknown request type: ${request.type}` };
  }

  private publishToSubscribers(channel: string, message: unknown, excludeSocket: net.Socket) {
    const subs = this.channelSubscriptions.get(channel);
    if (!subs) return;

    const payload =
      JSON.stringify({
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
      if (subs.size === 0) this.channelSubscriptions.delete(channel);
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

  getLockCount(): number {
    return this.locks.size;
  }

  getJobCount(): number {
    return this.jobs.size;
  }

  getReloadCount(): number {
    return this.reloadCount;
  }
}

// ============================================================================
// Lock Integration Tests
// ============================================================================

async function testLockIntegration() {
  console.log('\nLock Integration:');

  const socketPath = path.join(os.tmpdir(), `photon-lock-test-${Date.now()}.sock`);
  const server = new MockDaemonServerWithLocks(socketPath);

  try {
    await server.start();

    await test('acquire lock', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'lock',
        id: 'lock_1',
        sessionId: 'session-a',
        lockName: 'my-resource',
        lockTimeout: 5000,
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).acquired, true);
      assert.equal(server.getLockCount(), 1);

      client.destroy();
    });

    await test('second client fails to acquire same lock', async () => {
      const client1 = net.createConnection(socketPath);
      const client2 = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((resolve) => client1.on('connect', resolve)),
        new Promise<void>((resolve) => client2.on('connect', resolve)),
      ]);

      // Client 1 acquires lock
      client1.write(
        JSON.stringify({
          type: 'lock',
          id: 'l1',
          sessionId: 'session-1',
          lockName: 'exclusive-resource',
        }) + '\n'
      );
      await new Promise<void>((resolve) => client1.once('data', resolve));

      // Client 2 tries to acquire same lock
      client2.write(
        JSON.stringify({
          type: 'lock',
          id: 'l2',
          sessionId: 'session-2',
          lockName: 'exclusive-resource',
        }) + '\n'
      );

      const response = await new Promise<DaemonResponse>((resolve) => {
        client2.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).acquired, false);
      assert.equal((response.data as any).holder, 'session-1');

      client1.destroy();
      client2.destroy();
    });

    await test('release lock', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Acquire
      client.write(
        JSON.stringify({
          type: 'lock',
          id: 'l1',
          sessionId: 'release-test',
          lockName: 'release-lock',
        }) + '\n'
      );
      await new Promise<void>((resolve) => client.once('data', resolve));

      // Release
      client.write(
        JSON.stringify({
          type: 'unlock',
          id: 'u1',
          sessionId: 'release-test',
          lockName: 'release-lock',
        }) + '\n'
      );

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).released, true);

      client.destroy();
    });

    await test('cannot release lock held by another', async () => {
      const client1 = net.createConnection(socketPath);
      const client2 = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((resolve) => client1.on('connect', resolve)),
        new Promise<void>((resolve) => client2.on('connect', resolve)),
      ]);

      // Client 1 acquires
      client1.write(
        JSON.stringify({
          type: 'lock',
          id: 'l1',
          sessionId: 'holder',
          lockName: 'guarded-lock',
        }) + '\n'
      );
      await new Promise<void>((resolve) => client1.once('data', resolve));

      // Client 2 tries to release
      client2.write(
        JSON.stringify({
          type: 'unlock',
          id: 'u1',
          sessionId: 'thief',
          lockName: 'guarded-lock',
        }) + '\n'
      );

      const response = await new Promise<DaemonResponse>((resolve) => {
        client2.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).released, false);
      assert.equal((response.data as any).reason, 'Not lock holder');

      client1.destroy();
      client2.destroy();
    });

    await test('list active locks', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      client.write(JSON.stringify({ type: 'list_locks', id: 'list_1' }) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.ok(Array.isArray((response.data as any).locks));

      client.destroy();
    });
  } finally {
    await server.stop();
    try {
      await fs.unlink(socketPath);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Schedule Integration Tests
// ============================================================================

async function testScheduleIntegration() {
  console.log('\nSchedule Integration:');

  const socketPath = path.join(os.tmpdir(), `photon-schedule-test-${Date.now()}.sock`);
  const server = new MockDaemonServerWithLocks(socketPath);

  try {
    await server.start();

    await test('schedule a job', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'schedule',
        id: 'sched_1',
        jobId: 'cleanup-job',
        method: 'cleanupOldTasks',
        cron: '0 * * * *',
        args: { maxAge: 86400 },
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).scheduled, true);
      assert.ok((response.data as any).nextRun > Date.now());
      assert.equal(server.getJobCount(), 1);

      client.destroy();
    });

    await test('list scheduled jobs', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      client.write(JSON.stringify({ type: 'list_jobs', id: 'list_1' }) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      const jobs = (response.data as any).jobs as any[];
      assert.ok(Array.isArray(jobs));
      assert.ok(jobs.length >= 1);
      assert.equal(jobs[0].method, 'cleanupOldTasks');

      client.destroy();
    });

    await test('unschedule a job', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      client.write(
        JSON.stringify({
          type: 'unschedule',
          id: 'unsched_1',
          jobId: 'cleanup-job',
        }) + '\n'
      );

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).unscheduled, true);
      assert.equal(server.getJobCount(), 0);

      client.destroy();
    });

    await test('unschedule non-existent job returns false', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      client.write(
        JSON.stringify({
          type: 'unschedule',
          id: 'unsched_2',
          jobId: 'non-existent-job',
        }) + '\n'
      );

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).unscheduled, false);

      client.destroy();
    });
  } finally {
    await server.stop();
    try {
      await fs.unlink(socketPath);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Reload Integration Tests
// ============================================================================

async function testReloadIntegration() {
  console.log('\nReload Integration:');

  const socketPath = path.join(os.tmpdir(), `photon-reload-test-${Date.now()}.sock`);
  const server = new MockDaemonServerWithLocks(socketPath);

  try {
    await server.start();

    await test('reload photon', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'reload',
        id: 'reload_1',
        photonPath: '/path/to/test.photon.ts',
      };

      client.write(JSON.stringify(request) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.type, 'result');
      assert.equal(response.success, true);
      assert.equal((response.data as any).message, 'Reload complete');
      assert.equal((response.data as any).sessionsUpdated, 1);
      assert.equal(server.getReloadCount(), 1);

      client.destroy();
    });

    await test('reload increments count', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Send two reload requests
      client.write(
        JSON.stringify({ type: 'reload', id: 'r1', photonPath: '/path/test.ts' }) + '\n'
      );
      await new Promise<void>((resolve) => client.once('data', resolve));

      client.write(
        JSON.stringify({ type: 'reload', id: 'r2', photonPath: '/path/test.ts' }) + '\n'
      );
      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      assert.equal(response.success, true);
      assert.equal((response.data as any).reloadCount, 3); // 1 from previous test + 2 from this test

      client.destroy();
    });

    await test('reload preserves subscriptions', async () => {
      const subscriber = net.createConnection(socketPath);
      const reloader = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((resolve) => subscriber.on('connect', resolve)),
        new Promise<void>((resolve) => reloader.on('connect', resolve)),
      ]);

      // Subscribe to a channel
      subscriber.write(
        JSON.stringify({ type: 'subscribe', id: 's1', channel: 'test-reload-channel' }) + '\n'
      );
      await new Promise<void>((resolve) => subscriber.once('data', resolve));

      // Trigger reload
      reloader.write(
        JSON.stringify({ type: 'reload', id: 'r1', photonPath: '/path/test.ts' }) + '\n'
      );
      await new Promise<void>((resolve) => reloader.once('data', resolve));

      // Set up message receiver
      const messagePromise = new Promise<DaemonResponse>((resolve) => {
        subscriber.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      // Publish after reload - subscription should still work
      reloader.write(
        JSON.stringify({
          type: 'publish',
          id: 'p1',
          channel: 'test-reload-channel',
          message: { event: 'post-reload' },
        }) + '\n'
      );

      // Wait for publish confirmation
      await new Promise<void>((resolve) => reloader.once('data', resolve));

      // Check subscriber received the message
      const message = await messagePromise;
      assert.equal(message.type, 'channel_message');
      assert.equal(message.channel, 'test-reload-channel');
      assert.deepEqual(message.message, { event: 'post-reload' });

      subscriber.destroy();
      reloader.destroy();
    });

    await test('reload preserves locks', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      // Acquire a lock
      client.write(
        JSON.stringify({
          type: 'lock',
          id: 'l1',
          sessionId: 'lock-holder',
          lockName: 'reload-test-lock',
        }) + '\n'
      );
      const lockResponse = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });
      assert.equal((lockResponse.data as any).acquired, true);

      // Trigger reload
      client.write(
        JSON.stringify({ type: 'reload', id: 'r1', photonPath: '/path/test.ts' }) + '\n'
      );
      await new Promise<void>((resolve) => client.once('data', resolve));

      // Check lock still exists
      client.write(JSON.stringify({ type: 'list_locks', id: 'list_1' }) + '\n');
      const listResponse = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => {
          resolve(JSON.parse(chunk.toString().trim()));
        });
      });

      const locks = (listResponse.data as any).locks as any[];
      const ourLock = locks.find((l: any) => l.name === 'reload-test-lock');
      assert.ok(ourLock, 'Lock should still exist after reload');
      assert.equal(ourLock.holder, 'lock-holder');

      client.destroy();
    });
  } finally {
    await server.stop();
    try {
      await fs.unlink(socketPath);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Run All Tests
// ============================================================================

(async () => {
  console.log('Daemon Protocol Tests\n' + '='.repeat(50));

  await testRequestValidation();
  await testResponseValidation();
  await testLockRequestValidation();
  await testScheduleRequestValidation();
  await testPubSubIntegration();
  await testLockIntegration();
  await testScheduleIntegration();
  await testReloadIntegration();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nAll daemon protocol tests passed!');
})();
