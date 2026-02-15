/**
 * Instance Drift Tests
 *
 * Tests for the instance drift recovery mechanism:
 * 1. Protocol: instanceName field in DaemonRequest
 * 2. Daemon server: auto-switches when instanceName mismatches session
 * 3. Daemon client: passes instanceName through options
 * 4. Client layers track instanceName after _use succeeds
 *
 * These tests catch regressions where daemon sessions expire and
 * recreate as "default", silently returning wrong data.
 */

import { strict as assert } from 'assert';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import { isValidDaemonRequest } from '../dist/daemon/protocol.js';
import type { DaemonRequest, DaemonResponse } from '../dist/daemon/protocol.js';

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
// Protocol Tests — instanceName field
// ============================================================================

async function testInstanceNameInProtocol() {
  console.log('\nDaemonRequest instanceName field:');

  await test('accepts command with instanceName', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'command',
        id: '1',
        method: 'list',
        instanceName: 'macha',
      }),
      true
    );
  });

  await test('accepts command without instanceName (optional)', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'command',
        id: '1',
        method: 'list',
      }),
      true
    );
  });

  await test('instanceName is preserved in request object', () => {
    const req: DaemonRequest = {
      type: 'command',
      id: '1',
      method: 'list',
      instanceName: 'groceries',
    };
    assert.equal(req.instanceName, 'groceries');
  });

  await test('empty string instanceName is valid (means default)', () => {
    const req: DaemonRequest = {
      type: 'command',
      id: '1',
      method: 'list',
      instanceName: '',
    };
    assert.equal(req.instanceName, '');
  });
}

// ============================================================================
// Mock Daemon Server — simulates instance drift + auto-recovery
// ============================================================================

/**
 * Mock daemon that tracks session → instance mapping and
 * implements the auto-switch behavior we're testing.
 */
class InstanceDriftMockServer {
  private server: net.Server;
  private socketPath: string;

  /** Session → current instance name */
  private sessionInstances = new Map<string, string>();
  /** Log of actions for assertions */
  public actionLog: Array<{ action: string; from?: string; to?: string; sessionId?: string }> = [];
  /** Items per instance (simulated state) */
  private instanceData = new Map<string, string[]>();

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => this.handleConnection(socket));

    // Seed test data
    this.instanceData.set('default', ['default-item-1']);
    this.instanceData.set('macha', ['macha-item-1', 'macha-item-2']);
    this.instanceData.set('work', ['work-item-1']);
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
          const response = this.handleRequest(request);
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
  }

  private handleRequest(request: DaemonRequest): DaemonResponse | null {
    if (request.type === 'ping') {
      return { type: 'pong', id: request.id };
    }

    if (request.type !== 'command') {
      return { type: 'error', id: request.id, error: `Unsupported: ${request.type}` };
    }

    const sessionId = request.sessionId || 'anonymous';

    // Simulate getOrCreateSession — new sessions default to "default" (empty string)
    if (!this.sessionInstances.has(sessionId)) {
      this.sessionInstances.set(sessionId, '');
      this.actionLog.push({ action: 'session-created', sessionId, to: 'default' });
    }

    // ── Auto-recover from instance drift (the mechanism under test) ──
    const currentInstance = this.sessionInstances.get(sessionId)!;
    if (request.instanceName && request.instanceName !== currentInstance) {
      this.actionLog.push({
        action: 'auto-switch',
        from: currentInstance || 'default',
        to: request.instanceName,
        sessionId,
      });
      this.sessionInstances.set(sessionId, request.instanceName);
    }

    // Handle _use
    if (request.method === '_use') {
      const name = String((request.args as any)?.name ?? '');
      this.sessionInstances.set(sessionId, name);
      this.actionLog.push({ action: '_use', to: name || 'default', sessionId });
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: { instance: name || 'default' },
      };
    }

    // Handle _instances
    if (request.method === '_instances') {
      const instances = Array.from(this.instanceData.keys());
      const current = this.sessionInstances.get(sessionId) || 'default';
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: { instances, current },
      };
    }

    // Handle list — returns data for current instance
    if (request.method === 'list') {
      const instanceName = this.sessionInstances.get(sessionId) || '';
      const key = instanceName || 'default';
      const items = this.instanceData.get(key) || [];
      this.actionLog.push({ action: 'list', sessionId });
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: { items, instance: key },
      };
    }

    return { type: 'error', id: request.id, error: `Unknown method: ${request.method}` };
  }

  /** Simulate session expiry — removes the session so next request gets "default" */
  expireSession(sessionId: string): void {
    this.sessionInstances.delete(sessionId);
    this.actionLog.push({ action: 'session-expired', sessionId });
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
// Helper: send a single request and get response
// ============================================================================

function sendRequest(socketPath: string, request: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Request timeout'));
    }, 5000);

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: DaemonResponse = JSON.parse(line);
          if (response.id === request.id) {
            clearTimeout(timeout);
            client.destroy();
            resolve(response);
            return;
          }
        } catch {
          // ignore parse errors on partial messages
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.destroy();
      reject(err);
    });
  });
}

// ============================================================================
// Integration Tests — Instance Drift Recovery
// ============================================================================

async function testInstanceDriftRecovery() {
  console.log('\nInstance Drift Recovery:');

  const socketPath = path.join(os.tmpdir(), `photon-drift-test-${Date.now()}.sock`);
  const server = new InstanceDriftMockServer(socketPath);

  try {
    await server.start();

    const sessionId = 'beam-test-session';

    // Step 1: Switch to "macha" instance
    await test('switch to macha instance via _use', async () => {
      const response = await sendRequest(socketPath, {
        type: 'command',
        id: 'req_1',
        method: '_use',
        args: { name: 'macha' },
        sessionId,
      });
      assert.equal(response.type, 'result');
      assert.equal((response.data as any).instance, 'macha');
    });

    // Step 2: Verify list returns macha data
    await test('list returns macha data before drift', async () => {
      const response = await sendRequest(socketPath, {
        type: 'command',
        id: 'req_2',
        method: 'list',
        args: {},
        sessionId,
        instanceName: 'macha',
      });
      assert.equal(response.type, 'result');
      const data = response.data as any;
      assert.equal(data.instance, 'macha');
      assert.deepEqual(data.items, ['macha-item-1', 'macha-item-2']);
    });

    // Step 3: Simulate session expiry (daemon restart or 30min timeout)
    server.expireSession(sessionId);

    // Step 4: WITHOUT instanceName hint — gets wrong data (default)
    await test('without instanceName hint, gets default data after drift', async () => {
      const response = await sendRequest(socketPath, {
        type: 'command',
        id: 'req_3',
        method: 'list',
        args: {},
        sessionId,
        // NO instanceName — simulates old behavior
      });
      assert.equal(response.type, 'result');
      const data = response.data as any;
      // This is the bug: session was recreated as "default"
      assert.equal(data.instance, 'default');
      assert.deepEqual(data.items, ['default-item-1']);
    });

    // Step 5: Expire again for the fix test
    server.expireSession(sessionId);

    // Step 6: WITH instanceName hint — auto-recovers to macha
    await test('with instanceName hint, auto-recovers to macha after drift', async () => {
      server.actionLog = []; // Clear log to track recovery

      const response = await sendRequest(socketPath, {
        type: 'command',
        id: 'req_4',
        method: 'list',
        args: {},
        sessionId,
        instanceName: 'macha',
      });
      assert.equal(response.type, 'result');
      const data = response.data as any;
      assert.equal(data.instance, 'macha');
      assert.deepEqual(data.items, ['macha-item-1', 'macha-item-2']);

      // Verify auto-switch happened
      const autoSwitch = server.actionLog.find((l) => l.action === 'auto-switch');
      assert.ok(autoSwitch, 'Expected auto-switch action in log');
      assert.equal(autoSwitch!.from, 'default');
      assert.equal(autoSwitch!.to, 'macha');
    });

    // Step 7: Subsequent calls stay on macha (no drift)
    await test('subsequent calls stay on macha without additional auto-switch', async () => {
      server.actionLog = [];

      const response = await sendRequest(socketPath, {
        type: 'command',
        id: 'req_5',
        method: 'list',
        args: {},
        sessionId,
        instanceName: 'macha',
      });
      assert.equal(response.type, 'result');
      assert.equal((response.data as any).instance, 'macha');

      // No auto-switch should happen since session is already on macha
      const autoSwitch = server.actionLog.find((l) => l.action === 'auto-switch');
      assert.equal(
        autoSwitch,
        undefined,
        'No auto-switch expected when already on correct instance'
      );
    });
  } finally {
    await server.stop();
  }
}

// ============================================================================
// Instance Drift with Multiple Sessions
// ============================================================================

async function testMultiSessionDrift() {
  console.log('\nMulti-Session Instance Drift:');

  const socketPath = path.join(os.tmpdir(), `photon-multi-drift-${Date.now()}.sock`);
  const server = new InstanceDriftMockServer(socketPath);

  try {
    await server.start();

    const beamSession = 'beam-tab-1';
    const stdioSession = 'stdio-mylist';

    // Set up different instances for different sessions
    await test('beam and stdio can be on different instances', async () => {
      await sendRequest(socketPath, {
        type: 'command',
        id: 'setup_1',
        method: '_use',
        args: { name: 'macha' },
        sessionId: beamSession,
      });

      await sendRequest(socketPath, {
        type: 'command',
        id: 'setup_2',
        method: '_use',
        args: { name: 'work' },
        sessionId: stdioSession,
      });

      const beamList = await sendRequest(socketPath, {
        type: 'command',
        id: 'list_beam',
        method: 'list',
        args: {},
        sessionId: beamSession,
        instanceName: 'macha',
      });
      assert.equal((beamList.data as any).instance, 'macha');

      const stdioList = await sendRequest(socketPath, {
        type: 'command',
        id: 'list_stdio',
        method: 'list',
        args: {},
        sessionId: stdioSession,
        instanceName: 'work',
      });
      assert.equal((stdioList.data as any).instance, 'work');
    });

    // Expire both sessions
    server.expireSession(beamSession);
    server.expireSession(stdioSession);

    await test('both sessions recover to their own instances after drift', async () => {
      server.actionLog = [];

      const beamList = await sendRequest(socketPath, {
        type: 'command',
        id: 'recover_beam',
        method: 'list',
        args: {},
        sessionId: beamSession,
        instanceName: 'macha',
      });
      assert.equal((beamList.data as any).instance, 'macha');

      const stdioList = await sendRequest(socketPath, {
        type: 'command',
        id: 'recover_stdio',
        method: 'list',
        args: {},
        sessionId: stdioSession,
        instanceName: 'work',
      });
      assert.equal((stdioList.data as any).instance, 'work');

      // Both should have triggered auto-switch
      const switches = server.actionLog.filter((l) => l.action === 'auto-switch');
      assert.equal(switches.length, 2, 'Expected two auto-switches');
    });
  } finally {
    await server.stop();
  }
}

// ============================================================================
// Daemon Client instanceName Passthrough
// ============================================================================

async function testClientInstanceNamePassthrough() {
  console.log('\nDaemon Client instanceName Passthrough:');

  const socketPath = path.join(os.tmpdir(), `photon-passthrough-${Date.now()}.sock`);

  // Capture the raw request the daemon server receives
  let capturedRequest: DaemonRequest | null = null;

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          capturedRequest = JSON.parse(line);
          // Send a result so the client resolves
          socket.write(
            JSON.stringify({
              type: 'result',
              id: capturedRequest!.id,
              success: true,
              data: { ok: true },
            }) + '\n'
          );
        } catch {
          // ignore
        }
      }
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, () => resolve());
      server.on('error', reject);
    });

    await test('instanceName is included in the request when provided', async () => {
      capturedRequest = null;

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'command',
        id: 'pass_1',
        photonName: 'mylist',
        method: 'list',
        args: {},
        sessionId: 'beam-123',
        instanceName: 'macha',
      };

      client.write(JSON.stringify(request) + '\n');

      // Wait for the server to capture the request
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (capturedRequest) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      assert.equal(capturedRequest!.instanceName, 'macha');
      assert.equal(capturedRequest!.sessionId, 'beam-123');
      assert.equal(capturedRequest!.method, 'list');

      client.destroy();
    });

    await test('instanceName is undefined when not provided', async () => {
      capturedRequest = null;

      const client = net.createConnection(socketPath);
      await new Promise<void>((resolve) => client.on('connect', resolve));

      const request: DaemonRequest = {
        type: 'command',
        id: 'pass_2',
        photonName: 'mylist',
        method: 'list',
        args: {},
        sessionId: 'cli-456',
      };

      client.write(JSON.stringify(request) + '\n');

      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (capturedRequest) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      assert.equal(capturedRequest!.instanceName, undefined);

      client.destroy();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ============================================================================
// Idle Timeout Disabled
// ============================================================================

async function testIdleTimeoutDisabled() {
  console.log('\nDaemon Idle Timeout:');

  await test('idleTimeout should be 0 in daemon server source', async () => {
    const fsPromises = await import('fs/promises');
    const serverSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    // Check that idle timeout is set to 0
    assert.ok(
      serverSource.includes('let idleTimeout = 0'),
      'Expected idleTimeout = 0 in daemon server (daemon should not auto-retire)'
    );
    // Ensure the old 10-minute timeout is gone
    assert.ok(
      !serverSource.includes('let idleTimeout = 600000'),
      'Old 10-minute idle timeout should be removed'
    );
  });
}

// ============================================================================
// Auto-Switch Logic Exists in Daemon Server
// ============================================================================

async function testAutoSwitchCodeExists() {
  console.log('\nAuto-Switch Code Verification:');

  await test('daemon server has auto-switch on instanceName mismatch', async () => {
    const fsPromises = await import('fs/promises');
    const serverSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/server.ts'),
      'utf-8'
    );
    // Verify the auto-switch pattern exists
    assert.ok(
      serverSource.includes('request.instanceName') &&
        serverSource.includes('session.instanceName') &&
        serverSource.includes('switchInstance'),
      'Expected auto-switch logic comparing request.instanceName to session.instanceName'
    );
  });

  await test('protocol includes instanceName field', async () => {
    const fsPromises = await import('fs/promises');
    const protocolSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/protocol.ts'),
      'utf-8'
    );
    assert.ok(
      protocolSource.includes('instanceName?: string'),
      'Expected instanceName optional field in DaemonRequest'
    );
  });

  await test('daemon client passes instanceName in options', async () => {
    const fsPromises = await import('fs/promises');
    const clientSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/daemon/client.ts'),
      'utf-8'
    );
    assert.ok(
      clientSource.includes('instanceName?: string') && clientSource.includes('instanceName,'),
      'Expected instanceName in sendCommand options and request construction'
    );
  });

  await test('beam transport tracks instanceName per session', async () => {
    const fsPromises = await import('fs/promises');
    const transportSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/auto-ui/streamable-http-transport.ts'),
      'utf-8'
    );
    assert.ok(
      transportSource.includes('session.instanceName'),
      'Expected session.instanceName tracking in beam transport'
    );
    assert.ok(
      transportSource.includes('instanceName: session.instanceName'),
      'Expected instanceName passed in sendOpts'
    );
  });

  await test('STDIO server tracks daemonInstanceName', async () => {
    const fsPromises = await import('fs/promises');
    const serverSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/server.ts'),
      'utf-8'
    );
    assert.ok(
      serverSource.includes('daemonInstanceName'),
      'Expected daemonInstanceName field in PhotonServer'
    );
    // After handler deduplication, STDIO context maps getInstanceName to daemonInstanceName
    assert.ok(
      serverSource.includes('getInstanceName: () => this.daemonInstanceName'),
      'Expected STDIO handler context to read daemonInstanceName'
    );
  });

  await test('SSE server tracks sseInstanceNames per session', async () => {
    const fsPromises = await import('fs/promises');
    const serverSource = await fsPromises.readFile(
      path.join(process.cwd(), 'src/server.ts'),
      'utf-8'
    );
    assert.ok(
      serverSource.includes('sseInstanceNames'),
      'Expected sseInstanceNames map in PhotonServer'
    );
    assert.ok(
      serverSource.includes('this.sseInstanceNames.get(sseSessionKey)'),
      'Expected instanceName from sseInstanceNames map in SSE sendOpts'
    );
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

(async () => {
  console.log('Instance Drift Tests');
  console.log('====================');

  await testInstanceNameInProtocol();
  await testInstanceDriftRecovery();
  await testMultiSessionDrift();
  await testClientInstanceNamePassthrough();
  await testIdleTimeoutDisabled();
  await testAutoSwitchCodeExists();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
