/**
 * A2UI Renderer Script — Syntax + Integration Contract
 *
 * The A2UI renderer ships as vanilla JS inside a TypeScript template literal
 * in `src/auto-ui/bridge/renderers.ts` and is served to the browser over
 * `/api/photon-renderers.js`. Template-literal escapes inside regex literals
 * are a known foot-gun (e.g. `\/` collapses unless you write `\\/`), and a
 * silent parse error means Beam falls back to raw JSON rendering.
 *
 * This test runs generateRenderersScript(), parses the result, and asserts
 * the A2UI renderer and its helpers landed in the generated script without
 * syntax errors or lost escapes.
 */

import { strict as assert } from 'assert';
import { generateRenderersScript } from '../src/auto-ui/bridge/renderers.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

console.log('\n🧪 A2UI Renderer Script\n');

const script = generateRenderersScript();

test('generated script parses as valid JavaScript', () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(script);
});

test('script defines renderers.a2ui', () => {
  assert.ok(/renderers\.a2ui\s*=\s*function/.test(script), 'renderers.a2ui missing');
});

test('script includes A2UI helpers (mapper, resolver, renderer)', () => {
  for (const name of [
    'a2uiMapResult',
    'a2uiExtractSurface',
    'a2uiResolvePath',
    'a2uiResolveDynamic',
    'a2uiRender',
    'a2uiToast',
  ]) {
    assert.ok(new RegExp(`function\\s+${name}`).test(script), `helper ${name} missing`);
  }
});

test('JSON Pointer regex escapes survived the template literal', () => {
  // The substitution regex inside a2uiSetByPath strips a leading "/" — escape
  // regression (writing /^\// in source where /^\\// is needed) collapses this
  // to /^//, producing a parse error. Assert the backslash is present.
  assert.ok(/\/\^\\\//.test(script), 'a2uiSetByPath leading-slash regex lost its backslash escape');
});

test('formatString ${...} interpolation regex survived the template literal', () => {
  // Needs to land as /\$\{([^}]+)\}/g in the output.
  assert.ok(
    /\/\\\$\\\{\(\[\^\}\]\+\)\\\}\/g/.test(script),
    'formatString interpolation regex lost its escapes'
  );
});

test('A2UI renderer handles every Basic-catalog component in its switch', () => {
  // Keeps the renderer's contract in sync with src/a2ui/types.ts. New
  // components need a case here too.
  for (const component of [
    "'Text'",
    "'Column'",
    "'Row'",
    "'Card'",
    "'Divider'",
    "'Image'",
    "'List'",
    "'Button'",
    "'TextField'",
  ]) {
    assert.ok(script.includes('case ' + component), `missing case for ${component}`);
  }
});

test('a2ui is registered in FORMAT_CATALOG', async () => {
  const { FORMAT_CATALOG } = await import('../src/auto-ui/bridge/renderers.js');
  assert.ok('a2ui' in FORMAT_CATALOG, 'FORMAT_CATALOG.a2ui missing');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
