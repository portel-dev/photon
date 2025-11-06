/**
 * Integration test - Tests actual MCP protocol communication
 * Simulates a real MCP client connecting to PhotonServer
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runIntegrationTests() {
  console.log('🧪 Running MCP Integration Tests...\n');

  // Start PhotonServer as a subprocess
  const examplePath = path.join(__dirname, '..', 'examples', 'content.photon.ts');
  const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, examplePath],
  });

  const client = new Client({
    name: 'integration-test-client',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    // Connect to the server
    await client.connect(transport);
    console.log('✅ Connected to PhotonServer');

    // Test 1: List tools
    {
      const response = await client.listTools();
      const tools = response.tools;
      assert.ok(Array.isArray(tools), 'Should return tools array');
      assert.equal(tools.length, 1, 'Should have 1 tool');
      assert.equal(tools[0].name, 'wordCount', 'Tool should be wordCount');
      assert.ok(tools[0].inputSchema, 'Tool should have inputSchema');
      console.log('✅ tools/list endpoint working');
    }

    // Test 2: List prompts (templates)
    {
      const response = await client.listPrompts();
      const prompts = response.prompts;
      assert.ok(Array.isArray(prompts), 'Should return prompts array');
      assert.equal(prompts.length, 3, 'Should have 3 prompts');

      const promptNames = prompts.map(p => p.name).sort();
      assert.deepEqual(promptNames, ['codeReview', 'commitPrompt', 'prDescription'], 'Should have correct prompt names');
      console.log('✅ prompts/list endpoint working');
    }

    // Test 3: List resources (static URIs)
    {
      const response = await client.listResources();
      const resources = response.resources;
      assert.ok(Array.isArray(resources), 'Should return resources array');

      // Should only include non-parameterized resources
      const staticUris = resources.filter(r => !r.uri.includes('{'));
      assert.ok(staticUris.length > 0, 'Should have static resources');

      const hasApiDocs = resources.some(r => r.uri === 'api://docs');
      assert.ok(hasApiDocs, 'Should include api://docs');
      console.log('✅ resources/list endpoint working');
    }

    // Test 4: List resource templates (parameterized URIs)
    {
      const response = await client.listResourceTemplates();
      const resourceTemplates = response.resourceTemplates;
      assert.ok(Array.isArray(resourceTemplates), 'Should return resourceTemplates array');

      // Should only include parameterized resources
      const templateUris = resourceTemplates.filter(r => r.uriTemplate.includes('{'));
      assert.ok(templateUris.length > 0, 'Should have template resources');

      const hasReadme = resourceTemplates.some(r => r.uriTemplate === 'readme://{projectType}');
      assert.ok(hasReadme, 'Should include readme://{projectType}');
      console.log('✅ resources/templates/list endpoint working');
    }

    // Test 5: Call a tool
    {
      const response = await client.callTool({
        name: 'wordCount',
        arguments: { text: 'Hello world test' },
      });

      const content = response.content;
      assert.ok(Array.isArray(content), 'Should return content array');
      assert.equal(content[0].type, 'text', 'Should be text type');
      assert.ok(content[0].text.includes('3'), 'Should count 3 words');
      console.log('✅ tools/call endpoint working');
    }

    // Test 6: Get a prompt
    {
      const response = await client.getPrompt({
        name: 'codeReview',
        arguments: {
          language: 'TypeScript',
          code: 'const x = 5;',
        },
      });

      const messages = response.messages;
      assert.ok(Array.isArray(messages), 'Should return messages array');
      assert.ok(messages.length > 0, 'Should have at least one message');
      assert.equal(messages[0].role, 'user', 'Should have user role');
      assert.ok(messages[0].content.text.includes('TypeScript'), 'Should include language');
      console.log('✅ prompts/get endpoint working');
    }

    // Test 7: Read a static resource
    {
      const response = await client.readResource({
        uri: 'api://docs',
      });

      const contents = response.contents;
      assert.ok(Array.isArray(contents), 'Should return contents array');
      assert.equal(contents[0].mimeType, 'text/markdown', 'Should have markdown MIME type');
      assert.ok(contents[0].text.includes('API'), 'Should include API content');
      console.log('✅ resources/read (static) endpoint working');
    }

    // Test 8: Read a parameterized resource
    {
      const response = await client.readResource({
        uri: 'readme://api',
      });

      const contents = response.contents;
      assert.ok(Array.isArray(contents), 'Should return contents array');
      assert.ok(contents[0].text.includes('API Project'), 'Should return API project README');
      assert.ok(contents[0].text.includes('REST API'), 'Should include API-specific content');
      console.log('✅ resources/read (parameterized) endpoint working');
    }

    console.log('\n✅ All MCP Integration tests passed!');

  } catch (error: any) {
    console.error('❌ Integration test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests().catch(console.error);
}
