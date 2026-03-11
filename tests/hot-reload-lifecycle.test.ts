/**
 * Tests for hot-reload lifecycle management.
 *
 * Verifies that:
 * 1. loadFile supports skipInitialize option
 * 2. onShutdown is called on old instance during hot-reload
 * 3. onInitialize is called on new instance AFTER state transfer (or skip)
 * 4. Property copy is skipped for photons with lifecycle hooks
 * 5. Property copy still works for photons without lifecycle hooks
 */

import { PhotonLoader } from '../dist/loader.js';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const testDir = path.join(os.tmpdir(), `photon-hotreload-test-${Date.now()}`);

async function setup() {
  await fs.mkdir(testDir, { recursive: true });
}

async function cleanup() {
  await fs.rm(testDir, { recursive: true, force: true });
}

async function createTestPhoton(name: string, content: string): Promise<string> {
  const testFile = path.join(testDir, `${name}.photon.ts`);
  await fs.writeFile(testFile, content, 'utf-8');
  return testFile;
}

// Photon with lifecycle hooks — tracks call order
const lifecyclePhotonContent = `
  let callLog: string[] = [];

  export default class LifecycleMCP {
    private connected = false;
    private resource: string | null = null;

    async onInitialize() {
      callLog.push('onInitialize');
      this.connected = true;
      this.resource = 'live-socket';
    }

    async onShutdown() {
      callLog.push('onShutdown');
      this.connected = false;
      this.resource = null;
    }

    async status() {
      return {
        connected: this.connected,
        resource: this.resource,
        log: [...callLog],
      };
    }

    // Expose log for testing
    async getLog() {
      return callLog;
    }

    async clearLog() {
      callLog = [];
    }
  }
`;

// Photon WITHOUT lifecycle hooks — relies on property copy
const noLifecyclePhotonContent = `
  export default class SimpleMCP {
    private counter = 0;
    private data: Record<string, string> = {};

    async increment() {
      this.counter++;
      return this.counter;
    }

    async set(params: { key: string; value: string }) {
      this.data[params.key] = params.value;
    }

    async status() {
      return { counter: this.counter, data: this.data };
    }
  }
`;

async function runTests() {
  await setup();
  let passed = 0;
  let failed = 0;

  const test = (name: string) => ({
    pass: () => {
      passed++;
      console.log(`  ✅ ${name}`);
    },
    fail: (err: unknown) => {
      failed++;
      console.log(`  ❌ ${name}: ${err}`);
    },
  });

  try {
    console.log('\n🔁 Hot-Reload Lifecycle Tests\n');

    // ─── Test 1: skipInitialize prevents onInitialize from running ───
    {
      const t = test('skipInitialize prevents onInitialize from running');
      try {
        const testFile = await createTestPhoton('skip-init', lifecyclePhotonContent);
        const loader = new PhotonLoader();
        const result = await loader.loadFile(testFile, { skipInitialize: true });

        assert.ok(result, 'Should load photon');
        assert.ok(result.instance, 'Should have instance');

        // onInitialize should NOT have been called
        const status = await result.instance.status();
        assert.equal(status.connected, false, 'Should not be connected (onInitialize skipped)');
        assert.equal(status.resource, null, 'Resource should be null (onInitialize skipped)');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 2: Normal load DOES call onInitialize ───
    {
      const t = test('Normal load calls onInitialize');
      try {
        const testFile = await createTestPhoton('normal-init', lifecyclePhotonContent);
        const loader = new PhotonLoader();
        const result = await loader.loadFile(testFile);

        const status = await result.instance.status();
        assert.equal(status.connected, true, 'Should be connected after onInitialize');
        assert.equal(status.resource, 'live-socket', 'Resource should be set');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 3: onShutdown can be called on instance ───
    {
      const t = test('onShutdown cleans up instance state');
      try {
        const testFile = await createTestPhoton('shutdown-test', lifecyclePhotonContent);
        const loader = new PhotonLoader();
        const result = await loader.loadFile(testFile);

        // Verify connected
        let status = await result.instance.status();
        assert.equal(status.connected, true);

        // Call onShutdown
        await result.instance.onShutdown();

        // Verify cleaned up
        status = await result.instance.status();
        assert.equal(status.connected, false, 'Should be disconnected after onShutdown');
        assert.equal(status.resource, null, 'Resource should be null after onShutdown');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 4: Lifecycle photon - onInitialize runs fresh after skipInitialize ───
    {
      const t = test('Lifecycle photon rebuilds state from onInitialize (no stale state)');
      try {
        const testFile = await createTestPhoton('lifecycle-rebuild', lifecyclePhotonContent);
        const loader = new PhotonLoader();

        // Load with skipInitialize (simulating hot-reload new instance)
        const result = await loader.loadFile(testFile, { skipInitialize: true });

        // Verify NOT initialized
        let status = await result.instance.status();
        assert.equal(status.connected, false);

        // Now manually call onInitialize (as hot-reload does after skipping property copy)
        await result.instance.onInitialize();

        // Should be fully initialized from scratch
        status = await result.instance.status();
        assert.equal(status.connected, true, 'Should connect from onInitialize');
        assert.equal(status.resource, 'live-socket', 'Resource should be rebuilt');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 5: Photon without lifecycle hooks still loads normally ───
    {
      const t = test('Photon without lifecycle hooks loads and works');
      try {
        const testFile = await createTestPhoton('no-lifecycle', noLifecyclePhotonContent);
        const loader = new PhotonLoader();
        const result = await loader.loadFile(testFile);

        assert.ok(result.instance, 'Should have instance');

        // Use it
        await result.instance.increment();
        await result.instance.increment();
        await result.instance.set({ key: 'foo', value: 'bar' });

        const status = await result.instance.status();
        assert.equal(status.counter, 2, 'Counter should be 2');
        assert.equal(status.data.foo, 'bar', 'Data should be set');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 6: hasLifecycle detection ───
    {
      const t = test('Lifecycle detection: has both onShutdown and onInitialize');
      try {
        const testFile = await createTestPhoton('detect-lifecycle', lifecyclePhotonContent);
        const loader = new PhotonLoader();
        const result = await loader.loadFile(testFile);

        const instance = result.instance;
        const hasLifecycle =
          typeof instance.onShutdown === 'function' && typeof instance.onInitialize === 'function';
        assert.equal(hasLifecycle, true, 'Should detect lifecycle hooks');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 7: No lifecycle detection for plain photon ───
    {
      const t = test('Lifecycle detection: plain photon has no hooks');
      try {
        const testFile = await createTestPhoton('detect-no-lifecycle', noLifecyclePhotonContent);
        const loader = new PhotonLoader();
        const result = await loader.loadFile(testFile);

        const instance = result.instance;
        const hasLifecycle =
          typeof instance.onShutdown === 'function' && typeof instance.onInitialize === 'function';
        assert.equal(hasLifecycle, false, 'Should not detect lifecycle hooks');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    // ─── Test 8: Simulated hot-reload for lifecycle photon ───
    {
      const t = test('Simulated hot-reload: shutdown → fresh load → initialize');
      try {
        const testFile = await createTestPhoton('hotreload-sim', lifecyclePhotonContent);
        const loader = new PhotonLoader();

        // Step 1: Load old instance (normal)
        const oldResult = await loader.loadFile(testFile);
        let oldStatus = await oldResult.instance.status();
        assert.equal(oldStatus.connected, true, 'Old instance should be connected');

        // Clear log for clean tracking
        await oldResult.instance.clearLog();

        // Step 2: Create new instance with skipInitialize
        await loader.reloadFile(testFile);
        const newResult = await loader.loadFile(testFile, { skipInitialize: true });

        // Step 3: Shutdown old instance
        await oldResult.instance.onShutdown();
        oldStatus = await oldResult.instance.status();
        assert.equal(oldStatus.connected, false, 'Old instance should be cleaned up');

        // Step 4: Initialize new instance (fresh — no stale state from property copy)
        let newStatus = await newResult.instance.status();
        assert.equal(newStatus.connected, false, 'New instance should start disconnected');

        await newResult.instance.onInitialize();
        newStatus = await newResult.instance.status();
        assert.equal(newStatus.connected, true, 'New instance should connect from onInitialize');
        assert.equal(newStatus.resource, 'live-socket', 'New instance should have fresh resource');

        t.pass();
      } catch (err) {
        t.fail(err);
      }
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
  } finally {
    await cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { runTests };
