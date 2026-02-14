/**
 * Test progressive enhancement: MCP responses adapt by client capability
 *
 * Spins up a real PhotonServer via stdio, connects with different client
 * configurations, and verifies that tool definitions and tool call responses
 * differ based on announced capabilities.
 *
 * Three tiers tested:
 * - basic: no UI capability → no _meta.ui, no structuredContent
 * - mcp-apps: experimental["io.modelcontextprotocol/ui"] → full UI response
 * - beam: clientInfo.name = "beam" → full UI response (name-based fallback)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const fixturesDir = path.join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function ok(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

/**
 * Create a connected MCP client with specified identity and capabilities
 */
async function createClient(opts: {
  name: string;
  version?: string;
  capabilities?: Record<string, unknown>;
}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, `--dir=${fixturesDir}`, 'mcp', 'ui-test'],
  });

  const client = new Client(
    { name: opts.name, version: opts.version ?? '1.0.0' },
    { capabilities: opts.capabilities ?? {} }
  );

  await client.connect(transport);
  return client;
}

async function runTests() {
  console.log('🧪 Client-Adaptive MCP Responses Tests\n');

  // ─────────────────────────────────────────────────────────
  // Tier: basic — unknown client, no UI capability
  // ─────────────────────────────────────────────────────────
  {
    console.log('[TEST 1] Basic client: tools/list should NOT include _meta.ui');
    const client = await createClient({ name: 'unknown-client' });
    try {
      const { tools } = await client.listTools();
      const mainTool = tools.find((t) => t.name === 'main');
      assert.ok(mainTool, 'Should have "main" tool');

      const meta = (mainTool as any)._meta;
      ok(!meta?.ui, 'Tool definition should NOT have _meta.ui');
    } finally {
      await client.close();
    }
  }

  {
    console.log(
      '[TEST 2] Basic client: tools/call should NOT include structuredContent or _meta.ui'
    );
    const client = await createClient({ name: 'unknown-client' });
    try {
      const result = await client.callTool({ name: 'main', arguments: {} });

      // Should have content
      ok(Array.isArray(result.content), 'Should have content array');

      // Should NOT have structuredContent
      ok(!(result as any).structuredContent, 'Should NOT have structuredContent');

      // Should NOT have _meta.ui
      ok(!(result as any)._meta?.ui, 'Should NOT have _meta.ui');
    } finally {
      await client.close();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Tier: mcp-apps — client announces UI capability
  // ─────────────────────────────────────────────────────────
  {
    console.log('[TEST 3] MCP Apps client (capability): tools/list should include _meta.ui');
    const client = await createClient({
      name: 'some-ui-client',
      capabilities: {
        experimental: { 'io.modelcontextprotocol/ui': {} },
      },
    });
    try {
      const { tools } = await client.listTools();
      const mainTool = tools.find((t) => t.name === 'main');
      assert.ok(mainTool, 'Should have "main" tool');

      const meta = (mainTool as any)._meta;
      ok(!!meta?.ui?.resourceUri, 'Tool definition should have _meta.ui.resourceUri');
      ok(
        (meta.ui.resourceUri as string).startsWith('ui://'),
        `resourceUri should start with ui://. Got: ${meta.ui.resourceUri}`
      );
    } finally {
      await client.close();
    }
  }

  {
    console.log(
      '[TEST 4] MCP Apps client (capability): tools/call should include structuredContent + _meta.ui'
    );
    const client = await createClient({
      name: 'some-ui-client',
      capabilities: {
        experimental: { 'io.modelcontextprotocol/ui': {} },
      },
    });
    try {
      const result = await client.callTool({ name: 'main', arguments: {} });

      // Should have content
      ok(Array.isArray(result.content), 'Should have content array');

      // Should have structuredContent with the actual return value
      ok(!!(result as any).structuredContent, 'Should have structuredContent');
      ok(
        (result as any).structuredContent?.message === 'Hello from UI test',
        `structuredContent should contain return value. Got: ${JSON.stringify((result as any).structuredContent)}`
      );

      // Should have _meta.ui
      ok(!!(result as any)._meta?.ui?.resourceUri, 'Should have _meta.ui.resourceUri');
    } finally {
      await client.close();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Tier: mcp-apps — known client name fallback (chatgpt)
  // ─────────────────────────────────────────────────────────
  {
    console.log(
      '[TEST 5] Known UI client (chatgpt): tools/list should include _meta.ui via name fallback'
    );
    const client = await createClient({ name: 'chatgpt' });
    try {
      const { tools } = await client.listTools();
      const mainTool = tools.find((t) => t.name === 'main');
      assert.ok(mainTool, 'Should have "main" tool');

      const meta = (mainTool as any)._meta;
      ok(
        !!meta?.ui?.resourceUri,
        'Tool definition should have _meta.ui.resourceUri (name fallback)'
      );
    } finally {
      await client.close();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Tier: beam — our own client, always UI-capable
  // ─────────────────────────────────────────────────────────
  {
    console.log('[TEST 6] Beam client: tools/list should include _meta.ui');
    const client = await createClient({ name: 'beam' });
    try {
      const { tools } = await client.listTools();
      const mainTool = tools.find((t) => t.name === 'main');
      assert.ok(mainTool, 'Should have "main" tool');

      const meta = (mainTool as any)._meta;
      ok(!!meta?.ui?.resourceUri, 'Tool definition should have _meta.ui.resourceUri (beam)');
    } finally {
      await client.close();
    }
  }

  {
    console.log('[TEST 7] Beam client: tools/call should include structuredContent + _meta.ui');
    const client = await createClient({ name: 'beam' });
    try {
      const result = await client.callTool({ name: 'main', arguments: {} });

      ok(!!(result as any).structuredContent, 'Should have structuredContent');
      ok(!!(result as any)._meta?.ui?.resourceUri, 'Should have _meta.ui.resourceUri');
    } finally {
      await client.close();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Edge: known client name "mcp-inspector"
  // ─────────────────────────────────────────────────────────
  {
    console.log('[TEST 8] MCP Inspector client: tools/list should include _meta.ui');
    const client = await createClient({ name: 'mcp-inspector' });
    try {
      const { tools } = await client.listTools();
      const mainTool = tools.find((t) => t.name === 'main');
      assert.ok(mainTool, 'Should have "main" tool');

      const meta = (mainTool as any)._meta;
      ok(
        !!meta?.ui?.resourceUri,
        'Tool definition should have _meta.ui.resourceUri (mcp-inspector)'
      );
    } finally {
      await client.close();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Edge: claude-ai client (NOT in known list, no capability)
  // Should be basic tier
  // ─────────────────────────────────────────────────────────
  {
    console.log('[TEST 9] Claude Desktop (no UI capability): should be basic tier');
    const client = await createClient({
      name: 'claude-ai',
      capabilities: {
        // Claude Desktop announces elicitation but not UI (as of early 2026)
        elicitation: {},
      },
    });
    try {
      const { tools } = await client.listTools();
      const mainTool = tools.find((t) => t.name === 'main');
      assert.ok(mainTool, 'Should have "main" tool');

      const meta = (mainTool as any)._meta;
      ok(!meta?.ui, 'Tool definition should NOT have _meta.ui (claude-ai without UI capability)');
    } finally {
      await client.close();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('❌ Test suite error:', err);
  process.exit(1);
});
