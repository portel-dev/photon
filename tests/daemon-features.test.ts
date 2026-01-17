/**
 * Daemon Features Tests - "Four Power Terms"
 *
 * Comprehensive tests demonstrating:
 * 1. Instant Hooks - Webhooks via @webhook tag and handle* prefix
 * 2. Pulse Jobs - Scheduled tasks via @scheduled/@cron tags
 * 3. Guard Tags - Distributed locks via @locked tag
 * 4. Live Channels - Real-time pub/sub via emit() with channels
 */

import { strict as assert } from 'assert';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { SchemaExtractor } from '@portel/photon-core';
import { isValidDaemonRequest, isValidDaemonResponse } from '../src/daemon/protocol.js';
import type { DaemonRequest, DaemonResponse, ExtractedSchema } from '../src/daemon/protocol.js';

// Track test results
let passed = 0;
let failed = 0;
let currentSection = '';

function section(name: string) {
  currentSection = name;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(60)}`);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ============================================================================
// FIXTURE: Demo Photon Class with All Four Features
// ============================================================================

const DEMO_PHOTON_SOURCE = `
/**
 * Task Management Photon
 *
 * Demonstrates all four daemon power features:
 * - Instant Hooks (webhooks)
 * - Pulse Jobs (scheduled tasks)
 * - Guard Tags (distributed locks)
 * - Live Channels (pub/sub)
 */
export default class TaskManager {
  // ═══════════════════════════════════════════════════════════════════════
  // INSTANT HOOKS - Webhooks
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Handle GitHub push events
   * Auto-detected as webhook from handle* prefix
   */
  async handleGithubPush(params: { commits: any[]; repository: any }) {
    return { processed: params.commits.length };
  }

  /**
   * Handle Stripe payment webhook
   * @webhook stripe/payments
   */
  async processStripePayment(params: { event: any; data: any }) {
    return { status: 'processed' };
  }

  /**
   * Generic webhook endpoint
   * @webhook
   */
  async receiveWebhook(params: { source: string; payload: any }) {
    return { received: true, source: params.source };
  }

  /**
   * Handle Slack commands
   * @webhook slack/commands
   * @locked slack:commands
   */
  async handleSlackCommand(params: { command: string; text: string }) {
    return { response: 'Command received' };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PULSE JOBS - Scheduled Tasks
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Archive completed tasks daily at midnight
   * @scheduled 0 0 * * *
   */
  async scheduledArchiveTasks(params: {}) {
    return { archived: 42 };
  }

  /**
   * Generate weekly report every Monday at 9 AM
   * @cron 0 9 * * 1
   */
  async generateWeeklyReport(params: {}) {
    return { report: 'generated' };
  }

  /**
   * Cleanup expired sessions every hour
   * @scheduled 0 * * * *
   * @locked cleanup:sessions
   */
  async cleanupExpiredSessions(params: {}) {
    return { cleaned: 100 };
  }

  /**
   * Send digest emails at 6 PM on weekdays
   * @cron 0 18 * * 1-5
   */
  async sendDailyDigest(params: {}) {
    return { sent: 500 };
  }

  /**
   * Sync data every 15 minutes during business hours
   * @scheduled 0,15,30,45 9-17 * * 1-5
   */
  async syncBusinessData(params: {}) {
    return { synced: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GUARD TAGS - Distributed Locks
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update board with exclusive access
   * @locked
   */
  async updateBoard(params: { boardId: string; data: any }) {
    return { updated: true };
  }

  /**
   * Batch move tasks with board-level lock
   * @locked board:write
   */
  async batchMoveTasks(params: { boardId: string; taskIds: string[]; column: string }) {
    return { moved: params.taskIds.length };
  }

  /**
   * Process payment with transaction lock
   * @locked payment:process
   * @webhook payments/process
   */
  async processPayment(params: { orderId: string; amount: number }) {
    return { processed: true, orderId: params.orderId };
  }

  /**
   * Update inventory with SKU-level lock
   * @locked inventory:update
   */
  async updateInventory(params: { sku: string; quantity: number }) {
    return { sku: params.sku, newQuantity: params.quantity };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REGULAR METHODS (No daemon features)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * List all tasks (no daemon features)
   * @format table
   */
  async listTasks(params: { boardId?: string }) {
    return [];
  }

  /**
   * Get task details (no daemon features)
   */
  async getTask(params: { taskId: string }) {
    return { id: params.taskId };
  }
}
`;

// ============================================================================
// PART 1: INSTANT HOOKS - Schema Extraction Tests
// ============================================================================

async function testInstantHooks() {
  section('1. INSTANT HOOKS - Webhook Detection');

  const extractor = new SchemaExtractor();
  const { tools } = extractor.extractAllFromSource(DEMO_PHOTON_SOURCE);

  // Create lookup map
  const toolMap = new Map<string, ExtractedSchema>();
  tools.forEach((t) => toolMap.set(t.name, t));

  await test('handle* prefix auto-detects as webhook', () => {
    const tool = toolMap.get('handleGithubPush');
    assert.ok(tool, 'handleGithubPush should exist');
    assert.equal((tool as any).webhook, true, 'Should have webhook=true');
  });

  await test('@webhook with custom path extracts path', () => {
    const tool = toolMap.get('processStripePayment');
    assert.ok(tool, 'processStripePayment should exist');
    assert.equal((tool as any).webhook, 'stripe/payments', 'Should have custom webhook path');
  });

  await test('bare @webhook tag returns true', () => {
    const tool = toolMap.get('receiveWebhook');
    assert.ok(tool, 'receiveWebhook should exist');
    assert.equal((tool as any).webhook, true, 'Should have webhook=true');
  });

  await test('webhook combined with lock', () => {
    const tool = toolMap.get('handleSlackCommand');
    assert.ok(tool, 'handleSlackCommand should exist');
    assert.equal((tool as any).webhook, 'slack/commands', 'Should have webhook path');
    assert.equal((tool as any).locked, 'slack:commands', 'Should have lock name');
  });

  await test('regular method has no webhook property', () => {
    const tool = toolMap.get('listTasks');
    assert.ok(tool, 'listTasks should exist');
    assert.equal((tool as any).webhook, undefined, 'Should not have webhook');
  });

  await test('counts webhooks correctly', () => {
    const webhooks = tools.filter((t) => (t as any).webhook !== undefined);
    assert.equal(webhooks.length, 5, 'Should have 5 webhook methods');
  });

  // Summary
  console.log('\n  Webhooks found:');
  tools
    .filter((t) => (t as any).webhook !== undefined)
    .forEach((t) => {
      const path = (t as any).webhook === true ? `/${t.name}` : `/${(t as any).webhook}`;
      console.log(`    POST /webhook${path} → ${t.name}()`);
    });
}

// ============================================================================
// PART 2: PULSE JOBS - Scheduled Task Tests
// ============================================================================

async function testPulseJobs() {
  section('2. PULSE JOBS - Scheduled Task Detection');

  const extractor = new SchemaExtractor();
  const { tools } = extractor.extractAllFromSource(DEMO_PHOTON_SOURCE);

  const toolMap = new Map<string, ExtractedSchema>();
  tools.forEach((t) => toolMap.set(t.name, t));

  await test('@scheduled extracts daily cron (0 0 * * *)', () => {
    const tool = toolMap.get('scheduledArchiveTasks');
    assert.ok(tool, 'scheduledArchiveTasks should exist');
    assert.equal((tool as any).scheduled, '0 0 * * *', 'Should have daily cron');
  });

  await test('@cron extracts weekly cron (0 9 * * 1)', () => {
    const tool = toolMap.get('generateWeeklyReport');
    assert.ok(tool, 'generateWeeklyReport should exist');
    assert.equal((tool as any).scheduled, '0 9 * * 1', 'Should have weekly cron');
  });

  await test('scheduled + locked combination', () => {
    const tool = toolMap.get('cleanupExpiredSessions');
    assert.ok(tool, 'cleanupExpiredSessions should exist');
    assert.equal((tool as any).scheduled, '0 * * * *', 'Should have hourly cron');
    assert.equal((tool as any).locked, 'cleanup:sessions', 'Should have lock');
  });

  await test('weekday cron (1-5)', () => {
    const tool = toolMap.get('sendDailyDigest');
    assert.ok(tool, 'sendDailyDigest should exist');
    assert.equal((tool as any).scheduled, '0 18 * * 1-5', 'Should have weekday cron');
  });

  await test('complex cron with lists and ranges', () => {
    const tool = toolMap.get('syncBusinessData');
    assert.ok(tool, 'syncBusinessData should exist');
    assert.equal(
      (tool as any).scheduled,
      '0,15,30,45 9-17 * * 1-5',
      'Should have complex cron'
    );
  });

  await test('regular method has no scheduled property', () => {
    const tool = toolMap.get('getTask');
    assert.ok(tool, 'getTask should exist');
    assert.equal((tool as any).scheduled, undefined, 'Should not have scheduled');
  });

  await test('counts scheduled jobs correctly', () => {
    const scheduled = tools.filter((t) => (t as any).scheduled !== undefined);
    assert.equal(scheduled.length, 5, 'Should have 5 scheduled methods');
  });

  // Summary
  console.log('\n  Scheduled jobs found:');
  tools
    .filter((t) => (t as any).scheduled !== undefined)
    .forEach((t) => {
      console.log(`    ${(t as any).scheduled.padEnd(25)} → ${t.name}()`);
    });
}

// ============================================================================
// PART 3: GUARD TAGS - Distributed Lock Tests
// ============================================================================

async function testGuardTags() {
  section('3. GUARD TAGS - Distributed Lock Detection');

  const extractor = new SchemaExtractor();
  const { tools } = extractor.extractAllFromSource(DEMO_PHOTON_SOURCE);

  const toolMap = new Map<string, ExtractedSchema>();
  tools.forEach((t) => toolMap.set(t.name, t));

  await test('bare @locked uses method name', () => {
    const tool = toolMap.get('updateBoard');
    assert.ok(tool, 'updateBoard should exist');
    assert.equal((tool as any).locked, true, 'Should have locked=true');
  });

  await test('@locked with custom name', () => {
    const tool = toolMap.get('batchMoveTasks');
    assert.ok(tool, 'batchMoveTasks should exist');
    assert.equal((tool as any).locked, 'board:write', 'Should have custom lock name');
  });

  await test('locked + webhook combination', () => {
    const tool = toolMap.get('processPayment');
    assert.ok(tool, 'processPayment should exist');
    assert.equal((tool as any).locked, 'payment:process', 'Should have lock');
    assert.equal((tool as any).webhook, 'payments/process', 'Should have webhook');
  });

  await test('inventory lock', () => {
    const tool = toolMap.get('updateInventory');
    assert.ok(tool, 'updateInventory should exist');
    assert.equal((tool as any).locked, 'inventory:update', 'Should have lock');
  });

  await test('regular method has no locked property', () => {
    const tool = toolMap.get('listTasks');
    assert.ok(tool, 'listTasks should exist');
    assert.equal((tool as any).locked, undefined, 'Should not have locked');
  });

  await test('counts locked methods correctly', () => {
    const locked = tools.filter((t) => (t as any).locked !== undefined);
    assert.equal(locked.length, 6, 'Should have 6 locked methods');
  });

  // Summary
  console.log('\n  Locked methods found:');
  tools
    .filter((t) => (t as any).locked !== undefined)
    .forEach((t) => {
      const lockName = (t as any).locked === true ? t.name : (t as any).locked;
      console.log(`    lock("${lockName}") → ${t.name}()`);
    });
}

// ============================================================================
// PART 4: LIVE CHANNELS - Pub/Sub Integration Tests
// ============================================================================

class MockPubSubServer {
  private server: net.Server;
  private socketPath: string;
  private channels = new Map<string, Set<net.Socket>>();
  private messageLog: Array<{ channel: string; message: any; timestamp: number }> = [];

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
          this.handleRequest(request, socket);
        } catch {
          socket.write(JSON.stringify({ type: 'error', id: 'unknown', error: 'Parse error' }) + '\n');
        }
      }
    });

    socket.on('end', () => this.cleanup(socket));
    socket.on('error', () => this.cleanup(socket));
  }

  private handleRequest(request: DaemonRequest, socket: net.Socket) {
    let response: DaemonResponse;

    switch (request.type) {
      case 'ping':
        response = { type: 'pong', id: request.id };
        break;

      case 'subscribe': {
        const channel = request.channel!;
        if (!this.channels.has(channel)) {
          this.channels.set(channel, new Set());
        }
        this.channels.get(channel)!.add(socket);
        response = {
          type: 'result',
          id: request.id,
          success: true,
          data: { subscribed: true, channel, subscribers: this.channels.get(channel)!.size },
        };
        break;
      }

      case 'unsubscribe': {
        const channel = request.channel!;
        this.channels.get(channel)?.delete(socket);
        if (this.channels.get(channel)?.size === 0) {
          this.channels.delete(channel);
        }
        response = { type: 'result', id: request.id, success: true, data: { unsubscribed: true } };
        break;
      }

      case 'publish': {
        const channel = request.channel!;
        const message = request.message;
        this.messageLog.push({ channel, message, timestamp: Date.now() });

        // Broadcast to all subscribers except sender
        const subscribers = this.channels.get(channel);
        let delivered = 0;
        if (subscribers) {
          const payload =
            JSON.stringify({
              type: 'channel_message',
              id: `msg_${Date.now()}`,
              channel,
              message,
            }) + '\n';

          for (const sub of subscribers) {
            if (sub !== socket && !sub.destroyed) {
              sub.write(payload);
              delivered++;
            }
          }
        }
        response = {
          type: 'result',
          id: request.id,
          success: true,
          data: { published: true, channel, delivered },
        };
        break;
      }

      default:
        response = { type: 'error', id: request.id, error: `Unknown type: ${request.type}` };
    }

    socket.write(JSON.stringify(response) + '\n');
  }

  private cleanup(socket: net.Socket) {
    for (const subs of this.channels.values()) {
      subs.delete(socket);
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, () => resolve());
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  getSubscriberCount(channel: string): number {
    return this.channels.get(channel)?.size || 0;
  }

  getMessageLog() {
    return this.messageLog;
  }
}

async function testLiveChannels() {
  section('4. LIVE CHANNELS - Pub/Sub Integration');

  const socketPath = path.join(os.tmpdir(), `photon-pubsub-${Date.now()}.sock`);
  const server = new MockPubSubServer(socketPath);

  try {
    await server.start();

    await test('subscribe to board channel', async () => {
      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      client.write(JSON.stringify({ type: 'subscribe', id: 's1', channel: 'board:kanban' }) + '\n');

      const response = await new Promise<DaemonResponse>((resolve) => {
        client.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      });

      assert.equal(response.type, 'result');
      assert.equal((response.data as any).subscribed, true);
      assert.equal(server.getSubscriberCount('board:kanban'), 1);

      client.destroy();
    });

    await test('publish task-moved event to subscribers', async () => {
      const subscriber = net.createConnection(socketPath);
      const publisher = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((r) => subscriber.on('connect', r)),
        new Promise<void>((r) => publisher.on('connect', r)),
      ]);

      // Subscribe
      subscriber.write(JSON.stringify({ type: 'subscribe', id: 's1', channel: 'board:tasks' }) + '\n');
      await new Promise<void>((r) => subscriber.once('data', () => r()));

      // Set up message receiver
      const messagePromise = new Promise<DaemonResponse>((resolve) => {
        subscriber.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      });

      // Publish task-moved event
      publisher.write(
        JSON.stringify({
          type: 'publish',
          id: 'p1',
          channel: 'board:tasks',
          message: {
            event: 'task-moved',
            taskId: 'task-123',
            from: 'Todo',
            to: 'In Progress',
          },
        }) + '\n'
      );

      await new Promise<void>((r) => publisher.once('data', () => r()));

      const message = await messagePromise;
      assert.equal(message.type, 'channel_message');
      assert.equal(message.channel, 'board:tasks');
      assert.equal((message.message as any).event, 'task-moved');
      assert.equal((message.message as any).taskId, 'task-123');

      subscriber.destroy();
      publisher.destroy();
    });

    await test('multiple subscribers receive same message', async () => {
      const sub1 = net.createConnection(socketPath);
      const sub2 = net.createConnection(socketPath);
      const pub = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((r) => sub1.on('connect', r)),
        new Promise<void>((r) => sub2.on('connect', r)),
        new Promise<void>((r) => pub.on('connect', r)),
      ]);

      // Both subscribe
      sub1.write(JSON.stringify({ type: 'subscribe', id: 's1', channel: 'broadcast' }) + '\n');
      sub2.write(JSON.stringify({ type: 'subscribe', id: 's2', channel: 'broadcast' }) + '\n');

      await Promise.all([
        new Promise<void>((r) => sub1.once('data', () => r())),
        new Promise<void>((r) => sub2.once('data', () => r())),
      ]);

      assert.equal(server.getSubscriberCount('broadcast'), 2);

      // Set up receivers
      const msg1Promise = new Promise<DaemonResponse>((resolve) => {
        sub1.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      });
      const msg2Promise = new Promise<DaemonResponse>((resolve) => {
        sub2.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      });

      // Publish
      pub.write(
        JSON.stringify({
          type: 'publish',
          id: 'p1',
          channel: 'broadcast',
          message: { event: 'board-update', board: 'kanban' },
        }) + '\n'
      );

      await new Promise<void>((r) => pub.once('data', () => r()));

      const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

      assert.equal(msg1.type, 'channel_message');
      assert.equal(msg2.type, 'channel_message');
      assert.deepEqual((msg1.message as any).event, 'board-update');
      assert.deepEqual((msg2.message as any).event, 'board-update');

      sub1.destroy();
      sub2.destroy();
      pub.destroy();
    });

    await test('unsubscribe stops receiving messages', async () => {
      const client = net.createConnection(socketPath);
      const pub = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((r) => client.on('connect', r)),
        new Promise<void>((r) => pub.on('connect', r)),
      ]);

      // Subscribe
      client.write(JSON.stringify({ type: 'subscribe', id: 's1', channel: 'temp' }) + '\n');
      await new Promise<void>((r) => client.once('data', () => r()));

      // Unsubscribe
      client.write(JSON.stringify({ type: 'unsubscribe', id: 'u1', channel: 'temp' }) + '\n');
      await new Promise<void>((r) => client.once('data', () => r()));

      assert.equal(server.getSubscriberCount('temp'), 0);

      client.destroy();
      pub.destroy();
    });

    await test('cross-process emit simulation (MCP → BEAM)', async () => {
      // Simulate: MCP process publishes, BEAM process receives
      const beamClient = net.createConnection(socketPath);
      const mcpClient = net.createConnection(socketPath);

      await Promise.all([
        new Promise<void>((r) => beamClient.on('connect', r)),
        new Promise<void>((r) => mcpClient.on('connect', r)),
      ]);

      // BEAM subscribes to board updates
      beamClient.write(
        JSON.stringify({ type: 'subscribe', id: 'beam_sub', channel: 'board:my-project' }) + '\n'
      );
      await new Promise<void>((r) => beamClient.once('data', () => r()));

      // Set up BEAM to receive
      const beamReceivePromise = new Promise<DaemonResponse>((resolve) => {
        beamClient.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      });

      // MCP (Claude) moves a task
      mcpClient.write(
        JSON.stringify({
          type: 'publish',
          id: 'mcp_emit',
          channel: 'board:my-project',
          message: {
            event: 'task-moved',
            taskId: 'TASK-456',
            column: 'Done',
            movedBy: 'claude',
          },
        }) + '\n'
      );

      // MCP gets confirmation
      const mcpResponse = await new Promise<DaemonResponse>((resolve) => {
        mcpClient.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      });

      assert.equal(mcpResponse.type, 'result');
      assert.equal((mcpResponse.data as any).published, true);
      assert.equal((mcpResponse.data as any).delivered, 1);

      // BEAM receives the update
      const beamMessage = await beamReceivePromise;
      assert.equal(beamMessage.type, 'channel_message');
      assert.equal((beamMessage.message as any).event, 'task-moved');
      assert.equal((beamMessage.message as any).movedBy, 'claude');

      beamClient.destroy();
      mcpClient.destroy();
    });

    // Summary
    console.log('\n  Message log:');
    server.getMessageLog().forEach((m) => {
      console.log(`    [${m.channel}] ${JSON.stringify(m.message)}`);
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
// PART 5: COMBINED FEATURES - Real-World Scenarios
// ============================================================================

async function testRealWorldScenarios() {
  section('5. REAL-WORLD SCENARIOS - Combined Features');

  const extractor = new SchemaExtractor();

  // Scenario: E-commerce Order Processing
  const ecommercePhoton = `
  export default class OrderProcessor {
    /**
     * Handle Stripe payment webhook
     * @webhook stripe/payment
     * @locked order:payment
     */
    async handleStripePayment(params: { orderId: string; event: any }) {
      // Webhook + Lock: Ensure payment processed exactly once
      return { processed: true };
    }

    /**
     * Process pending orders every 5 minutes
     * @scheduled 0,5,10,15,20,25,30,35,40,45,50,55 * * * *
     * @locked order:batch
     */
    async processPendingOrders(params: {}) {
      // Scheduled + Lock: Batch process without overlap
      return { processed: 10 };
    }

    /**
     * Handle inventory webhook from warehouse
     * @webhook warehouse/inventory
     */
    async handleInventoryUpdate(params: { sku: string; quantity: number }) {
      // Webhook: Real-time inventory sync
      // Would emit to channel: inventory:{sku}
      return { updated: true };
    }

    /**
     * Generate daily sales report
     * @scheduled 0 23 * * *
     */
    async generateDailySalesReport(params: {}) {
      // Scheduled: End-of-day reporting
      return { report: 'generated' };
    }
  }
  `;

  await test('E-commerce: webhook + lock for payments', () => {
    const { tools } = extractor.extractAllFromSource(ecommercePhoton);
    const paymentHandler = tools.find((t) => t.name === 'handleStripePayment');

    assert.ok(paymentHandler);
    assert.equal((paymentHandler as any).webhook, 'stripe/payment');
    assert.equal((paymentHandler as any).locked, 'order:payment');
  });

  await test('E-commerce: scheduled + lock for batch processing', () => {
    const { tools } = extractor.extractAllFromSource(ecommercePhoton);
    const batchProcessor = tools.find((t) => t.name === 'processPendingOrders');

    assert.ok(batchProcessor);
    assert.ok((batchProcessor as any).scheduled);
    assert.equal((batchProcessor as any).locked, 'order:batch');
  });

  // Scenario: CI/CD Pipeline
  const cicdPhoton = `
  export default class CIPipeline {
    /**
     * Handle GitHub push events
     */
    async handleGithubPush(params: { commits: any[]; ref: string }) {
      // Auto-detected webhook from handle* prefix
      return { triggered: true };
    }

    /**
     * Handle GitHub PR events
     * @webhook github/pull-request
     * @locked ci:pr
     */
    async handlePullRequest(params: { action: string; pull_request: any }) {
      // Webhook + Lock: One PR build at a time per repo
      return { building: true };
    }

    /**
     * Cleanup old build artifacts nightly
     * @scheduled 0 3 * * *
     * @locked ci:cleanup
     */
    async cleanupArtifacts(params: {}) {
      return { cleaned: 50 };
    }
  }
  `;

  await test('CI/CD: handle* prefix auto-detection', () => {
    const { tools } = extractor.extractAllFromSource(cicdPhoton);
    const pushHandler = tools.find((t) => t.name === 'handleGithubPush');

    assert.ok(pushHandler);
    assert.equal((pushHandler as any).webhook, true);
  });

  await test('CI/CD: PR handler with webhook + lock', () => {
    const { tools } = extractor.extractAllFromSource(cicdPhoton);
    const prHandler = tools.find((t) => t.name === 'handlePullRequest');

    assert.ok(prHandler);
    assert.equal((prHandler as any).webhook, 'github/pull-request');
    assert.equal((prHandler as any).locked, 'ci:pr');
  });

  // Summary statistics
  console.log('\n  Feature combinations found:');
  const allTools = extractor.extractAllFromSource(DEMO_PHOTON_SOURCE).tools;

  const webhookOnly = allTools.filter(
    (t) => (t as any).webhook && !(t as any).scheduled && !(t as any).locked
  );
  const scheduledOnly = allTools.filter(
    (t) => (t as any).scheduled && !(t as any).webhook && !(t as any).locked
  );
  const lockedOnly = allTools.filter(
    (t) => (t as any).locked && !(t as any).webhook && !(t as any).scheduled
  );
  const webhookLocked = allTools.filter((t) => (t as any).webhook && (t as any).locked);
  const scheduledLocked = allTools.filter((t) => (t as any).scheduled && (t as any).locked);

  console.log(`    Webhook only:     ${webhookOnly.length}`);
  console.log(`    Scheduled only:   ${scheduledOnly.length}`);
  console.log(`    Locked only:      ${lockedOnly.length}`);
  console.log(`    Webhook + Lock:   ${webhookLocked.length}`);
  console.log(`    Scheduled + Lock: ${scheduledLocked.length}`);
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         PHOTON DAEMON - FOUR POWER FEATURES TESTS            ║');
  console.log('║                                                              ║');
  console.log('║  1. Instant Hooks  - Webhooks via @webhook / handle*         ║');
  console.log('║  2. Pulse Jobs     - Scheduled tasks via @scheduled/@cron    ║');
  console.log('║  3. Guard Tags     - Distributed locks via @locked           ║');
  console.log('║  4. Live Channels  - Real-time pub/sub via emit()            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testInstantHooks();
  await testPulseJobs();
  await testGuardTags();
  await testLiveChannels();
  await testRealWorldScenarios();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }

  console.log('\n  All daemon feature tests passed!\n');
  console.log('  Tag it. Ship it. Scale it. ⚡\n');
})();
