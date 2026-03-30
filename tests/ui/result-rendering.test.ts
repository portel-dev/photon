/**
 * Result Rendering Tests — Validate layout auto-detection against fixtures.
 *
 * Tests that the result-viewer's _selectLayout() logic maps data shapes
 * to the expected layout types. Uses fixtures from fixtures/result-layouts.json.
 *
 * Since _selectLayout() is a private method on a Lit component, we replicate
 * its auto-detection logic here as a pure function and test against fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type LayoutType =
  | 'table'
  | 'list'
  | 'card'
  | 'kv'
  | 'tree'
  | 'json'
  | 'markdown'
  | 'mermaid'
  | 'code'
  | 'text'
  | 'chips'
  | 'grid'
  | 'html'
  | 'chart'
  | 'metric'
  | 'gauge'
  | 'timeline'
  | 'dashboard'
  | 'cart'
  | 'panels'
  | 'tabs'
  | 'accordion'
  | 'stack'
  | 'columns'
  | 'checklist';

interface Fixture {
  name: string;
  input: unknown;
  expectedLayout: LayoutType;
}

/**
 * Replicate the auto-detection logic from result-viewer.ts _selectLayout().
 * This is the Level 3 auto-detect path (no explicit format, no _photonType).
 */
function autoDetectLayout(data: unknown): LayoutType {
  // Null/undefined
  if (data === null || data === undefined) return 'text';

  // String detection
  if (typeof data === 'string') {
    if (
      data.includes('graph ') ||
      data.includes('sequenceDiagram') ||
      data.includes('classDiagram') ||
      data.includes('flowchart ')
    ) {
      return 'mermaid';
    }
    if (
      data.includes('```') ||
      data.includes('## ') ||
      data.includes('**') ||
      data.startsWith('---\n')
    ) {
      return 'markdown';
    }
    return 'text';
  }

  // Non-object primitives
  if (typeof data !== 'object') return 'text';

  // Array detection
  if (Array.isArray(data)) {
    if (data.length === 0) return 'json';

    // Array of strings
    if (data.every((item) => typeof item === 'string')) {
      const joined = data.join(' ');
      if (joined.includes('```') || joined.includes('## ') || joined.includes('**')) {
        return 'markdown';
      }
      return 'chips';
    }

    // Array of objects
    if (data.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
      const first = data[0] as Record<string, unknown>;

      // Checklist detection: text-like + done/completed/checked boolean
      const textFields = ['text', 'title', 'name', 'task', 'label'];
      const doneFields = ['done', 'completed', 'checked'];
      const allChecklist = data.every((item: any) => {
        const itemKeys = Object.keys(item).map((k) => k.toLowerCase());
        return (
          textFields.some((f) => itemKeys.includes(f)) &&
          doneFields.some((f) => itemKeys.includes(f))
        );
      });
      if (allChecklist) return 'checklist';

      // Cart detection
      if ('price' in first && 'quantity' in first) return 'cart';

      // Timeline detection (3+ items with date + title/event)
      if (data.length >= 3) {
        const hasDate = 'date' in first || 'time' in first || 'timestamp' in first;
        const hasTitle = 'title' in first || 'event' in first || 'name' in first;
        if (hasDate && hasTitle) return 'timeline';
      }

      // Chart detection (predominantly numeric)
      const keys = Object.keys(first);
      const numericKeys = keys.filter((k) => typeof first[k] === 'number');
      if (numericKeys.length > keys.length / 2 && keys.length >= 2) return 'chart';

      // List detection (semantic fields)
      const semanticFields = ['name', 'title', 'status', 'state', 'description'];
      const hasSemanticField = semanticFields.some((f) => f in first);
      if (hasSemanticField) return 'list';

      return 'table';
    }

    return 'json';
  }

  // Single object detection
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Cart (single item)
  if ('price' in obj && 'quantity' in obj) return 'cart';

  // Gauge
  if ('progress' in obj || ('value' in obj && ('max' in obj || 'min' in obj))) return 'gauge';

  // Metric (1-5 keys, exactly 1 numeric)
  const numericCount = keys.filter((k) => typeof obj[k] === 'number').length;
  if (keys.length >= 1 && keys.length <= 5 && numericCount === 1) return 'metric';

  // Dashboard (3+ keys with mix of arrays + numeric/object values)
  if (keys.length >= 3) {
    const hasArray = keys.some((k) => Array.isArray(obj[k]));
    const hasNumericOrObject = keys.some(
      (k) => typeof obj[k] === 'number' || (typeof obj[k] === 'object' && obj[k] !== null)
    );
    if (hasArray && hasNumericOrObject) return 'dashboard';
  }

  return 'card';
}

// Load fixtures
const fixturesPath = join(__dirname, 'fixtures', 'result-layouts.json');
const fixturesData = JSON.parse(readFileSync(fixturesPath, 'utf-8'));
const fixtures: Fixture[] = fixturesData.fixtures;

describe('Result layout auto-detection', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} → ${fixture.expectedLayout}`, () => {
      const result = autoDetectLayout(fixture.input);
      assert.equal(
        result,
        fixture.expectedLayout,
        `Expected layout '${fixture.expectedLayout}' for fixture '${fixture.name}', got '${result}'`
      );
    });
  }
});

describe('Edge cases', () => {
  it('undefined input → text', () => {
    assert.equal(autoDetectLayout(undefined), 'text');
  });

  it('deeply nested object → card', () => {
    assert.equal(autoDetectLayout({ a: { b: { c: 1 } } }), 'card');
  });

  it('mixed array → json', () => {
    assert.equal(autoDetectLayout([1, 'two', { three: 3 }]), 'json');
  });

  it('single key numeric object → metric', () => {
    assert.equal(autoDetectLayout({ total: 100 }), 'metric');
  });

  it('object with only string values → card', () => {
    assert.equal(autoDetectLayout({ a: 'x', b: 'y', c: 'z' }), 'card');
  });
});
