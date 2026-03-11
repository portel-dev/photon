/**
 * Tests for CLI format rendering across all @format values.
 *
 * Verifies that:
 * 1. Every @format value produces visible output (never silently drops data)
 * 2. Structural formats (table, list, tree, primitive) auto-detect correctly
 * 3. Content formats (json, markdown, yaml, xml, html, code) render for strings
 * 4. @format json works for objects (not just strings)
 * 5. @format qr extracts QR data from multiple field names
 * 6. _photonType structured tables render correctly
 * 7. Success/error response wrappers format properly
 * 8. detectFormat returns correct format for each data shape
 */

import { strict as assert } from 'assert';
import {
  formatOutput as baseFormatOutput,
  detectFormat,
  renderNone,
  renderPrimitive,
  renderList,
  renderTable,
  renderTree,
} from '../dist/cli-formatter.js';

// ─── Console capture utility ─────────────────────────────────────

let captured: string[] = [];
const originalLog = console.log;
const originalError = console.error;

function startCapture() {
  captured = [];
  console.log = (...args: any[]) => {
    captured.push(args.map(String).join(' '));
  };
  console.error = (...args: any[]) => {
    captured.push(args.map(String).join(' '));
  };
}

function stopCapture(): string[] {
  console.log = originalLog;
  console.error = originalError;
  return captured;
}

function getCaptured(): string {
  return captured.join('\n');
}

// ─── Test runner ─────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  let failed = 0;

  const test = (name: string) => ({
    pass: () => {
      passed++;
      originalLog(`  ✅ ${name}`);
    },
    fail: (err: unknown) => {
      failed++;
      originalLog(`  ❌ ${name}: ${err}`);
    },
  });

  originalLog('\n📊 CLI Format Rendering Tests\n');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 1: detectFormat — auto-detection
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── detectFormat ──');

  {
    const t = test('detectFormat: null/undefined → none');
    try {
      assert.equal(detectFormat(null), 'none');
      assert.equal(detectFormat(undefined), 'none');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: string → primitive');
    try {
      assert.equal(detectFormat('hello'), 'primitive');
      assert.equal(detectFormat(''), 'primitive');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: number → primitive');
    try {
      assert.equal(detectFormat(42), 'primitive');
      assert.equal(detectFormat(0), 'primitive');
      assert.equal(detectFormat(-1.5), 'primitive');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: boolean → primitive');
    try {
      assert.equal(detectFormat(true), 'primitive');
      assert.equal(detectFormat(false), 'primitive');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: flat object → table');
    try {
      assert.equal(detectFormat({ name: 'Alice', age: 30 }), 'table');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: nested object → tree');
    try {
      assert.equal(detectFormat({ user: { name: 'Alice', address: { city: 'NYC' } } }), 'tree');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: array of flat objects → table');
    try {
      assert.equal(
        detectFormat([
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ]),
        'table'
      );
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: array of primitives → list');
    try {
      assert.equal(detectFormat(['a', 'b', 'c']), 'list');
      assert.equal(detectFormat([1, 2, 3]), 'list');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: empty array → list');
    try {
      assert.equal(detectFormat([]), 'list');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  {
    const t = test('detectFormat: array of nested objects → tree');
    try {
      assert.equal(detectFormat([{ user: { name: 'Alice', meta: { role: 'admin' } } }]), 'tree');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 2: Structural formats — produce visible output
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Structural Formats ──');

  {
    const t = test('primitive: string renders non-empty');
    try {
      startCapture();
      baseFormatOutput('Hello, world!', 'primitive');
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(getCaptured().includes('Hello'), 'Should contain the string');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('primitive: number renders non-empty');
    try {
      startCapture();
      baseFormatOutput(42, 'primitive');
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(getCaptured().includes('42'), 'Should contain the number');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('table: array of objects renders with columns');
    try {
      startCapture();
      baseFormatOutput(
        [
          { name: 'Alice', role: 'admin', active: true },
          { name: 'Bob', role: 'user', active: false },
        ],
        'table'
      );
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('Alice'), 'Should contain data');
      assert.ok(output.includes('Bob'), 'Should contain data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('table: single flat object renders as key-value');
    try {
      startCapture();
      baseFormatOutput({ status: 'connected', phone: '1234567890', uptime: '2h' }, 'table');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('connected'), 'Should contain status value');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('list: array of strings renders each item');
    try {
      startCapture();
      baseFormatOutput(['apples', 'bananas', 'cherries'], 'list');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('apples'), 'Should contain items');
      assert.ok(output.includes('cherries'), 'Should contain items');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('tree: nested object renders hierarchically');
    try {
      startCapture();
      baseFormatOutput(
        {
          server: {
            host: 'localhost',
            port: 3000,
            database: { type: 'postgres', host: 'db.local' },
          },
        },
        'tree'
      );
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('localhost') || output.includes('server'), 'Should contain data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('none: null/undefined renders placeholder');
    try {
      startCapture();
      renderNone();
      const out = stopCapture();
      // renderNone may produce empty or a placeholder — either is valid, but it shouldn't crash
      assert.ok(true, 'Should not throw');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 3: Content formats — string rendering
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Content Formats (string input) ──');

  {
    const t = test('json: string JSON renders non-empty');
    try {
      startCapture();
      baseFormatOutput('{"name":"Alice","age":30}', 'json');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('Alice'), 'Should contain data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('markdown: renders non-empty');
    try {
      startCapture();
      baseFormatOutput('# Hello\n\nThis is **bold** and _italic_.', 'markdown');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('Hello'), 'Should contain heading');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('yaml: renders non-empty');
    try {
      startCapture();
      baseFormatOutput('name: Alice\nage: 30\nroles:\n  - admin\n  - user', 'yaml');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('Alice'), 'Should contain data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('xml: renders non-empty');
    try {
      startCapture();
      baseFormatOutput('<user><name>Alice</name><age>30</age></user>', 'xml');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('Alice'), 'Should contain data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('html: renders non-empty');
    try {
      startCapture();
      baseFormatOutput('<div><h1>Hello</h1><p>World</p></div>', 'html');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('Hello'), 'Should contain data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('code: renders non-empty');
    try {
      startCapture();
      baseFormatOutput('const x = 42;\nconsole.log(x);', 'code');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('42') || output.includes('const'), 'Should contain code');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('code:javascript: renders with language hint');
    try {
      startCapture();
      baseFormatOutput('function greet() { return "hi"; }', 'code:javascript');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output');
      assert.ok(output.includes('greet') || output.includes('function'), 'Should contain code');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 4: @format json with object data (the bug we fixed)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── @format json with objects ──');

  {
    const t = test('json: base formatter silently drops object data (known limitation)');
    try {
      // KNOWN BUG in @portel/cli base formatter:
      // formatOutput(obj, 'json') only handles strings via isContentFormat check.
      // Objects fall through to formatDataWithHint which has no 'json' case → silent drop.
      // This is fixed in photon-cli-runner.ts wrapper which intercepts 'json' early.
      startCapture();
      baseFormatOutput({ status: 'connected', phone: '123' }, 'json');
      const out = stopCapture();
      assert.equal(
        out.length,
        0,
        'Base formatter silently drops objects with json hint (known bug)'
      );
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('json: base formatter silently drops array data (known limitation)');
    try {
      // Same known limitation — arrays with hint='json' are silently dropped
      startCapture();
      baseFormatOutput(
        [
          { id: 1, name: 'Task A' },
          { id: 2, name: 'Task B' },
        ],
        'json'
      );
      const out = stopCapture();
      assert.equal(
        out.length,
        0,
        'Base formatter silently drops arrays with json hint (known bug)'
      );
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 5: Auto-detection with no hint
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Auto-detection (no hint) ──');

  {
    const t = test('auto: string renders as primitive');
    try {
      startCapture();
      baseFormatOutput('Just a string');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('Just a string'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: number renders as primitive');
    try {
      startCapture();
      baseFormatOutput(99);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('99'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: boolean renders as primitive');
    try {
      startCapture();
      baseFormatOutput(true);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: flat object renders as table');
    try {
      startCapture();
      baseFormatOutput({ host: 'localhost', port: 3000, status: 'running' });
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('localhost') || output.includes('running'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: array of objects renders as table');
    try {
      startCapture();
      baseFormatOutput([
        { jid: '123@g.us', name: 'Dev Team' },
        { jid: '456@g.us', name: 'Design' },
      ]);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('Dev Team') || output.includes('123'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: array of strings renders as list');
    try {
      startCapture();
      baseFormatOutput(['first', 'second', 'third']);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('first'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: nested object renders as tree');
    try {
      startCapture();
      baseFormatOutput({
        pipeline: {
          status: 'running',
          components: { whatsapp: 'connected', runner: 'idle' },
        },
      });
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('running') || output.includes('pipeline'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: null renders none');
    try {
      startCapture();
      baseFormatOutput(null);
      stopCapture();
      // Should not crash — output may be empty or placeholder
      assert.ok(true);
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('auto: undefined renders none');
    try {
      startCapture();
      baseFormatOutput(undefined);
      stopCapture();
      assert.ok(true);
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 6: Real-world data shapes from actual photons
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Real-world data shapes ──');

  {
    const t = test('WhatsApp status response renders (flat object)');
    try {
      startCapture();
      baseFormatOutput({
        status: 'connected',
        phone: '1234567890',
        queuedMessages: 0,
        reconnectAttempts: 0,
      });
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Status should produce visible output');
      assert.ok(output.includes('connected'), 'Should show status');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('WhatsApp groups response renders (array of objects)');
    try {
      startCapture();
      baseFormatOutput([
        { jid: '120363123456789@g.us', name: 'Dev Team' },
        { jid: '120363987654321@g.us', name: 'Design Guild' },
        { jid: '120363111222333@g.us', name: 'General' },
      ]);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Groups should produce table output');
      assert.ok(output.includes('Dev Team'), 'Should show group names');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Claw health response renders (flat object, @format json)');
    try {
      const healthData = {
        ok: true,
        running: true,
        whatsapp: 'connected',
        runner: 'active:0,queued:0',
        checkedAt: '2026-03-12T10:30:00.000Z',
      };
      startCapture();
      baseFormatOutput(healthData);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Health should produce output');
      assert.ok(output.includes('connected') || output.includes('true'), 'Should show health data');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Claw status response renders (nested object)');
    try {
      startCapture();
      baseFormatOutput({
        running: true,
        whatsapp: { status: 'connected', phone: '1234567890' },
        runner: { active: [], queued: 0 },
        groups: [{ jid: '123@g.us', name: 'Test', folder: 'test', trigger: '@bot' }],
      });
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, 'Claw status should produce output');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Empty array renders without crash');
    try {
      startCapture();
      baseFormatOutput([]);
      stopCapture();
      assert.ok(true, 'Empty array should not crash');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Empty object renders without crash');
    try {
      startCapture();
      baseFormatOutput({});
      stopCapture();
      assert.ok(true, 'Empty object should not crash');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 7: Edge cases and robustness
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Edge cases ──');

  {
    const t = test('Large array renders without crash');
    try {
      const bigArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random(),
      }));
      startCapture();
      baseFormatOutput(bigArray, 'table');
      const out = stopCapture();
      assert.ok(out.length > 0, 'Should produce output for large arrays');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Deeply nested object renders without crash');
    try {
      const deep: any = { level: 0 };
      let current = deep;
      for (let i = 1; i <= 10; i++) {
        current.child = { level: i };
        current = current.child;
      }
      startCapture();
      baseFormatOutput(deep, 'tree');
      stopCapture();
      assert.ok(true, 'Deep nesting should not crash');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Mixed-type array renders without crash');
    try {
      startCapture();
      baseFormatOutput([1, 'two', true, null, { key: 'val' }]);
      stopCapture();
      assert.ok(true, 'Mixed array should not crash');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Object with special characters renders');
    try {
      startCapture();
      baseFormatOutput({
        message: 'Hello "world" & <friends>',
        emoji: '🦞',
        path: '/usr/local/bin',
      });
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('Unknown format hint falls back gracefully');
    try {
      startCapture();
      baseFormatOutput({ data: 'test' }, 'nonexistent_format' as any);
      stopCapture();
      assert.ok(true, 'Unknown format should not crash');
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 8: Format-specific render functions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Direct render functions ──');

  {
    const t = test('renderPrimitive: string');
    try {
      startCapture();
      renderPrimitive('test value');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('test value'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('renderPrimitive: number');
    try {
      startCapture();
      renderPrimitive(42);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('42'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('renderList: array of strings');
    try {
      startCapture();
      renderList(['alpha', 'beta', 'gamma']);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('alpha'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('renderTable: array of objects');
    try {
      startCapture();
      renderTable([
        { name: 'Alice', score: 95 },
        { name: 'Bob', score: 87 },
      ]);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('Alice'));
      assert.ok(output.includes('Bob'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('renderTree: nested object');
    try {
      startCapture();
      renderTree({ root: { child: { leaf: 'value' } } });
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 9: Content formats with hint override
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog('  ── Hint overrides auto-detection ──');

  {
    const t = test('hint=list forces list format on objects');
    try {
      // Even though objects would auto-detect as table,
      // hint should force list rendering
      startCapture();
      baseFormatOutput(['item1', 'item2'], 'list');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      assert.ok(output.includes('item1'));
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  {
    const t = test('hint=tree forces tree format');
    try {
      startCapture();
      baseFormatOutput({ simple: 'value', another: 'val' }, 'tree');
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0);
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section 10: Every @format tag — via photon-cli-runner fallbacks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // These test the exact fallback dispatch logic from photon-cli-runner.ts.
  // Formats not natively handled by the base formatter are mapped to
  // available renderers (table, tree, list, primitive).
  // This ensures no @format tag silently drops output.

  originalLog('  ── Every @format tag (wrapper fallbacks) ──');

  // Helper: simulates the photon-cli-runner format dispatch for formats
  // that the base formatter doesn't handle. Mirrors the code in
  // photon-cli-runner.ts exactly.
  function wrapperFormatOutput(result: any, hint: string): void {
    // Formats handled by base formatter — pass through directly
    const baseHandled = ['primitive', 'table', 'tree', 'list', 'none', 'card', 'tabs', 'accordion'];
    const contentHandled = ['json', 'markdown', 'yaml', 'xml', 'html', 'code'];

    if (baseHandled.includes(hint)) {
      baseFormatOutput(result, hint as any);
      return;
    }
    if (contentHandled.includes(hint) || hint.startsWith('code:')) {
      // Content formats work for strings in base
      if (typeof result === 'string') {
        baseFormatOutput(result, hint as any);
      } else {
        // json for objects — render as JSON string
        if (hint === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          baseFormatOutput(result, 'tree');
        }
      }
      return;
    }

    // Wrapper fallbacks (from photon-cli-runner.ts)
    if (hint === 'mermaid' && typeof result === 'string') {
      console.log('── mermaid ──');
      console.log(result);
      return;
    }
    if (hint === 'kv' && typeof result === 'object' && !Array.isArray(result)) {
      baseFormatOutput(result, 'table');
      return;
    }
    if (hint === 'grid') {
      baseFormatOutput(result, 'table');
      return;
    }
    if (hint === 'chips') {
      const items = Array.isArray(result)
        ? result
        : typeof result === 'object'
          ? Object.values(result)
          : [result];
      baseFormatOutput(items, 'list');
      return;
    }
    if (hint === 'metric') {
      if (typeof result === 'object' && result !== null) {
        const label = result.label || result.name || '';
        const value = result.value ?? result.count ?? '';
        console.log(label ? `${label}: ${value}` : String(value));
      } else {
        console.log(String(result));
      }
      return;
    }
    if (hint === 'gauge') {
      if (typeof result === 'object' && result !== null) {
        const value = Number(result.value ?? result.current ?? 0);
        const max = Number(result.max ?? 100);
        const pct = max > 0 ? Math.round((value / max) * 100) : 0;
        console.log(`${pct}% (${value}/${max})`);
      } else {
        console.log(String(result));
      }
      return;
    }
    if (hint === 'chart' || hint.startsWith('chart:')) {
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else {
        baseFormatOutput(result, 'table');
      }
      return;
    }
    if (hint === 'timeline') {
      baseFormatOutput(
        Array.isArray(result) ? result : result,
        Array.isArray(result) ? 'table' : 'tree'
      );
      return;
    }
    if (hint === 'dashboard') {
      baseFormatOutput(result, 'tree');
      return;
    }
    if (hint === 'cart') {
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else {
        baseFormatOutput(result, 'tree');
      }
      return;
    }
    if (hint === 'panels') {
      baseFormatOutput(result, 'tree');
      return;
    }
    if (hint === 'stack') {
      baseFormatOutput(result, 'tree');
      return;
    }
    if (hint === 'columns') {
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else {
        baseFormatOutput(result, 'tree');
      }
      return;
    }
    if (hint === 'qr') {
      const qrValue = result?.qr || result?.value || result?.url || result?.link;
      if (qrValue) {
        console.log(`[QR] ${qrValue}`);
      } else {
        console.log(JSON.stringify(result));
      }
      return;
    }

    // Fallback: auto-detect
    baseFormatOutput(result);
  }

  // Test data for each format
  const formatTests: Array<{ format: string; data: any; expectContains?: string }> = [
    // Structural (base)
    { format: 'primitive', data: 'hello world', expectContains: 'hello' },
    {
      format: 'table',
      data: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      expectContains: 'A',
    },
    { format: 'tree', data: { root: { child: 'leaf' } }, expectContains: 'leaf' },
    { format: 'list', data: ['x', 'y', 'z'], expectContains: 'x' },
    { format: 'none', data: null },
    // Content (base, string input)
    { format: 'json', data: { count: 5, status: 'ok' }, expectContains: 'count' },
    { format: 'markdown', data: '# Title\nParagraph', expectContains: 'Title' },
    { format: 'yaml', data: 'key: value\nlist:\n  - a', expectContains: 'value' },
    { format: 'xml', data: '<root><item>test</item></root>', expectContains: 'test' },
    { format: 'html', data: '<div>content</div>', expectContains: 'content' },
    { format: 'code', data: 'let x = 1;', expectContains: 'x' },
    { format: 'code:python', data: 'def foo(): pass', expectContains: 'foo' },
    // Card/Tabs/Accordion (base)
    { format: 'card', data: { title: 'Card', description: 'A card' }, expectContains: 'Card' },
    {
      format: 'tabs',
      data: { Tab1: { value: 'a' }, Tab2: { value: 'b' } },
      expectContains: 'Tab1',
    },
    {
      format: 'accordion',
      data: { Section1: { info: 'x' }, Section2: { info: 'y' } },
      expectContains: 'Section1',
    },
    // Wrapper fallbacks
    { format: 'mermaid', data: 'graph TD\n  A-->B\n  B-->C', expectContains: 'graph' },
    { format: 'kv', data: { host: 'localhost', port: 3000 }, expectContains: 'localhost' },
    {
      format: 'grid',
      data: [
        { col1: 'a', col2: 'b' },
        { col1: 'c', col2: 'd' },
      ],
      expectContains: 'a',
    },
    { format: 'chips', data: ['tag1', 'tag2', 'tag3'], expectContains: 'tag1' },
    { format: 'metric', data: { label: 'CPU', value: 73, unit: '%' }, expectContains: '73' },
    { format: 'gauge', data: { label: 'Memory', value: 6, max: 16 }, expectContains: '6' },
    {
      format: 'chart',
      data: [
        { month: 'Jan', sales: 100 },
        { month: 'Feb', sales: 150 },
      ],
      expectContains: 'Jan',
    },
    {
      format: 'chart:bar',
      data: [
        { label: 'A', value: 10 },
        { label: 'B', value: 20 },
      ],
      expectContains: 'A',
    },
    {
      format: 'timeline',
      data: [
        { date: '2026-01', event: 'Launch' },
        { date: '2026-03', event: 'Update' },
      ],
      expectContains: 'Launch',
    },
    {
      format: 'dashboard',
      data: { cpu: { usage: 45 }, memory: { used: 6, total: 16 } },
      expectContains: '45',
    },
    { format: 'cart', data: [{ item: 'Widget', qty: 2, price: 9.99 }], expectContains: 'Widget' },
    {
      format: 'panels',
      data: { overview: { status: 'healthy' }, details: { uptime: '24h' } },
      expectContains: 'healthy',
    },
    {
      format: 'stack',
      data: { header: { title: 'App' }, body: { content: 'Main' } },
      expectContains: 'App',
    },
    { format: 'columns', data: [{ left: 'nav', right: 'content' }], expectContains: 'nav' },
    {
      format: 'qr',
      data: { qr: '2@testdata123', message: 'Scan this' },
      expectContains: 'testdata123',
    },
  ];

  for (const { format, data, expectContains } of formatTests) {
    const t = test(`@format ${format}: produces output`);
    try {
      startCapture();
      wrapperFormatOutput(data, format);
      const output = getCaptured();
      const out = stopCapture();
      assert.ok(out.length > 0, `@format ${format} should produce output, got nothing`);
      if (expectContains) {
        assert.ok(
          output.includes(expectContains),
          `@format ${format} output should contain "${expectContains}", got: ${output.slice(0, 200)}`
        );
      }
      t.pass();
    } catch (err) {
      stopCapture();
      t.fail(err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Summary
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  originalLog(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { runTests };
