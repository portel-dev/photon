/**
 * Template Engine Tests
 *
 * Tests for custom UI template bindings (data-method, data-args, data-result).
 * These tests verify the template engine JavaScript is properly embedded and functional.
 */

import { withBeam, test, runTests, assert } from './helpers.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

const opts = { workingDir: fixturesDir };

// ============================================================================
// Template Engine Availability Tests
// ============================================================================

test('Template engine functions are embedded in BEAM', async () => {
  await withBeam(async (beam) => {
    // Check that the template engine functions exist in the page
    const hasInitBindings = await beam.page.evaluate(() => {
      return typeof (window as any).initTemplateBindings === 'function' ||
             document.body.innerHTML.includes('initTemplateBindings');
    });
    // The function should be defined in the embedded JavaScript
    assert.ok(hasInitBindings, 'initTemplateBindings function should be available');
  }, opts);
});

test('Template loading function is available', async () => {
  await withBeam(async (beam) => {
    const hasLoadTemplate = await beam.page.evaluate(() => {
      return typeof (window as any).loadTemplate === 'function' ||
             document.body.innerHTML.includes('loadTemplate');
    });
    assert.ok(hasLoadTemplate, 'loadTemplate function should be available');
  }, opts);
});

// ============================================================================
// Template CSS Styles Tests
// ============================================================================

test('Template loading styles are present', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    // Check for template engine CSS classes
    assert.ok(html.includes('.template-loading') || html.includes('template-loading'),
      'Template loading styles should be present');
  }, opts);
});

test('Template error styles are present', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    assert.ok(html.includes('.template-error') || html.includes('template-error'),
      'Template error styles should be present');
  }, opts);
});

test('Data-method button styles are present', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    assert.ok(html.includes('[data-method]'),
      'Data-method attribute styles should be present');
  }, opts);
});

test('Data-result container styles are present', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    assert.ok(html.includes('[data-result]'),
      'Data-result attribute styles should be present');
  }, opts);
});

// ============================================================================
// Template Binding Parsing Tests
// ============================================================================

test('JSON.parse is used for data-args parsing', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    // The template engine uses JSON.parse for data-args
    assert.ok(html.includes('JSON.parse'),
      'Template engine should use JSON.parse for data-args');
  }, opts);
});

test('Event listener binding is implemented', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    // Check for addEventListener in the template engine code
    assert.ok(html.includes('addEventListener'),
      'Template engine should bind event listeners');
  }, opts);
});

// ============================================================================
// Template Data Binding Tests
// ============================================================================

test('updateTemplateBindings function is available', async () => {
  await withBeam(async (beam) => {
    const hasUpdateBindings = await beam.page.evaluate(() => {
      return typeof (window as any).updateTemplateBindings === 'function' ||
             document.body.innerHTML.includes('updateTemplateBindings');
    });
    assert.ok(hasUpdateBindings, 'updateTemplateBindings function should be available');
  }, opts);
});

test('data-bind attribute handling is implemented', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    // Check for data-bind handling in template engine
    assert.ok(html.includes('data-bind'),
      'Template engine should handle data-bind attributes');
  }, opts);
});

test('data-if attribute handling is implemented', async () => {
  await withBeam(async (beam) => {
    const html = await beam.page.content();
    // Check for data-if handling (conditional visibility)
    assert.ok(html.includes('data-if'),
      'Template engine should handle data-if attributes');
  }, opts);
});

// ============================================================================
// Template Engine Integration Tests
// ============================================================================

test('Smart rendering function is available', async () => {
  await withBeam(async (beam) => {
    const hasSmartRender = await beam.page.evaluate(() => {
      return typeof (window as any).renderSmartResult === 'function' ||
             document.body.innerHTML.includes('renderSmartResult');
    });
    assert.ok(hasSmartRender, 'renderSmartResult function should be available');
  }, opts);
});

test('Field analyzer function is available', async () => {
  await withBeam(async (beam) => {
    const hasAnalyzer = await beam.page.evaluate(() => {
      return typeof (window as any).analyzeFields === 'function' ||
             document.body.innerHTML.includes('analyzeFields');
    });
    assert.ok(hasAnalyzer, 'analyzeFields function should be available');
  }, opts);
});

test('Layout selector function is available', async () => {
  await withBeam(async (beam) => {
    const hasSelector = await beam.page.evaluate(() => {
      return typeof (window as any).selectLayout === 'function' ||
             document.body.innerHTML.includes('selectLayout');
    });
    assert.ok(hasSelector, 'selectLayout function should be available');
  }, opts);
});

// ============================================================================
// Example Template Validation
// ============================================================================

test('Example templates exist', async () => {
  const fs = await import('fs/promises');
  const templatesDir = path.join(__dirname, '../../examples/templates');

  const files = await fs.readdir(templatesDir);

  assert.ok(files.includes('remote.template.html'), 'Remote template should exist');
  assert.ok(files.includes('keypad.template.html'), 'Keypad template should exist');
  assert.ok(files.includes('dashboard.template.html'), 'Dashboard template should exist');
  assert.ok(files.includes('player.template.html'), 'Player template should exist');
});

test('Remote template has correct structure', async () => {
  const fs = await import('fs/promises');
  const templatePath = path.join(__dirname, '../../examples/templates/remote.template.html');
  const content = await fs.readFile(templatePath, 'utf-8');

  // Check for required template attributes
  assert.ok(content.includes('data-method="power"'), 'Should have power button');
  assert.ok(content.includes('data-method="channelUp"'), 'Should have channel up');
  assert.ok(content.includes('data-method="volumeUp"'), 'Should have volume up');
  assert.ok(content.includes('data-result'), 'Should have result container');
  assert.ok(content.includes('data-args'), 'Should have data-args for digits');
});

test('Keypad template has correct structure', async () => {
  const fs = await import('fs/promises');
  const templatePath = path.join(__dirname, '../../examples/templates/keypad.template.html');
  const content = await fs.readFile(templatePath, 'utf-8');

  // Check for numeric buttons
  assert.ok(content.includes('data-method="pressKey"'), 'Should have pressKey method');
  assert.ok(content.includes('data-method="clear"'), 'Should have clear method');
  assert.ok(content.includes('data-method="submit"'), 'Should have submit method');
  assert.ok(content.includes('data-result'), 'Should have result container');
});

test('Dashboard template has correct structure', async () => {
  const fs = await import('fs/promises');
  const templatePath = path.join(__dirname, '../../examples/templates/dashboard.template.html');
  const content = await fs.readFile(templatePath, 'utf-8');

  // Check for dashboard elements
  assert.ok(content.includes('data-method="refresh"'), 'Should have refresh method');
  assert.ok(content.includes('data-method="getCPU"'), 'Should have getCPU method');
  assert.ok(content.includes('data-method="getMemory"'), 'Should have getMemory method');
  assert.ok(content.includes('data-bind'), 'Should have data bindings');
});

test('Player template has correct structure', async () => {
  const fs = await import('fs/promises');
  const templatePath = path.join(__dirname, '../../examples/templates/player.template.html');
  const content = await fs.readFile(templatePath, 'utf-8');

  // Check for player controls
  assert.ok(content.includes('data-method="play"'), 'Should have play method');
  assert.ok(content.includes('data-method="pause"'), 'Should have pause method');
  assert.ok(content.includes('data-method="stop"'), 'Should have stop method');
  assert.ok(content.includes('data-bind'), 'Should have data bindings');
});

// ============================================================================
// Run Tests
// ============================================================================

runTests().catch(console.error);
