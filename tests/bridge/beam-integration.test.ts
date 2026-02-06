/**
 * Layer 3: Beam Integration Tests
 *
 * Tests the bridge through Beam's HTTP endpoint logic directly.
 * Creates a minimal HTTP server for the /api/platform-bridge endpoint.
 */

import { createServer, type Server } from 'http';
import { URL } from 'url';
import { generateBridgeScript } from '../../dist/auto-ui/bridge/index.js';

const TEST_PORT = 9876;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server: Server | null = null;
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`❌ ${name}`);
      console.log(`   ${e.message}`);
      failed++;
    }
  })();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/**
 * Create a minimal HTTP server that mimics Beam's /api/platform-bridge endpoint
 */
async function setup() {
  console.log('Starting test HTTP server...');

  server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${TEST_PORT}`);

    if (url.pathname === '/api/platform-bridge') {
      const theme = (url.searchParams.get('theme') || 'dark') as 'light' | 'dark';
      const photonName = url.searchParams.get('photon') || '';
      const methodName = url.searchParams.get('method') || '';

      const script = generateBridgeScript({
        theme,
        locale: 'en-US',
        photon: photonName,
        method: methodName,
        hostName: 'beam',
        hostVersion: '1.5.0',
      });

      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(script);
      return;
    }

    // 404 for other paths
    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => {
    server!.listen(TEST_PORT, () => {
      console.log(`Test server running on port ${TEST_PORT}\n`);
      resolve();
    });
  });
}

async function teardown() {
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => {
        console.log('\nTest server stopped');
        resolve();
      });
    });
  }
}

console.log('🧪 Layer 3: Beam Integration Tests\n');

await setup();

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM BRIDGE ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════

await test('/api/platform-bridge returns script tag', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main&theme=dark`);
  assert(res.ok, `Request failed with status ${res.status}`);

  const body = await res.text();
  const trimmed = body.trim();
  assert(trimmed.startsWith('<script>'), 'Response should start with <script>');
  assert(trimmed.endsWith('</script>'), 'Response should end with </script>');
});

await test('/api/platform-bridge includes photon context', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=kanban&method=board&theme=light`);
  const body = await res.text();

  assert(body.includes('"kanban"'), 'Should include photon name');
  assert(body.includes('"board"'), 'Should include method name');
  assert(body.includes('"light"'), 'Should include theme');
});

await test('/api/platform-bridge has correct content-type', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const contentType = res.headers.get('content-type');

  assert(contentType?.includes('text/html'), `Content-Type should be text/html, got ${contentType}`);
});

await test('/api/platform-bridge includes window.photon API', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  assert(body.includes('window.photon = {'), 'Should define window.photon');
  assert(body.includes('invoke: callTool'), 'Should have invoke function');
  assert(body.includes('onResult: function'), 'Should have onResult');
});

await test('/api/platform-bridge includes window.openai API', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  assert(body.includes('window.openai = {'), 'Should define window.openai');
  assert(body.includes('notifyIntrinsicHeight'), 'Should have notifyIntrinsicHeight');
});

await test('/api/platform-bridge includes MCP Apps protocol handlers', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  assert(body.includes("'ui/initialize'"), 'Should handle ui/initialize');
  assert(body.includes("'ui/notifications/tool-result'"), 'Should handle tool-result');
  assert(body.includes("'ui/notifications/size-changed'"), 'Should send size-changed');
});

await test('/api/platform-bridge includes photon custom notification handlers', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  assert(body.includes("'photon/notifications/progress'"), 'Should handle progress');
  assert(body.includes("'photon/notifications/status'"), 'Should handle status');
  assert(body.includes("'photon/notifications/emit'"), 'Should handle emit');
});

await test('/api/platform-bridge works with dark theme', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main&theme=dark`);
  const body = await res.text();

  assert(body.includes('"dark"'), 'Should include dark theme');
  // Check for dark theme tokens
  assert(body.includes('#0d0d0d') || body.includes('#e6e6e6'), 'Should include dark theme colors');
});

await test('/api/platform-bridge works with light theme', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main&theme=light`);
  const body = await res.text();

  assert(body.includes('"light"'), 'Should include light theme');
});

await test('/api/platform-bridge defaults to dark theme', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  assert(body.includes('"dark"'), 'Should default to dark theme');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIPT VALIDITY
// ═══════════════════════════════════════════════════════════════════════════════

await test('/api/platform-bridge returns valid JavaScript', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  // Extract JavaScript from script tags
  const jsCode = body.replace('<script>', '').replace('</script>', '').trim();

  // Try to parse as JavaScript (basic syntax check)
  try {
    new Function(jsCode);
  } catch (e: any) {
    throw new Error(`Invalid JavaScript: ${e.message}`);
  }
});

await test('/api/platform-bridge includes size meta parsing', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  assert(body.includes('parseSizeMeta'), 'Should have parseSizeMeta function');
  assert(body.includes('mcp:ui-size'), 'Should look for mcp:ui-size meta tag');
});

// ═══════════════════════════════════════════════════════════════════════════════
// DIFFERENT PHOTON NAMES
// ═══════════════════════════════════════════════════════════════════════════════

await test('/api/platform-bridge handles special characters in photon name', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=my-photon-123&method=test`);
  const body = await res.text();

  assert(body.includes('"my-photon-123"'), 'Should include photon name with special chars');
});

await test('/api/platform-bridge handles empty photon name', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=&method=test`);
  assert(res.ok, 'Should handle empty photon name');
});

await test('/api/platform-bridge handles missing query params', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge`);
  assert(res.ok, 'Should handle missing query params');

  const body = await res.text();
  assert(body.includes('<script>'), 'Should still return script');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE SIZE
// ═══════════════════════════════════════════════════════════════════════════════

await test('/api/platform-bridge response is reasonably sized', async () => {
  const res = await fetch(`${BASE_URL}/api/platform-bridge?photon=test&method=main`);
  const body = await res.text();

  // Bridge script should be under 50KB (it's mostly inline JS)
  assert(body.length < 50000, `Response too large: ${body.length} bytes`);
  assert(body.length > 5000, `Response too small: ${body.length} bytes`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

await teardown();

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Layer 3 Results: ${passed} passed, ${failed} failed`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (failed > 0) {
  process.exit(1);
}
