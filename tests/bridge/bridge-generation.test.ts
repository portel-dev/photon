/**
 * Layer 1: Bridge Script Generation Tests
 *
 * Verifies that generateBridgeScript() produces correct JavaScript
 * with all expected APIs and message handlers.
 */

import { generateBridgeScript } from '../../dist/auto-ui/bridge/index.js';

const TEST_CONTEXT = {
  photon: 'test-photon',
  method: 'main',
  theme: 'dark' as const,
  locale: 'en-US',
  hostName: 'test-host',
  hostVersion: '1.0.0',
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`❌ ${name}`);
    console.log(`   ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

console.log('🧪 Layer 1: Bridge Script Generation Tests\n');

// ═══════════════════════════════════════════════════════════════════════════════
// BASIC GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

test('generates a script tag', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('<script>'), 'Should start with <script>');
  assert(script.includes('</script>'), 'Should end with </script>');
});

test('includes context values in generated script', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('"test-photon"'), 'Should include photon name');
  assert(script.includes('"main"'), 'Should include method name');
  assert(script.includes('"dark"'), 'Should include theme');
});

test('includes theme tokens', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  // Theme tokens should be serialized JSON
  assert(script.includes('themeTokens'), 'Should include themeTokens variable');
  assert(script.includes('--'), 'Should include CSS variable names');
});

// ═══════════════════════════════════════════════════════════════════════════════
// WINDOW.PHOTON API
// ═══════════════════════════════════════════════════════════════════════════════

test('defines window.photon object', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('window.photon = {'), 'Should define window.photon');
});

test('window.photon has toolOutput getter', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('get toolOutput()'), 'Should have toolOutput getter');
});

test('window.photon has invoke function', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('invoke: callTool'), 'Should have invoke function');
});

test('window.photon has onResult listener', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('onResult: function(cb)'), 'Should have onResult');
});

test('window.photon has onThemeChange listener', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('onThemeChange: function(cb)'), 'Should have onThemeChange');
});

test('window.photon has onProgress listener', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('onProgress: function(cb)'), 'Should have onProgress');
});

test('window.photon has sendSizeChanged function', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('sendSizeChanged: sendSizeChanged'), 'Should have sendSizeChanged');
});

test('window.photon has setupAutoResize function', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('setupAutoResize: setupAutoResize'), 'Should have setupAutoResize');
});

// ═══════════════════════════════════════════════════════════════════════════════
// WINDOW.OPENAI API (Compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

test('defines window.openai object', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('window.openai = {'), 'Should define window.openai');
});

test('window.openai has callTool function', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('callTool: callTool'), 'Should have callTool');
});

test('window.openai has notifyIntrinsicHeight function', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('notifyIntrinsicHeight: function(height)'), 'Should have notifyIntrinsicHeight');
});

// ═══════════════════════════════════════════════════════════════════════════════
// JSON-RPC MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

test('handles ui/initialize response', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("m.method === 'ui/initialize'"), 'Should handle ui/initialize');
});

test('sends ui/notifications/initialized after init', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("method: 'ui/notifications/initialized'"),
    'Should send initialized notification'
  );
});

test('handles ui/notifications/tool-result', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'ui/notifications/tool-result'"),
    'Should handle tool-result'
  );
});

test('handles ui/notifications/host-context-changed', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'ui/notifications/host-context-changed'"),
    'Should handle host-context-changed'
  );
});

test('handles ui/resource-teardown', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'ui/resource-teardown'"),
    'Should handle resource-teardown'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM PHOTON NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

test('handles photon/notifications/progress', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'photon/notifications/progress'"),
    'Should handle progress notification'
  );
});

test('handles photon/notifications/status', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'photon/notifications/status'"),
    'Should handle status notification'
  );
});

test('handles photon/notifications/stream', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'photon/notifications/stream'"),
    'Should handle stream notification'
  );
});

test('handles photon/notifications/emit', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("m.method === 'photon/notifications/emit'"),
    'Should handle emit notification'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS/CALL REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

test('sends tools/call with JSON-RPC format', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("method: 'tools/call'"), 'Should send tools/call');
  assert(script.includes('jsonrpc: \'2.0\''), 'Should use JSON-RPC 2.0');
});

test('callTool includes name and arguments', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes('params: { name: name, arguments: args || {} }'),
    'Should include name and arguments'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIZE HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

test('has parseSizeMeta function', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('function parseSizeMeta()'), 'Should have parseSizeMeta');
});

test('parseSizeMeta looks for mcp:ui-size meta tag', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("meta[name=\"mcp:ui-size\"]"), 'Should look for mcp:ui-size');
});

test('sends ui/notifications/size-changed', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(
    script.includes("method: 'ui/notifications/size-changed'"),
    'Should send size-changed notification'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

test('handles legacy photon:result messages', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("m.type === 'photon:result'"), 'Should handle photon:result');
});

test('handles legacy photon:theme-change messages', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("m.type === 'photon:theme-change'"), 'Should handle photon:theme-change');
});

test('sends photon:ready on initialization', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("type: 'photon:ready'"), 'Should send photon:ready');
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP APPS INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

test('sends ui/initialize request on load', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("method: 'ui/initialize'"), 'Should send ui/initialize');
});

test('ui/initialize includes appInfo', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('appInfo:'), 'Should include appInfo');
});

test('ui/initialize includes protocolVersion', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('protocolVersion:'), 'Should include protocolVersion');
});

// ═══════════════════════════════════════════════════════════════════════════════
// THEME APPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

test('applies theme tokens to CSS variables', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('root.style.setProperty(key, themeTokens[key])'), 'Should set CSS vars');
});

test('applies theme class to documentElement', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes('document.documentElement.classList.add(ctx.theme)'), 'Should add theme class');
});

test('sets data-theme attribute', () => {
  const script = generateBridgeScript(TEST_CONTEXT);
  assert(script.includes("setAttribute('data-theme'"), 'Should set data-theme attribute');
});

// ═══════════════════════════════════════════════════════════════════════════════
// DIFFERENT THEMES
// ═══════════════════════════════════════════════════════════════════════════════

test('generates script for light theme', () => {
  const script = generateBridgeScript({ ...TEST_CONTEXT, theme: 'light' });
  assert(script.includes('"light"'), 'Should include light theme');
});

test('generates script for dark theme', () => {
  const script = generateBridgeScript({ ...TEST_CONTEXT, theme: 'dark' });
  assert(script.includes('"dark"'), 'Should include dark theme');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Layer 1 Results: ${passed} passed, ${failed} failed`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (failed > 0) {
  process.exit(1);
}
