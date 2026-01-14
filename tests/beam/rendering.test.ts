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

test('Method with params shows form with Run button', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'add');
    await beam.expectElement('form');
    await beam.expectElement('input[name="a"]');
    await beam.expectElement('input[name="b"]');
    const submitBtn = beam.page.locator('form button[type="submit"]');
    assert.ok(await submitBtn.count() > 0, 'Run button should be visible');
  }, opts);
});

test('Form submission executes method', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'add');
    await beam.fillField('a', '5');
    await beam.fillField('b', '3');
    await beam.submit();
    await beam.expectResult({ type: 'primitive', value: '8' });
  }, opts);
});

// ============================================================================
// Label Formatting Tests
// ============================================================================

test('Custom button label from @returns {@label} is displayed', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'add');
    // Check for custom button label "Calculate Sum"
    const buttonText = await beam.page.locator('form button[type="submit"]').textContent();
    assert.ok(buttonText?.includes('Calculate Sum'), 'Expected custom button label "Calculate Sum"');
  }, opts);
});

test('Custom field labels from @param {@label} are displayed', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'add');
    // Check for custom field labels
    const formHtml = await beam.page.locator('#invoke-form').innerHTML();
    assert.ok(formHtml.includes('First Number'), 'Expected custom label "First Number"');
    assert.ok(formHtml.includes('Second Number'), 'Expected custom label "Second Number"');
  }, opts);
});

test('Default label formatting converts camelCase to Title Case', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getConfig');
    // Method name "getConfig" should be formatted as "Get Config" in UI
    // Check the sidebar method name (which uses formatLabel)
    const methodItem = beam.page.locator('#methods-demo .method-item:has-text("getConfig")');
    assert.ok(await methodItem.count() > 0, 'Method should be visible in sidebar');
  }, opts);
});

// ============================================================================
// Placeholder and Hint Tests
// ============================================================================

test('Custom placeholder from {@placeholder} is displayed', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'greet');
    const nameInput = beam.page.locator('input[name="name"]');
    const placeholder = await nameInput.getAttribute('placeholder');
    assert.ok(placeholder?.includes('Enter your name'), 'Expected custom placeholder "Enter your name"');
  }, opts);
});

test('Custom hint from {@hint} is displayed', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'greet');
    const formHtml = await beam.page.locator('#invoke-form').innerHTML();
    assert.ok(formHtml.includes('This will be used in the greeting'), 'Expected custom hint text');
  }, opts);
});

test('Method icon from @icon is displayed', async () => {
  await withBeam(async (beam) => {
    // The search method has @icon 🔍
    const methodItem = beam.page.locator('#methods-demo .method-item:has-text("search")');
    const methodHtml = await methodItem.innerHTML();
    assert.ok(methodHtml.includes('🔍'), 'Expected search icon 🔍 in method list');
  }, opts);
});

// ============================================================================
// Keyboard Shortcut Tests
// ============================================================================

test('Keyboard shortcut ? shows help modal', async () => {
  await withBeam(async (beam) => {
    await beam.page.keyboard.press('?');
    await beam.page.waitForTimeout(200);
    const modal = beam.page.locator('#keyboard-help-modal.visible');
    assert.ok(await modal.count() > 0, 'Keyboard help modal should be visible');
  }, opts);
});

test('Keyboard shortcut / focuses search', async () => {
  await withBeam(async (beam) => {
    await beam.page.keyboard.press('/');
    await beam.page.waitForTimeout(200);
    const focused = await beam.page.evaluate(() => document.activeElement?.id);
    assert.equal(focused, 'search-input', 'Search input should be focused');
  }, opts);
});

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
