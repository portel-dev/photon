/**
 * A2UI v0.9 End-to-End Integration
 *
 * Exercises the full A2UI pipeline inside the Photon ecosystem:
 *
 *   fixture photon ── docblock extraction ── createAGUIOutputHandler
 *                                              └── broadcast() captured
 *                                                  └── assert A2UI lifecycle
 *
 * Pairs with tests/format-snapshot.test.ts, which covers the CLI surface.
 * Together they verify that @format a2ui works on both the CLI and the
 * AG-UI / MCP transports without spinning up a full HTTP server.
 */

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createAGUIOutputHandler } from '../src/ag-ui/adapter.js';
import { AGUIEventType } from '../src/ag-ui/types.js';
import { A2UI_BASIC_CATALOG, A2UI_VERSION } from '../src/a2ui/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'format-test.photon.ts');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✅ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ❌ ${name}`);
      console.log(`     ${err.message || err}`);
    });
}

// ── Fixture: a2ui methods in tests/fixtures/format-test.photon.ts ──
// We don't spin up the full loader — we invoke the fixture class directly
// after confirming the docblock extractor reports outputFormat='a2ui'. This
// keeps the test fast while exercising the real adapter + mapper code path.

async function loadFixtureMethodFormats(): Promise<Map<string, string>> {
  const source = readFileSync(FIXTURE, 'utf-8');
  const methods = new Map<string, string>();
  const re =
    /\/\*\*([\s\S]*?)\*\/\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+|\*\s*)?(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, jsdoc, methodName] = m;
    const formatMatch = jsdoc.match(/@format\s+(\S+)/);
    if (formatMatch) methods.set(methodName, formatMatch[1]);
  }
  return methods;
}

async function instantiateFixture(): Promise<Record<string, () => Promise<unknown>>> {
  // Dynamic import — tsx/bun resolves .ts directly
  const mod = (await import(FIXTURE)) as {
    default: new () => Record<string, () => Promise<unknown>>;
  };
  const Ctor = mod.default;
  const instance = new Ctor();
  return instance;
}

function captureCustoms(events: any[], name: string): any[] {
  return events
    .map((e) => e.params)
    .filter((p) => p.type === AGUIEventType.CUSTOM && p.name === name);
}

async function runAll(): Promise<void> {
  console.log('\n🧪 A2UI v0.9 End-to-End\n');

  // ── 1. Extraction: fixture methods declare @format a2ui ──────

  const formats = await loadFixtureMethodFormats();
  const instance = await instantiateFixture();

  await test('fixture photon declares @format a2ui on the expected methods', () => {
    for (const name of ['a2uiRows', 'a2uiObject', 'a2uiCard', 'a2uiEscape']) {
      assert.equal(formats.get(name), 'a2ui', `expected a2ui format on ${name}`);
    }
  });

  // ── 2. Adapter integration: drive createAGUIOutputHandler ────

  async function runMethod(methodName: string): Promise<any[]> {
    const events: any[] = [];
    const { finish } = createAGUIOutputHandler(
      'format-test',
      methodName,
      `run-${methodName}`,
      (n) => events.push(n),
      { outputFormat: formats.get(methodName) }
    );
    const result = await instance[methodName]();
    finish(result);
    return events;
  }

  await test('a2uiRows broadcasts the full v0.9 lifecycle as CUSTOM events', async () => {
    const events = await runMethod('a2uiRows');
    const a2ui = captureCustoms(events, 'a2ui.message');
    assert.ok(a2ui.length >= 3, `expected ≥3 A2UI events, got ${a2ui.length}`);

    const first = a2ui[0].value as Record<string, unknown>;
    assert.equal(first.version, A2UI_VERSION);
    assert.ok('createSurface' in first, 'first event is createSurface');

    const hasUpdateComponents = a2ui.some((e) => 'updateComponents' in (e.value as object));
    const hasUpdateDataModel = a2ui.some((e) => 'updateDataModel' in (e.value as object));
    assert.ok(hasUpdateComponents, 'missing updateComponents');
    assert.ok(hasUpdateDataModel, 'missing updateDataModel');
  });

  await test('A2UI messages use the Basic catalog', async () => {
    const events = await runMethod('a2uiObject');
    const a2ui = captureCustoms(events, 'a2ui.message');
    const create = (a2ui.find((e) => 'createSurface' in (e.value as object)) as any).value;
    assert.equal(create.createSurface.catalogId, A2UI_BASIC_CATALOG);
  });

  await test('A2UI messages land BEFORE STATE_SNAPSHOT in the event stream', async () => {
    const events = await runMethod('a2uiCard');
    const types = events.map((e) => e.params.type);
    const lastA2UI = events.findLastIndex(
      (e) => e.params.type === AGUIEventType.CUSTOM && e.params.name === 'a2ui.message'
    );
    const snapshotIdx = types.indexOf(AGUIEventType.STATE_SNAPSHOT);
    assert.ok(
      lastA2UI >= 0 && snapshotIdx > lastA2UI,
      `a2ui.message events should precede STATE_SNAPSHOT (lastA2UI=${lastA2UI}, snapshot=${snapshotIdx})`
    );
  });

  await test('RUN_FINISHED is always the terminal event (A2UI does not hijack the lifecycle)', async () => {
    const events = await runMethod('a2uiRows');
    const last = events[events.length - 1];
    assert.equal(last.params.type, AGUIEventType.RUN_FINISHED);
  });

  await test('a2uiEscape passes the verbatim component tree through the adapter', async () => {
    const events = await runMethod('a2uiEscape');
    const a2ui = captureCustoms(events, 'a2ui.message');
    const update = a2ui
      .map((e) => e.value as Record<string, any>)
      .find((v) => 'updateComponents' in v);
    const title = update!.updateComponents.components.find((c: any) => c.id === 'title');
    assert.equal(title?.text, 'Verbatim surface');
  });

  await test('methods without @format a2ui do not emit A2UI events', async () => {
    // `table` method is @format table — no A2UI output
    const events: any[] = [];
    const { finish } = createAGUIOutputHandler(
      'format-test',
      'table',
      'run-table',
      (n) => events.push(n),
      { outputFormat: formats.get('table') } // 'table'
    );
    finish(await instance.table());
    const a2ui = captureCustoms(events, 'a2ui.message');
    assert.equal(a2ui.length, 0);
  });

  // ── 3. Round-trip convention: button name === method name ──
  // The action round-trip contract — Beam routes a click on a button with
  // event.name="increment" to <photon>/increment. This test dogfoods the
  // a2ui-counter fixture, which encodes that convention.

  await test('counter fixture round-trip: each action method matches a button event.name', async () => {
    const counterPath = path.join(__dirname, 'fixtures', 'a2ui-counter.photon.ts');
    const counterMod = (await import(counterPath)) as {
      default: new () => Record<string, () => Promise<unknown>> & {
        memory?: {
          get: (k: string) => Promise<unknown>;
          set: (k: string, v: unknown) => Promise<void>;
        };
      };
    };
    const counter = new counterMod.default();
    // Stub the memory dependency the runtime would inject — we're not
    // exercising persistence here, only the convention that button
    // event.name === method name.
    const store = new Map<string, unknown>();
    counter.memory = {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => {
        store.set(k, v);
      },
    };
    const surface = (await counter.view()) as {
      components: Array<{
        component: string;
        action?: { event?: { name?: string } };
      }>;
    };
    const buttonNames = surface.components
      .filter((c) => c.component === 'Button')
      .map((c) => c.action?.event?.name)
      .filter((n): n is string => typeof n === 'string');
    assert.ok(buttonNames.length >= 3, 'fixture should declare ≥3 action buttons');
    for (const name of buttonNames) {
      assert.equal(
        typeof (counter as Record<string, unknown>)[name],
        'function',
        `button name "${name}" must map to a method on the photon`
      );
    }
    // Smoke-call increment to confirm the contract works end-to-end.
    await counter.increment();
    const after = (await counter.view()) as { data: { value: number } };
    assert.equal(after.data.value, 1, 'increment should persist a +1 in memory');
  });

  // ── 4. Wire format: AG-UI event envelope is valid JSON-RPC 2.0 ──

  await test('every A2UI event is wrapped as a valid ag-ui/event JSON-RPC notification', async () => {
    const events = await runMethod('a2uiRows');
    const a2uiEnvelopes = events.filter(
      (e) => e.params.type === AGUIEventType.CUSTOM && e.params.name === 'a2ui.message'
    );
    for (const env of a2uiEnvelopes) {
      assert.equal(env.jsonrpc, '2.0');
      assert.equal(env.method, 'ag-ui/event');
      assert.equal(env.id, undefined, 'notifications never carry an id');
    }
  });

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
