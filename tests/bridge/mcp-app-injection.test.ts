import { normalizeInlineScript } from '../../src/auto-ui/frontend/utils/mcp-app-html.js';

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
