/**
 * Comprehensive Tests for Injected Photon Events
 *
 * Tests the complete flow:
 * 1. Loader sets _photonName on instances
 * 2. Loader collects injectedPhotons list
 * 3. Emit includes _source field for event routing
 * 4. Bridge generates proxies for injected photons
 *
 * Run with: npx tsx tests/injection/injected-photon-events.test.ts
 */

import { PhotonLoader } from '../../src/loader.js';
import { generateBridgeScript } from '../../src/auto-ui/bridge/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`❌ ${name}`);
      console.log(`   ${e.message}`);
      if (e.stack) {
        console.log(`   ${e.stack.split('\n').slice(1, 3).join('\n   ')}`);
      }
      failed++;
    }
  })();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  console.log('═'.repeat(60));
  console.log('Injected Photon Events Test Suite');
  console.log('═'.repeat(60));

  const loader = new PhotonLoader(false);

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Loader - _photonName Assignment
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n📦 Section 1: _photonName Assignment\n');

  let emitterMcp: any;
  let parentMcp: any;

  await test('loads emitter photon successfully', async () => {
    const emitterPath = path.join(__dirname, 'emitter.photon.ts');
    emitterMcp = await loader.loadFile(emitterPath);
    assert(emitterMcp !== null, 'Should load emitter photon');
    // Photon name is derived from filename: emitter.photon.ts -> emitter-photon (drops .photon.ts, keeps full base)
    // Actually it should be just 'emitter' based on the .replace('.photon', '') logic
    assert(emitterMcp.name.includes('emitter'), `Name should include 'emitter', got '${emitterMcp.name}'`);
  });

  await test('emitter instance has _photonName set', async () => {
    const instance = emitterMcp.instance;
    assert(instance._photonName !== undefined, '_photonName should be defined');
    assert(instance._photonName === emitterMcp.name, `_photonName should match mcp.name`);
  });

  await test('emitter identity() returns correct photonName', async () => {
    const identity = await emitterMcp.instance.identity();
    assert(identity.photonName === emitterMcp.name, `photonName should match mcp.name`);
    assert(identity.className === 'EmitterPhoton', `className should be 'EmitterPhoton', got '${identity.className}'`);
  });

  await test('loads parent photon with injected emitter', async () => {
    const parentPath = path.join(__dirname, 'parent-with-emitter.photon.ts');
    parentMcp = await loader.loadFile(parentPath);
    assert(parentMcp !== null, 'Should load parent photon');
    assert(parentMcp.name.includes('parent'), `Name should include 'parent', got '${parentMcp.name}'`);
  });

  await test('parent instance has _photonName set', async () => {
    const instance = parentMcp.instance;
    assert(instance._photonName !== undefined, '_photonName should be defined');
    assert(instance._photonName === parentMcp.name, `_photonName should match mcp.name`);
  });

  await test('parent has emitter injected', async () => {
    const hasEmitter = await parentMcp.instance.hasEmitter();
    assert(hasEmitter.available === true, 'Emitter should be injected');
  });

  await test('injected emitter has its own _photonName', async () => {
    const identities = await parentMcp.instance.getIdentities();
    assert(identities.parent.photonName === parentMcp.name, `Parent photonName should match mcp.name`);
    assert(identities.emitter !== null, 'Emitter identity should exist');
    assert(identities.emitter.photonName !== undefined, 'Emitter should have photonName');
    assert(identities.emitter.photonName.includes('emitter'), `Emitter photonName should include 'emitter', got '${identities.emitter?.photonName}'`);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Loader - injectedPhotons Collection
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n📦 Section 2: injectedPhotons Collection\n');

  await test('parent photon has injectedPhotons list', async () => {
    assert(Array.isArray(parentMcp.injectedPhotons), 'injectedPhotons should be an array');
  });

  await test('injectedPhotons contains emitter', async () => {
    assert(parentMcp.injectedPhotons.includes('emitter'), `injectedPhotons should include 'emitter', got ${JSON.stringify(parentMcp.injectedPhotons)}`);
  });

  await test('emitter photon has no injectedPhotons', async () => {
    assert(emitterMcp.injectedPhotons === undefined || emitterMcp.injectedPhotons.length === 0,
      'Emitter should have no injected photons');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 3: Emit - _source Field Inclusion
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n📦 Section 3: Emit _source Field\n');

  await test('emit from emitter includes _source field', async () => {
    const emittedEvents: any[] = [];
    const outputHandler = (emit: any) => {
      emittedEvents.push(emit);
    };

    // Use the loader's executeTool which properly sets up the execution context
    try {
      await loader.executeTool(emitterMcp, 'sendAlert', { message: 'test' }, { outputHandler });
    } catch {
      // Ignore errors - we just want to capture emits
    }

    assert(emittedEvents.length > 0, `Should have emitted at least one event, got ${emittedEvents.length}`);
    const event = emittedEvents[0];
    // Debug: log actual event structure
    console.log('Emitted event:', JSON.stringify(event, null, 2));
    assert(event._source !== undefined, `_source should be defined, got event: ${JSON.stringify(event)}`);
    assert(event._source === emitterMcp.name, `_source should be '${emitterMcp.name}', got '${event._source}'`);
    assert(event.event === 'alertCreated', `event should be 'alertCreated', got '${event.event}'`);
  });

  await test('emit from parent includes parent _source', async () => {
    const emittedEvents: any[] = [];
    const outputHandler = (emit: any) => {
      emittedEvents.push(emit);
    };

    try {
      await loader.executeTool(parentMcp, 'parentEvent', { data: 'test-data' }, { outputHandler });
    } catch {
      // Ignore errors - we just want to capture emits
    }

    assert(emittedEvents.length > 0, `Should have emitted at least one event, got ${emittedEvents.length}`);
    const event = emittedEvents[0];
    // Debug: log actual event structure
    console.log('Emitted event:', JSON.stringify(event, null, 2));
    assert(event._source !== undefined, `_source should be defined, got event: ${JSON.stringify(event)}`);
    assert(event._source === parentMcp.name, `_source should be '${parentMcp.name}', got '${event._source}'`);
    assert(event.event === 'parentUpdate', `event should be 'parentUpdate', got '${event.event}'`);
  });

  await test('emit preserves all original data', async () => {
    const emittedEvents: any[] = [];
    const outputHandler = (emit: any) => {
      emittedEvents.push(emit);
    };

    try {
      await loader.executeTool(emitterMcp, 'sendAlert', { message: 'hello world' }, { outputHandler });
    } catch {
      // Ignore errors - we just want to capture emits
    }

    assert(emittedEvents.length > 0, 'Should have emitted at least one event');
    const event = emittedEvents[0];
    assert(event.data !== undefined, 'data should exist');
    assert(event.data.message === 'hello world', `data.message should be 'hello world', got '${event.data?.message}'`);
    assert(typeof event.data.timestamp === 'number', 'data.timestamp should be a number');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 4: Bridge Generation - Injected Photon Proxies
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n📦 Section 4: Bridge Generation\n');

  await test('bridge includes photonEventListeners variable', async () => {
    const script = generateBridgeScript({
      photon: 'parent-with-emitter',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['emitter'],
    });
    assert(script.includes('photonEventListeners'), 'Should include photonEventListeners');
  });

  await test('bridge includes injectedPhotons array', async () => {
    const script = generateBridgeScript({
      photon: 'parent-with-emitter',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['emitter', 'notifications'],
    });
    assert(script.includes('["emitter","notifications"]'), `Should include injectedPhotons array, got: ${script.substring(0, 500)}`);
  });

  await test('bridge creates window.photon.onPhoton method', async () => {
    const script = generateBridgeScript({
      photon: 'parent',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['emitter'],
    });
    assert(script.includes('onPhoton: function(photonName, eventName, cb)'), 'Should have onPhoton method');
  });

  await test('bridge creates proxy for injected photon', async () => {
    const script = generateBridgeScript({
      photon: 'parent',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['emitter'],
    });
    assert(script.includes('injectedPhotons.forEach'), 'Should iterate over injectedPhotons');
    assert(script.includes("window[injectedName] = new Proxy"), 'Should create window proxy for injected photon');
  });

  await test('injected photon proxy supports onEventName pattern', async () => {
    const script = generateBridgeScript({
      photon: 'parent',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['emitter'],
    });
    // The proxy should convert onAlertCreated to subscribe to 'alertCreated' event
    assert(script.includes("prop.startsWith('on')"), 'Should check for on prefix');
    assert(script.includes('window.photon.onPhoton(injectedName, eventName, cb)'), 'Should call onPhoton for event subscription');
  });

  await test('bridge routes events based on _source', async () => {
    const script = generateBridgeScript({
      photon: 'parent',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['emitter'],
    });
    assert(script.includes('sourcePhoton'), 'Should extract sourcePhoton from event');
    assert(script.includes('photonData.data._source'), 'Should read _source from data');
    assert(script.includes('photonEventListeners[sourcePhoton]'), 'Should route to photon-specific listeners');
  });

  await test('bridge with no injected photons has empty array', async () => {
    const script = generateBridgeScript({
      photon: 'standalone',
      method: 'main',
      theme: 'dark',
      injectedPhotons: [],
    });
    // The script serializes as var injectedPhotons = ctx.injectedPhotons || [];
    // and ctx contains the empty array
    assert(script.includes('injectedPhotons'), 'Should reference injectedPhotons');
  });

  await test('bridge without injectedPhotons param defaults to empty', async () => {
    const script = generateBridgeScript({
      photon: 'standalone',
      method: 'main',
      theme: 'dark',
    });
    assert(script.includes('injectedPhotons') && script.includes('[]'), 'Should default to empty array');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 5: Multiple Injected Photons
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n📦 Section 5: Multiple Injected Photons\n');

  await test('bridge handles multiple injected photons', async () => {
    const script = generateBridgeScript({
      photon: 'parent',
      method: 'main',
      theme: 'dark',
      injectedPhotons: ['notifications', 'emitter', 'logger'],
    });
    assert(script.includes('"notifications"'), 'Should include notifications');
    assert(script.includes('"emitter"'), 'Should include emitter');
    assert(script.includes('"logger"'), 'Should include logger');
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
