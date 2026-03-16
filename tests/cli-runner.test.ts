/**
 * CLI Runner Pure Function Tests
 *
 * Tests the pure utility functions in photon-cli-runner.ts.
 * parseCliArgs is exported and imported directly; all other functions
 * are non-exported so their logic is duplicated here (same pattern as
 * worker-dep-proxy tests).
 */

import { strict as assert } from 'assert';
import { parseCliArgs, type MethodInfo } from '../src/photon-cli-runner.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ── Duplicated pure functions from photon-cli-runner.ts ─────────────

function coerceToType(value: any, expectedType: string): any {
  switch (expectedType) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      return Boolean(value);
    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && (value.startsWith('+') || value.startsWith('-'))) {
        return value;
      }
      const num = Number(value);
      return isNaN(num) ? value : num;
    case 'string':
      return String(value);
    default:
      return value;
  }
}

function coerceValue(value: string, expectedType: string): any {
  if (expectedType.includes('number') && (value.startsWith('+') || value.startsWith('-'))) {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return coerceToType(parsed, expectedType);
  } catch {
    return coerceToType(value, expectedType);
  }
}

function extractBaseType(typeStr: string): string {
  const objectMatch = typeStr.match(/\{\s*\w+\??\s*:\s*(\w+)/);
  if (objectMatch) {
    return objectMatch[1];
  }
  const unionTypes = typeStr.split('|').map((t) => t.trim());
  for (const type of unionTypes) {
    if (/^(boolean|number|string)/.test(type)) {
      return type;
    }
  }
  return 'any';
}

function looksLikeMarkdown(value: any): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^---\s*[\r\n]/.test(trimmed)) return true;
  const blockPatterns: RegExp[] = [
    /^#{1,6}\s+/m,
    /^> /m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /^```/m,
    /(?:^|\n)(?:-{3,}|_{3,}|\*{3,})(?:\n|$)/m,
  ];
  if (blockPatterns.some((pattern) => pattern.test(trimmed))) return true;
  if (/\[.+?\]\(.+?\)/.test(trimmed)) return true;
  return false;
}

const stripAnsiRegex = /\u001b\[[0-9;]*m/g;

function visibleLength(text: string): number {
  return text.replace(stripAnsiRegex, '').length;
}

function wrapToWidth(text: string, width: number): string[] {
  if (!width) return [text];
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of trimmedLine.split(' ')) {
      if (word.length > width) {
        if (current) {
          lines.push(current);
          current = '';
        }
        let remaining = word;
        while (remaining.length > width) {
          lines.push(remaining.slice(0, width));
          remaining = remaining.slice(width);
        }
        current = remaining;
        continue;
      }
      if (!current) {
        current = word;
        continue;
      }
      if (current.length + 1 + word.length > width) {
        lines.push(current);
        current = word;
      } else {
        current += ` ${word}`;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function isValidOutputFormat(format: string): boolean {
  const knownFormats: Set<string> = new Set([
    'primitive',
    'table',
    'tree',
    'list',
    'none',
    'json',
    'markdown',
    'yaml',
    'xml',
    'html',
    'code',
  ]);
  return knownFormats.has(format) || format.startsWith('code:');
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

// ── Tests ───────────────────────────────────────────────────────────

async function run() {
  console.log('\n-- parseCliArgs --');

  await test('positional args', () => {
    const params: MethodInfo['params'] = [
      { name: 'greeting', type: 'string', optional: false },
      { name: 'target', type: 'string', optional: false },
    ];
    const result = parseCliArgs(['hello', 'world'], params);
    assert.equal(result.greeting, 'hello');
    assert.equal(result.target, 'world');
  });

  await test('named args with --key value', () => {
    const params: MethodInfo['params'] = [
      { name: 'name', type: 'string', optional: false },
      { name: 'age', type: 'number', optional: false },
    ];
    const result = parseCliArgs(['--name', 'alice', '--age', '30'], params);
    assert.equal(result.name, 'alice');
    assert.equal(result.age, 30);
  });

  await test('--key=value format', () => {
    const params: MethodInfo['params'] = [{ name: 'name', type: 'string', optional: false }];
    const result = parseCliArgs(['--name=alice'], params);
    assert.equal(result.name, 'alice');
  });

  await test('boolean flags (bare --flag)', () => {
    const params: MethodInfo['params'] = [{ name: 'verbose', type: 'boolean', optional: true }];
    const result = parseCliArgs(['--verbose'], params);
    assert.equal(result.verbose, true);
  });

  await test('--no-prefix negation', () => {
    const params: MethodInfo['params'] = [{ name: 'verbose', type: 'boolean', optional: true }];
    const result = parseCliArgs(['--no-verbose'], params);
    assert.equal(result.verbose, false);
  });

  await test('mixed positional + named (boolean before next flag)', () => {
    const params: MethodInfo['params'] = [
      { name: 'greeting', type: 'string', optional: false },
      { name: 'target', type: 'string', optional: false },
      { name: 'loud', type: 'boolean', optional: true },
    ];
    // Boolean flag followed by --flag => bare true, positional fills target
    const result = parseCliArgs(['hello', '--loud', '--name=x', 'world'], params);
    assert.equal(result.greeting, 'hello');
    assert.equal(result.target, 'world');
    assert.equal(result.loud, true);
  });

  await test('mixed positional + named (boolean at end)', () => {
    const params: MethodInfo['params'] = [
      { name: 'greeting', type: 'string', optional: false },
      { name: 'target', type: 'string', optional: false },
      { name: 'loud', type: 'boolean', optional: true },
    ];
    // Positionals first, then boolean flag at the end
    const result = parseCliArgs(['hello', 'world', '--loud'], params);
    assert.equal(result.greeting, 'hello');
    assert.equal(result.target, 'world');
    assert.equal(result.loud, true);
  });

  await test('JSON values', () => {
    const params: MethodInfo['params'] = [{ name: 'data', type: 'any', optional: false }];
    const result = parseCliArgs(['--data', '{"key":"value"}'], params);
    assert.deepEqual(result.data, { key: 'value' });
  });

  await test('bare word matching known param names', () => {
    const params: MethodInfo['params'] = [
      { name: 'group', type: 'string', optional: false },
      { name: 'folder', type: 'string', optional: false },
    ];
    const result = parseCliArgs(['group', 'Arul', 'folder', '~/path'], params);
    assert.equal(result.group, 'Arul');
    assert.equal(result.folder, '~/path');
  });

  console.log('\n-- coerceValue --');

  await test('string to number coercion ("42" -> 42)', () => {
    assert.equal(coerceValue('42', 'number'), 42);
  });

  await test('string to float coercion ("3.14" -> 3.14)', () => {
    assert.equal(coerceValue('3.14', 'number'), 3.14);
  });

  await test('string to boolean ("true" -> true, "false" -> false)', () => {
    assert.equal(coerceValue('true', 'boolean'), true);
    assert.equal(coerceValue('false', 'boolean'), false);
  });

  await test('preserves +/- prefixed strings for number type', () => {
    assert.equal(coerceValue('+3', 'number'), '+3');
    assert.equal(coerceValue('-5', 'number'), '-5');
  });

  await test('JSON parsing for arrays', () => {
    assert.deepEqual(coerceValue('[1,2,3]', 'any'), [1, 2, 3]);
  });

  await test('invalid JSON stays as string', () => {
    assert.equal(coerceValue('not-json{', 'string'), 'not-json{');
  });

  console.log('\n-- coerceToType --');

  await test('boolean: true/false literals', () => {
    assert.equal(coerceToType(true, 'boolean'), true);
    assert.equal(coerceToType(false, 'boolean'), false);
  });

  await test('boolean: 1/0 numbers', () => {
    assert.equal(coerceToType(1, 'boolean'), true);
    assert.equal(coerceToType(0, 'boolean'), false);
  });

  await test('boolean: "true"/"false"/"1"/"0" strings', () => {
    assert.equal(coerceToType('true', 'boolean'), true);
    assert.equal(coerceToType('false', 'boolean'), false);
    assert.equal(coerceToType('1', 'boolean'), true);
    assert.equal(coerceToType('0', 'boolean'), false);
  });

  await test('number: numeric values pass through', () => {
    assert.equal(coerceToType(42, 'number'), 42);
    assert.equal(coerceToType(3.14, 'number'), 3.14);
  });

  await test('number: string numbers coerced', () => {
    assert.equal(coerceToType('42', 'number'), 42);
    assert.equal(coerceToType('3.14', 'number'), 3.14);
  });

  await test('number: NaN stays as string', () => {
    assert.equal(coerceToType('hello', 'number'), 'hello');
  });

  await test('string: always String()', () => {
    assert.equal(coerceToType(42, 'string'), '42');
    assert.equal(coerceToType(true, 'string'), 'true');
    assert.equal(coerceToType('abc', 'string'), 'abc');
  });

  await test('any: pass-through', () => {
    const obj = { a: 1 };
    assert.equal(coerceToType(obj, 'any'), obj);
    assert.equal(coerceToType('hello', 'unknown'), 'hello');
  });

  console.log('\n-- extractBaseType --');

  await test('"boolean | number" -> "boolean"', () => {
    assert.equal(extractBaseType('boolean | number'), 'boolean');
  });

  await test('"{ mute?: boolean } | boolean" -> "boolean"', () => {
    assert.equal(extractBaseType('{ mute?: boolean } | boolean'), 'boolean');
  });

  await test('"string" -> "string"', () => {
    assert.equal(extractBaseType('string'), 'string');
  });

  await test('"SomeCustomType" -> "any"', () => {
    assert.equal(extractBaseType('SomeCustomType'), 'any');
  });

  console.log('\n-- looksLikeMarkdown --');

  await test('headings: "# Hello" -> true', () => {
    assert.equal(looksLikeMarkdown('# Hello'), true);
  });

  await test('lists: "- item" -> true', () => {
    assert.equal(looksLikeMarkdown('- item'), true);
  });

  await test('code blocks: "```js\\n..." -> true', () => {
    assert.equal(looksLikeMarkdown('```js\ncode here\n```'), true);
  });

  await test('links: "[text](url)" -> true', () => {
    assert.equal(looksLikeMarkdown('[text](url)'), true);
  });

  await test('front matter: "---\\ntitle: x\\n---" -> true', () => {
    assert.equal(looksLikeMarkdown('---\ntitle: x\n---'), true);
  });

  await test('plain text -> false', () => {
    assert.equal(looksLikeMarkdown('just some plain text here'), false);
  });

  await test('empty string -> false', () => {
    assert.equal(looksLikeMarkdown(''), false);
  });

  await test('non-string -> false', () => {
    assert.equal(looksLikeMarkdown(42), false);
    assert.equal(looksLikeMarkdown(null), false);
  });

  console.log('\n-- visibleLength --');

  await test('plain text -> length', () => {
    assert.equal(visibleLength('hello'), 5);
  });

  await test('ANSI codes stripped', () => {
    assert.equal(visibleLength('\u001b[31mhello\u001b[0m'), 5);
  });

  await test('multiple ANSI codes', () => {
    assert.equal(visibleLength('\u001b[1m\u001b[31mhi\u001b[0m'), 2);
  });

  await test('empty string -> 0', () => {
    assert.equal(visibleLength(''), 0);
  });

  console.log('\n-- wrapToWidth --');

  await test('short text within width -> single line', () => {
    const result = wrapToWidth('hello world', 80);
    assert.deepEqual(result, ['hello world']);
  });

  await test('long text -> multiple lines', () => {
    const result = wrapToWidth('one two three four', 10);
    assert.deepEqual(result, ['one two', 'three four']);
  });

  await test('words longer than width -> broken', () => {
    const result = wrapToWidth('abcdefghij', 5);
    assert.deepEqual(result, ['abcde', 'fghij']);
  });

  await test('newlines preserved', () => {
    const result = wrapToWidth('line one\nline two', 80);
    assert.deepEqual(result, ['line one', 'line two']);
  });

  await test('empty lines preserved', () => {
    const result = wrapToWidth('line one\n\nline three', 80);
    assert.deepEqual(result, ['line one', '', 'line three']);
  });

  await test('width 0 -> single element', () => {
    const result = wrapToWidth('hello world', 0);
    assert.deepEqual(result, ['hello world']);
  });

  console.log('\n-- formatLabel --');

  await test('"chatId" -> "Chat Id"', () => {
    assert.equal(formatLabel('chatId'), 'Chat Id');
  });

  await test('"maxRetries" -> "Max Retries"', () => {
    assert.equal(formatLabel('maxRetries'), 'Max Retries');
  });

  await test('"count2" -> "Count 2"', () => {
    assert.equal(formatLabel('count2'), 'Count 2');
  });

  await test('"name" -> "Name"', () => {
    assert.equal(formatLabel('name'), 'Name');
  });

  console.log('\n-- isValidOutputFormat --');

  await test('known formats are valid', () => {
    for (const fmt of [
      'table',
      'json',
      'markdown',
      'yaml',
      'xml',
      'html',
      'code',
      'list',
      'tree',
      'none',
      'primitive',
    ]) {
      assert.equal(isValidOutputFormat(fmt), true, `${fmt} should be valid`);
    }
  });

  await test('code: prefix is valid', () => {
    assert.equal(isValidOutputFormat('code:python'), true);
    assert.equal(isValidOutputFormat('code:javascript'), true);
  });

  await test('unknown format is invalid', () => {
    assert.equal(isValidOutputFormat('pdf'), false);
    assert.equal(isValidOutputFormat('csv'), false);
  });

  console.log('\n-- parseMarkdownTableRow --');

  await test('"| a | b | c |" -> ["a", "b", "c"]', () => {
    assert.deepEqual(parseMarkdownTableRow('| a | b | c |'), ['a', 'b', 'c']);
  });

  await test('"a | b | c" -> ["a", "b", "c"]', () => {
    assert.deepEqual(parseMarkdownTableRow('a | b | c'), ['a', 'b', 'c']);
  });

  await test('cells with whitespace are trimmed', () => {
    assert.deepEqual(parseMarkdownTableRow('|  foo  |  bar  |'), ['foo', 'bar']);
  });

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
