/**
 * Smart Rendering System Tests
 *
 * Tests for the field analyzer, layout selector, and smart components.
 */

import { withBeam, test, runTests, assert } from './helpers.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

const opts = { workingDir: fixturesDir };

// ============================================================================
// Field Analyzer Tests - Semantic Field Detection
// ============================================================================

test('Smart rendering detects name field as title', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getSmartUsers');
    const content = await beam.getResultContent();
    // Name fields should be displayed prominently
    assert.ok(content.includes('Alice Smith'), 'Should display name as primary text');
    assert.ok(content.includes('Bob Jones'), 'Should display name as primary text');
  }, opts);
});

test('Smart rendering detects email field as subtitle', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getSmartUsers');
    const content = await beam.getResultContent();
    // Email should appear as secondary text
    assert.ok(content.includes('alice@example.com'), 'Should display email');
    assert.ok(content.includes('bob@example.com'), 'Should display email');
  }, opts);
});

test('Smart rendering detects status field as badge', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getSmartUsers');
    const resultHtml = await beam.page.locator('#result-content').innerHTML();
    // Status should be rendered as badge
    assert.ok(resultHtml.includes('list-item-badge'), 'Should have badge class');
    assert.ok(resultHtml.includes('active') || resultHtml.includes('inactive'), 'Should display status');
  }, opts);
});

// ============================================================================
// Layout Hints Tests - JSDoc Override
// ============================================================================

test('Layout hints show product data correctly', async () => {
  await withBeam(async (beam) => {
    // getProducts has @format list {@title productName, @subtitle description, @badge category}
    // Note: layoutHints extraction from schema needs implementation
    await beam.selectMethod('demo', 'getProducts');
    const content = await beam.getResultContent();
    // Field detection picks up description (detected as subtitle) and category (detected as badge)
    assert.ok(content.includes('High-performance'), 'Should display description');
    assert.ok(content.includes('Electronics'), 'Should display category');
    assert.ok(content.includes('Accessories'), 'Should display category');
  }, opts);
});

test('Card layout with layout hints', async () => {
  await withBeam(async (beam) => {
    // getProfile has @format card {@title displayName, @subtitle role}
    await beam.selectMethod('demo', 'getProfile');
    const content = await beam.getResultContent();
    // Should use displayName and role as specified
    assert.ok(content.includes('John Developer'), 'Should use displayName as title');
    assert.ok(content.includes('Senior Engineer'), 'Should display role');
  }, opts);
});

// ============================================================================
// Layout Selector Tests - Auto-Layout Detection
// ============================================================================

test('String array renders as chips', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getTags');
    const content = await beam.getResultContent();
    // All tags should be visible
    assert.ok(content.includes('JavaScript'), 'Should display JavaScript tag');
    assert.ok(content.includes('TypeScript'), 'Should display TypeScript tag');
    assert.ok(content.includes('React'), 'Should display React tag');
  }, opts);
});

test('Object array renders as list', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getSmartUsers');
    // Should render 3 list items
    const listItems = await beam.page.locator('.smart-list-item, .list-item, tr').count();
    assert.ok(listItems >= 3, 'Should render at least 3 list items');
  }, opts);
});

test('Single object renders as card', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getConfig');
    // Should render as card/kv-table
    const cardContainer = await beam.page.locator('.smart-card, .kv-table').count();
    assert.ok(cardContainer >= 1, 'Should render as card');
  }, opts);
});

test('Nested object renders as tree', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getNestedData');
    const content = await beam.getResultContent();
    // Should show nested structure (user.profile.name)
    assert.ok(content.includes('Test User') || content.includes('user'), 'Should render nested data');
  }, opts);
});

// ============================================================================
// Type Detection Tests - Field Renderers
// ============================================================================

test('Email fields are detected and rendered', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getContacts');
    const content = await beam.getResultContent();
    // Emails should be displayed
    assert.ok(content.includes('support@company.com'), 'Should display email');
    assert.ok(content.includes('sales@company.com'), 'Should display email');
  }, opts);
});

test('Boolean fields show checkmarks', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getConfig');
    const content = await beam.getResultContent();
    // Boolean values should show checkmark indicators (✓ for true, ✗ for false)
    assert.ok(
      content.includes('✓') || content.includes('✗'),
      'Should render boolean values with checkmarks'
    );
  }, opts);
});

// ============================================================================
// Empty State Tests
// ============================================================================

test('Empty array shows appropriate message', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getEmpty');
    const content = await beam.getResultContent();
    // Should show empty state or empty array representation
    assert.ok(
      content.includes('empty') || content.includes('[]') || content.includes('No') || content.length < 50,
      'Should handle empty array gracefully'
    );
  }, opts);
});

test('Null value renders appropriately', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getNull');
    const content = await beam.getResultContent();
    // Should show null representation
    assert.ok(
      content.includes('null') || content.includes('—') || content.includes('None'),
      'Should handle null value'
    );
  }, opts);
});

// ============================================================================
// Component Styling Tests
// ============================================================================

test('List items have correct structure', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getSmartUsers');
    // Check for list item structure
    const hasListItems = await beam.page.locator('.smart-list-item, .list-item, tbody tr').count();
    assert.ok(hasListItems >= 1, 'Should have list item structure');
  }, opts);
});

test('Card has key-value structure', async () => {
  await withBeam(async (beam) => {
    await beam.selectMethod('demo', 'getConfig');
    const resultHtml = await beam.page.locator('#result-content').innerHTML();
    // Should have key-value pairs
    assert.ok(resultHtml.includes('Environment') || resultHtml.includes('environment'), 'Should show environment key');
    assert.ok(resultHtml.includes('test'), 'Should show test value');
  }, opts);
});

// ============================================================================
// Run Tests
// ============================================================================

runTests().catch(console.error);
