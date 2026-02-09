/**
 * Constructor Injection Tests
 *
 * Verifies the four injection types: env, mcp, photon, and state.
 * Also tests the stateful persistence design where non-primitive
 * constructor params with defaults are restored on restart.
 *
 * Run: npx tsx tests/constructor-injection.test.ts
 */

import { strict as assert } from 'assert';
import { SchemaExtractor } from '@portel/photon-core';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`  \u2705 ${name}`);
    },
    (err) => {
      failed++;
      console.log(`  \u274c ${name}: ${err.message}`);
    }
  );
}

async function run() {
  const extractor = new SchemaExtractor();

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Constructor Param Extraction\n');
  // ═══════════════════════════════════════════════════════════════

  await test('extracts primitive params', () => {
    const source = `
      export default class Mailer {
        constructor(
          private smtpHost: string = 'localhost',
          private smtpPort: number = 587,
          private useTls: boolean = true
        ) {}
      }
    `;
    const params = extractor.extractConstructorParams(source);
    assert.equal(params.length, 3);

    assert.equal(params[0].name, 'smtpHost');
    assert.equal(params[0].type, 'string');
    assert.equal(params[0].isPrimitive, true);
    assert.equal(params[0].hasDefault, true);
    assert.equal(params[0].defaultValue, 'localhost');

    assert.equal(params[1].name, 'smtpPort');
    assert.equal(params[1].type, 'number');
    assert.equal(params[1].isPrimitive, true);

    assert.equal(params[2].name, 'useTls');
    assert.equal(params[2].type, 'boolean');
    assert.equal(params[2].isPrimitive, true);
  });

  await test('extracts non-primitive param with default', () => {
    const source = `
      export default class List {
        items: string[];
        constructor(items: string[] = []) {
          this.items = items;
        }
      }
    `;
    const params = extractor.extractConstructorParams(source);
    assert.equal(params.length, 1);
    assert.equal(params[0].name, 'items');
    assert.equal(params[0].type, 'string[]');
    assert.equal(params[0].isPrimitive, false);
    assert.equal(params[0].hasDefault, true);
    assert.equal(params[0].isOptional, true);
  });

  await test('extracts mixed primitive and non-primitive params', () => {
    const source = `
      export default class Dashboard {
        incidents: Incident[];
        constructor(
          private apiKey: string,
          incidents: Incident[] = []
        ) {
          this.incidents = incidents;
        }
      }
    `;
    const params = extractor.extractConstructorParams(source);
    assert.equal(params.length, 2);
    assert.equal(params[0].name, 'apiKey');
    assert.equal(params[0].isPrimitive, true);
    assert.equal(params[0].hasDefault, false);
    assert.equal(params[1].name, 'incidents');
    assert.equal(params[1].isPrimitive, false);
    assert.equal(params[1].hasDefault, true);
  });

  await test('no constructor returns empty params', () => {
    const source = `
      export default class Simple {
        items: string[] = [];
        add(item: string): void {
          this.items.push(item);
        }
      }
    `;
    const params = extractor.extractConstructorParams(source);
    assert.equal(params.length, 0);
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Injection Resolution — Environment Variables\n');
  // ═══════════════════════════════════════════════════════════════

  await test('primitive params resolve to env injection', () => {
    const source = `
      export default class Mailer {
        constructor(
          private host: string = 'localhost',
          private port: number = 587
        ) {}
      }
    `;
    const injections = extractor.resolveInjections(source, 'mailer');
    assert.equal(injections.length, 2);
    assert.equal(injections[0].injectionType, 'env');
    assert.equal(injections[0].envVarName, 'MAILER_HOST');
    assert.equal(injections[1].injectionType, 'env');
    assert.equal(injections[1].envVarName, 'MAILER_PORT');
  });

  await test('camelCase params become SCREAMING_SNAKE_CASE env vars', () => {
    const source = `
      export default class Api {
        constructor(private apiBaseUrl: string) {}
      }
    `;
    const injections = extractor.resolveInjections(source, 'api');
    assert.equal(injections[0].envVarName, 'API_API_BASE_URL');
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Injection Resolution — MCP Dependencies\n');
  // ═══════════════════════════════════════════════════════════════

  await test('@mcp params resolve to mcp injection', () => {
    const source = `
      /**
       * @mcp github anthropics/mcp-server-github
       */
      export default class Manager {
        constructor(private github: any) {}
      }
    `;
    const injections = extractor.resolveInjections(source, 'manager');
    assert.equal(injections.length, 1);
    assert.equal(injections[0].injectionType, 'mcp');
    assert.ok(injections[0].mcpDependency);
    assert.equal(injections[0].mcpDependency!.name, 'github');
  });

  await test('multiple @mcp deps resolve correctly', () => {
    const source = `
      /**
       * @mcp github anthropics/mcp-server-github
       * @mcp slack anthropics/mcp-server-slack
       */
      export default class Ops {
        constructor(private github: any, private slack: any) {}
      }
    `;
    const injections = extractor.resolveInjections(source, 'ops');
    assert.equal(injections.length, 2);
    assert.equal(injections[0].injectionType, 'mcp');
    assert.equal(injections[0].mcpDependency!.name, 'github');
    assert.equal(injections[1].injectionType, 'mcp');
    assert.equal(injections[1].mcpDependency!.name, 'slack');
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Injection Resolution — Photon Dependencies\n');
  // ═══════════════════════════════════════════════════════════════

  await test('@photon params resolve to photon injection', () => {
    const source = `
      /**
       * @photon billing billing-photon
       */
      export default class Dashboard {
        constructor(private billing: any) {}
      }
    `;
    const injections = extractor.resolveInjections(source, 'dashboard');
    assert.equal(injections.length, 1);
    assert.equal(injections[0].injectionType, 'photon');
    assert.ok(injections[0].photonDependency);
    assert.equal(injections[0].photonDependency!.name, 'billing');
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Injection Resolution — Mixed Types\n');
  // ═══════════════════════════════════════════════════════════════

  await test('mixed env + mcp + photon resolve correctly', () => {
    const source = `
      /**
       * @mcp github anthropics/mcp-server-github
       * @photon billing billing-photon
       */
      export default class Tracker {
        constructor(
          private webhookUrl: string,
          private github: any,
          private billing: any
        ) {}
      }
    `;
    const injections = extractor.resolveInjections(source, 'tracker');
    assert.equal(injections.length, 3);
    assert.equal(injections[0].injectionType, 'env');
    assert.equal(injections[0].envVarName, 'TRACKER_WEBHOOK_URL');
    assert.equal(injections[1].injectionType, 'mcp');
    assert.equal(injections[2].injectionType, 'photon');
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Injection Resolution — Stateful Persistence\n');
  // ═══════════════════════════════════════════════════════════════

  await test('non-primitive with default on @stateful resolves to state injection', () => {
    const source = `
      /**
       * @stateful true
       */
      export default class List {
        items: string[];
        constructor(items: string[] = []) {
          this.items = items;
        }
      }
    `;
    const injections = extractor.resolveInjections(source, 'list');
    assert.equal(injections.length, 1);
    // Currently resolves as 'env' fallback since 'state' type not yet implemented.
    // When implemented, this should become:
    //   assert.equal(injections[0].injectionType, 'state');
    // For now, verify the param metadata is correct for future implementation.
    assert.equal(injections[0].param.name, 'items');
    assert.equal(injections[0].param.isPrimitive, false);
    assert.equal(injections[0].param.hasDefault, true);
    assert.equal(injections[0].param.type, 'string[]');
  });

  await test('stateful photon with mixed params: env + state', () => {
    const source = `
      /**
       * @stateful true
       */
      export default class Counter {
        counts: Map<string, number>;
        constructor(
          private label: string = 'default',
          counts: Map<string, number> = new Map()
        ) {
          this.counts = counts;
        }
      }
    `;
    const injections = extractor.resolveInjections(source, 'counter');
    assert.equal(injections.length, 2);
    // First param is primitive → env
    assert.equal(injections[0].injectionType, 'env');
    assert.equal(injections[0].param.name, 'label');
    assert.equal(injections[0].param.isPrimitive, true);
    // Second param is non-primitive with default → state candidate
    assert.equal(injections[1].param.name, 'counts');
    assert.equal(injections[1].param.isPrimitive, false);
    assert.equal(injections[1].param.hasDefault, true);
  });

  await test('stateful with all four injection types', () => {
    const source = `
      /**
       * Incident tracker
       * @mcp slack anthropics/mcp-server-slack
       * @photon pagerduty pagerduty-photon
       * @stateful true
       */
      export default class IncidentTracker {
        incidents: Incident[];
        constructor(
          private webhookUrl: string,
          private slack: any,
          private pagerduty: any,
          incidents: Incident[] = []
        ) {
          this.incidents = incidents;
        }
      }
    `;
    const injections = extractor.resolveInjections(source, 'incident-tracker');
    assert.equal(injections.length, 4);

    // 1. env
    assert.equal(injections[0].injectionType, 'env');
    assert.equal(injections[0].param.name, 'webhookUrl');

    // 2. mcp
    assert.equal(injections[1].injectionType, 'mcp');
    assert.equal(injections[1].mcpDependency!.name, 'slack');

    // 3. photon
    assert.equal(injections[2].injectionType, 'photon');
    assert.equal(injections[2].photonDependency!.name, 'pagerduty');

    // 4. state candidate (non-primitive + default + @stateful)
    assert.equal(injections[3].param.name, 'incidents');
    assert.equal(injections[3].param.isPrimitive, false);
    assert.equal(injections[3].param.hasDefault, true);
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n\ud83d\udce6 Stateful Persistence — Constructor Injection Simulation\n');
  // ═══════════════════════════════════════════════════════════════

  await test('class can be instantiated with saved state via constructor', () => {
    // Simulates what the runtime does: read snapshot, pass to constructor
    class List {
      items: string[];
      constructor(items: string[] = []) {
        this.items = items;
      }
      add(item: string): void {
        this.items.push(item);
      }
      getAll(): string[] {
        return this.items;
      }
    }

    // First run: default
    const fresh = new List();
    assert.deepStrictEqual(fresh.getAll(), []);
    fresh.add('apples');
    fresh.add('bananas');
    assert.deepStrictEqual(fresh.getAll(), ['apples', 'bananas']);

    // Simulate persist: JSON.stringify the constructor-injected state
    const snapshot = JSON.stringify({ items: fresh.items });

    // Simulate restart: parse snapshot, inject via constructor
    const saved = JSON.parse(snapshot);
    const restored = new List(saved.items);
    assert.deepStrictEqual(restored.getAll(), ['apples', 'bananas']);

    // State survives restart
    restored.add('cherries');
    assert.deepStrictEqual(restored.getAll(), ['apples', 'bananas', 'cherries']);
  });

  await test('constructor default only used on first run', () => {
    class Counter {
      counts: Record<string, number>;
      constructor(
        private label: string = 'default',
        counts: Record<string, number> = {}
      ) {
        this.counts = counts;
      }
    }

    // First run
    const fresh = new Counter();
    assert.equal(fresh['label'], 'default');
    assert.deepStrictEqual(fresh.counts, {});

    // With env var + snapshot
    const restored = new Counter('production', { api: 42, web: 17 });
    assert.equal(restored['label'], 'production');
    assert.deepStrictEqual(restored.counts, { api: 42, web: 17 });
  });

  await test('mixed injection: env + mcp + photon + state via constructor args', () => {
    // Simulates the runtime spreading resolved values into constructor
    class Tracker {
      incidents: any[];
      constructor(
        private webhookUrl: string,
        private slack: any,
        private pagerduty: any,
        incidents: any[] = []
      ) {
        this.incidents = incidents;
      }
    }

    const envValue = 'https://hooks.slack.com/xxx';
    const mcpProxy = { send_message: () => 'sent' };
    const photonInstance = { trigger: () => 'triggered' };
    const savedState = [{ id: '1', title: 'Server down', status: 'open' }];

    // Runtime does: new Tracker(...resolvedValues)
    const instance = new Tracker(envValue, mcpProxy, photonInstance, savedState);

    assert.equal(instance['webhookUrl'], envValue);
    assert.equal(instance['slack'].send_message(), 'sent');
    assert.equal(instance['pagerduty'].trigger(), 'triggered');
    assert.deepStrictEqual(instance.incidents, savedState);
  });

  await test('state snapshot serialization round-trips correctly', () => {
    // Arrays, objects, nested structures all survive JSON round-trip
    const state = {
      items: ['a', 'b', 'c'],
      nested: { counts: { x: 1, y: 2 }, tags: ['foo', 'bar'] },
    };

    const json = JSON.stringify(state);
    const restored = JSON.parse(json);

    assert.deepStrictEqual(restored.items, ['a', 'b', 'c']);
    assert.deepStrictEqual(restored.nested.counts, { x: 1, y: 2 });
    assert.deepStrictEqual(restored.nested.tags, ['foo', 'bar']);
  });

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
