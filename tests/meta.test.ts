/**
 * Tests for _meta system parameter namespace.
 *
 * Verifies: stripMeta extraction, field selection, format serializers,
 * @export validation, and the full applyMeta pipeline.
 */

import assert from 'node:assert/strict';
import { stripMeta, applyMeta } from '../src/meta.js';
import type { MetaParams, MetaFormattedResult } from '../src/meta.js';

function isFormatted(result: unknown): result is MetaFormattedResult {
  return typeof result === 'object' && result !== null && (result as any)._metaFormatted === true;
}

(async () => {
  console.log('🧪 _meta system parameter tests...\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // stripMeta
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const { cleanArgs, meta } = stripMeta({ name: 'Alice', _meta: { format: 'csv' } });
    assert.deepEqual(cleanArgs, { name: 'Alice' });
    assert.deepEqual(meta, { format: 'csv' });
    console.log('  ✅ stripMeta extracts _meta and returns clean args');
  }

  {
    const { cleanArgs, meta } = stripMeta({ name: 'Bob' });
    assert.deepEqual(cleanArgs, { name: 'Bob' });
    assert.equal(meta, undefined);
    console.log('  ✅ stripMeta passes through when no _meta present');
  }

  {
    const { cleanArgs, meta } = stripMeta({});
    assert.deepEqual(cleanArgs, {});
    assert.equal(meta, undefined);
    console.log('  ✅ stripMeta handles empty args');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Field selection
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const data = [
      { name: 'Alice', email: 'a@b.com', password: 'secret' },
      { name: 'Bob', email: 'b@c.com', password: 'hidden' },
    ];
    const result = applyMeta(data, { fields: { include: ['name', 'email'] } });
    assert.deepEqual(result, [
      { name: 'Alice', email: 'a@b.com' },
      { name: 'Bob', email: 'b@c.com' },
    ]);
    console.log('  ✅ Field selection: include filters to specified keys');
  }

  {
    const data = { name: 'Alice', email: 'a@b.com', password: 'secret' };
    const result = applyMeta(data, { fields: { exclude: ['password'] } });
    assert.deepEqual(result, { name: 'Alice', email: 'a@b.com' });
    console.log('  ✅ Field selection: exclude removes specified keys');
  }

  {
    const result = applyMeta('hello', { fields: { include: ['x'] } });
    assert.equal(result, 'hello');
    console.log('  ✅ Field selection: primitives pass through unchanged');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Format: JSON
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const result = applyMeta({ x: 1 }, { format: 'json' });
    assert(isFormatted(result));
    assert.equal(result.mimeType, 'application/json');
    assert.equal(result.text, JSON.stringify({ x: 1 }, null, 2));
    console.log('  ✅ Format: json produces pretty JSON');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Format: YAML
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const result = applyMeta({ name: 'Alice', age: 30 }, { format: 'yaml' });
    assert(isFormatted(result));
    assert.equal(result.mimeType, 'text/yaml');
    assert(result.text.includes('name: Alice'));
    assert(result.text.includes('age: 30'));
    console.log('  ✅ Format: yaml produces valid YAML');
  }

  {
    const result = applyMeta([{ a: 1 }, { a: 2 }], { format: 'yaml' });
    assert(isFormatted(result));
    assert(result.text.includes('- a: 1'));
    assert(result.text.includes('- a: 2'));
    console.log('  ✅ Format: yaml handles arrays of objects');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Format: CSV
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];
    const result = applyMeta(data, { format: 'csv' }, ['csv', 'json']);
    assert(isFormatted(result));
    assert.equal(result.mimeType, 'text/csv');
    const lines = result.text.split('\n');
    assert.equal(lines[0], 'name,score');
    assert.equal(lines[1], 'Alice,95');
    assert.equal(lines[2], 'Bob,87');
    console.log('  ✅ Format: csv produces RFC 4180 CSV');
  }

  {
    const data = [{ desc: 'has "quotes" and, commas' }];
    const result = applyMeta(data, { format: 'csv' }, ['csv']);
    assert(isFormatted(result));
    assert(result.text.includes('"has ""quotes"" and, commas"'));
    console.log('  ✅ Format: csv escapes quotes and commas correctly');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Format: Markdown table
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];
    const result = applyMeta(data, { format: 'markdown' }, ['markdown']);
    assert(isFormatted(result));
    assert.equal(result.mimeType, 'text/markdown');
    assert(result.text.includes('| name | score |'));
    assert(result.text.includes('| --- | --- |'));
    assert(result.text.includes('| Alice | 95 |'));
    console.log('  ✅ Format: markdown produces table');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Format: HTML table
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const data = [{ name: 'Alice' }];
    const result = applyMeta(data, { format: 'html' }, ['html']);
    assert(isFormatted(result));
    assert.equal(result.mimeType, 'text/html');
    assert(result.text.includes('<table>'));
    assert(result.text.includes('<th>name</th>'));
    assert(result.text.includes('<td>Alice</td>'));
    console.log('  ✅ Format: html produces HTML table');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // @export validation
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const result = applyMeta({ x: 1 }, { format: 'csv' }, ['json', 'yaml']);
    assert(isFormatted(result));
    assert(result.text.includes('not supported'));
    assert(result.text.includes('json, yaml'));
    console.log('  ✅ @export: rejects unsupported format with message');
  }

  {
    // Default exports (no exportFormats specified) allow json and yaml
    const result = applyMeta({ x: 1 }, { format: 'csv' });
    assert(isFormatted(result));
    assert(result.text.includes('not supported'));
    console.log('  ✅ @export: defaults to json/yaml when no @export tag');
  }

  {
    // json is always available by default
    const result = applyMeta({ x: 1 }, { format: 'json' });
    assert(isFormatted(result));
    assert.equal(result.mimeType, 'application/json');
    console.log('  ✅ @export: json always available by default');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pipeline: fields + format combined
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const data = [
      { name: 'Alice', email: 'a@b.com', password: 'secret' },
      { name: 'Bob', email: 'b@c.com', password: 'hidden' },
    ];
    const meta: MetaParams = {
      fields: { exclude: ['password'] },
      format: 'csv',
    };
    const result = applyMeta(data, meta, ['csv']);
    assert(isFormatted(result));
    const lines = result.text.split('\n');
    assert.equal(lines[0], 'name,email');
    assert(!result.text.includes('password'));
    assert(!result.text.includes('secret'));
    console.log('  ✅ Pipeline: field exclusion applied before CSV format');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Viewport/locale pass-through (not processed by applyMeta)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    const data = { value: 42 };
    const result = applyMeta(data, { viewport: { width: 600 }, locale: { timezone: 'UTC' } });
    // viewport and locale are forwarded, not transformed — result is unchanged
    assert.deepEqual(result, { value: 42 });
    console.log('  ✅ Viewport/locale: data passes through unchanged');
  }

  console.log('\n✅ All _meta tests passed!\n');
})();
