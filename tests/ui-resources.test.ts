/**
 * Integration test for MCP Apps ui:// scheme (SEP-1865)
 * Tests that UI assets are exposed as MCP resources with ui:// URIs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runUIResourceTests() {
  console.log('🧪 Running UI Resources (ui:// scheme) Tests...\n');

  const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
  const fixturesDir = path.join(__dirname, 'fixtures');

  // Connect to the ui-test photon
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, `--dir=${fixturesDir}`, 'mcp', 'ui-test'],
  });

  const client = new Client({
    name: 'ui-resources-test-client',
    version: '1.0.0',
  }, {
    capabilities: {
      // Advertise SEP-1865 UI capability to get ui:// scheme
      experimental: {
        ui: {},
      },
    },
  });

  let uiResources: any[] = [];

  try {
    await client.connect(transport);
    console.log('✅ Connected to PhotonServer (ui-test)');

    // Test 1: List resources should include ui:// URIs
    {
      const response = await client.listResources();
      const resources = response.resources;

      assert.ok(Array.isArray(resources), 'Should return resources array');

      // Find ui:// resources
      uiResources = resources.filter(r => r.uri.startsWith('ui://'));
      assert.ok(uiResources.length > 0, 'Should have ui:// resources');

      // Should have the main-ui resource (photon name is derived from class name UITestPhoton -> u-i-test-photon)
      const mainUi = uiResources.find(r => r.uri.includes('/main-ui'));
      assert.ok(mainUi, `Should have ui://.../main-ui resource. Found: ${uiResources.map(r => r.uri).join(', ')}`);
      assert.ok(mainUi.mimeType?.includes('html'), 'UI resource should have html mimeType');

      console.log(`✅ resources/list includes ${uiResources.length} ui:// resource(s)`);
    }

    // Test 2: Read a ui:// resource
    {
      // Use the URI we discovered in Test 1
      const mainUiUri = uiResources.find(r => r.uri.includes('/main-ui'))!.uri;

      const response = await client.readResource({
        uri: mainUiUri,
      });

      const contents = response.contents;
      assert.ok(Array.isArray(contents), 'Should return contents array');
      assert.equal(contents.length, 1, 'Should have one content item');
      assert.equal(contents[0].uri, mainUiUri, 'Content URI should match request');
      assert.ok(contents[0].mimeType?.includes('html'), 'Should have html mimeType');
      assert.ok(contents[0].text, 'Should have text content');
      assert.ok(contents[0].text.includes('UI Test Page'), 'Should contain UI HTML content');

      console.log('✅ resources/read (ui://) returns HTML content');
    }

    // Test 3: Invalid ui:// URI should throw error
    {
      // Extract photon name from a valid URI
      const validUri = uiResources[0].uri;
      const photonName = validUri.match(/ui:\/\/([^/]+)\//)?.[1] || 'unknown';

      let errorThrown = false;
      try {
        await client.readResource({
          uri: `ui://${photonName}/nonexistent-ui`,
        });
      } catch (e: any) {
        errorThrown = true;
        assert.ok(e.message.includes('not found') || e.message.includes('UI asset') || e.message.includes('Resource'),
          `Error message should indicate resource not found. Got: ${e.message}`);
      }
      assert.ok(errorThrown, 'Should throw error for nonexistent ui:// resource');
      console.log('✅ Invalid ui:// URI correctly throws error');
    }

    console.log('\n✅ All UI Resources (ui:// scheme) tests passed!');

  } catch (error: any) {
    console.error('❌ UI Resources test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run if executed directly
runUIResourceTests().catch(console.error);
