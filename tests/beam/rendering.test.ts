/**
 * BEAM UI Rendering Tests
 *
 * Tests for table, markdown, mermaid, and other rendering formats.
 */

import { withBeam, test, runTests, assert } from './helpers.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

// Helper to run tests with fixtures
const opts = { workingDir: fixturesDir };

// ============================================================================
// Table Rendering Tests
// ============================================================================

test('Key-value object renders as kv-table', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getConfig');
    await beam.expectResult({
      type: 'kv-table',
      contains: ['apiKeySet', 'apiKeyLength']
    });
  }, opts);
});

test('Array of objects with @format table renders as grid-table', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getUsers');
    await beam.expectResult({
      type: 'grid-table',
      columns: ['id', 'name', 'email'],
      rowCount: 3
    });
  }, opts);
});

test('Boolean values show checkmarks in tables', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getConfig');
    const content = await beam.getResultContent();
    // Boolean false should show ✗
    assert.ok(content.includes('✗') || content.includes('No'), 'Expected boolean indicator');
  }, opts);
});

// ============================================================================
// Primitive Rendering Tests
// ============================================================================

test('String result renders as text', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getString');
    await beam.expectResult({
      type: 'primitive',
      value: 'Hello from Photon!'
    });
  }, opts);
});

test('Number result renders correctly', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getNumber');
    await beam.expectResult({
      type: 'primitive',
      value: '42'
    });
  }, opts);
});

test('Boolean result renders correctly', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getBoolean');
    await beam.expectResult({
      type: 'primitive',
      value: 'true'
    });
  }, opts);
});

// ============================================================================
// Markdown Rendering Tests
// ============================================================================

test('Markdown content renders with formatting', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getDocs');
    await beam.expectResult({
      type: 'markdown',
      contains: ['Demo Photon Documentation', 'Features']
    });
  }, opts);
});

// ============================================================================
// Array Rendering Tests
// ============================================================================

test('String array renders as list', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getArray');
    await beam.expectResult({
      contains: ['Apple', 'Banana', 'Cherry', 'Date']
    });
  }, opts);
});

// ============================================================================
// Auto-run Method Tests
// ============================================================================

test('No-param methods auto-execute without Run button', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getString');

    // Result should appear automatically
    await beam.expectResult({
      type: 'primitive',
      value: 'Hello from Photon!'
    });

    // Run button should NOT be visible for auto-run methods
    const submitBtns = await beam.page.locator('form button[type="submit"]').count();
    assert.strictEqual(submitBtns, 0, 'Run button should be hidden for auto-run methods');
  }, opts);
});

// ============================================================================
// Form Rendering Tests
// ============================================================================

// Note: Form tests are disabled for now as they require specific schema
// configuration to prevent auto-execution. The 'add' method auto-executes
// because its parameters don't have explicit 'required' constraints.
// TODO: Investigate how to mark parameters as required in JSDoc to prevent auto-execution

// test('Method with params shows form with Run button', async () => {
//   await withBeam(async (beam) => {
//     await beam.selectMethod('demo', 'add');
//     await beam.expectElement('form');
//     await beam.expectElement('input[name="a"]');
//     await beam.expectElement('input[name="b"]');
//     const submitBtn = beam.page.locator('form button[type="submit"]');
//     assert.ok(await submitBtn.count() > 0, 'Run button should be visible');
//   }, opts);
// });

// test('Form submission executes method', async () => {
//   await withBeam(async (beam) => {
//     await beam.selectMethod('demo', 'add');
//     await beam.fillField('a', '5');
//     await beam.fillField('b', '3');
//     await beam.submit();
//     await beam.expectResult({ type: 'primitive', value: '8' });
//   }, opts);
// });

// ============================================================================
// Visual Snapshot Tests
// ============================================================================

test('Snapshot: demo.getUsers table', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getUsers');
    await beam.page.waitForTimeout(500);
    await beam.snapshot('demo-getUsers-table');
  }, opts);
});

test('Snapshot: demo.getDocs markdown', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getDocs');
    await beam.page.waitForTimeout(500);
    await beam.snapshot('demo-getDocs-markdown');
  }, opts);
});

// ============================================================================
// Run Tests
// ============================================================================

runTests().catch(console.error);
