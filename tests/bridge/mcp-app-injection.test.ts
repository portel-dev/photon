import { normalizeInlineScript } from '../../src/auto-ui/frontend/utils/mcp-app-html.js';
import { injectIntoHead, ResourceServer } from '../../src/resource-server.js';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const raw = 'window.__bridgeReady = true;';
const wrapped = '<script>\nwindow.__bridgeReady = true;\n</script>';

const rawResult = normalizeInlineScript(raw);
assert(rawResult.startsWith('<script>'), 'Raw bridge JavaScript should be wrapped');
assert(rawResult.endsWith('</script>'), 'Raw bridge JavaScript should close its wrapper');
assert(rawResult.includes(raw), 'Wrapped bridge should preserve its source');

const wrappedResult = normalizeInlineScript(wrapped);
assert(wrappedResult === wrapped, 'Existing script fragments should not be nested');
assert(!wrappedResult.includes('<script>\n<script>'), 'Nested script tags must be rejected');

console.log('✅ MCP App bridge injection normalization tests passed');

// Regression: browser runtimes contain template-literal `$` sequences. Using
// a replacement string with String#replace turns `$$`, `$&`, `$`` and `$'`
// into replacement tokens and corrupts the generated MCP App document.
const runtime = new ResourceServer({}, { filePath: '' }).generatePhotonFormRuntime();
const litMarker = 'var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;';
assert(
  runtime.includes(litMarker),
  'Photon form runtime should contain its intact template literal'
);
const injected = injectIntoHead('<!doctype html><html><head></head><body></body></html>', runtime);
assert(injected.includes(litMarker), 'Head injection must preserve runtime template literals');
assert(
  !injected.includes('<html lang="en">\n  ;'),
  'Head injection must not splice HTML into JavaScript'
);
const bridge = new ResourceServer({}, { filePath: '' }).generateMcpAppsBridge({
  name: 'appointments',
});
assert(
  bridge.includes(
    "var transportReady = transport === 'postmessage'\n    ? Promise.resolve(transport)"
  ),
  'Embedded MCP Apps must settle the postMessage transport immediately'
);
console.log('✅ MCP App runtime head-injection regression test passed');
