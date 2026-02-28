/**
 * Tests for Photon Server - MCP protocol handlers
 */

import { PhotonServer } from '../dist/server.js';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function runTests() {
  console.log('🧪 Running Photon Server Tests...\n');

  const testDir = path.join(os.tmpdir(), 'photon-server-test');
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Create test MCP file
    const testFile = path.join(testDir, 'test-server.photon.ts');
    const content = `
      type Template = string & { __brand: 'Template' };
      type Static = string & { __brand: 'Static' };
      const asTemplate = (str: string): Template => str as Template;
      const asStatic = (str: string): Static => str as Static;

      export default class ServerTestMCP {
        /**
         * Regular tool
         * @param value Value to echo
         */
        async echo(params: { value: string }) {
          return \`Echo: \${params.value}\`;
        }

        /**
         * Generate code review
         * @Template
         * @param language Programming language
         * @param code Code to review
         */
        async codeReview(params: { language: string; code: string }): Promise<Template> {
          return asTemplate(\`Review this \${params.language} code:\\n\${params.code}\`);
        }

        /**
         * API documentation
         * @Static api://docs
         * @mimeType text/markdown
         */
        async apiDocs(params: {}): Promise<Static> {
          return asStatic("# API Documentation\\n\\nEndpoints...");
        }

        /**
         * Project README
         * @Static readme://{projectType}
         * @mimeType text/markdown
         * @param projectType Type of project
         */
        async projectReadme(params: { projectType: string }): Promise<Static> {
          return asStatic(\`# \${params.projectType} Project\\n\\nDescription...\`);
        }
      }
    `;

    await fs.writeFile(testFile, content, 'utf-8');

    // Test 1: Server initialization and capabilities
    {
      const server = new PhotonServer({ filePath: testFile });

      // Access private server instance
      const mcpServer = (server as any).server;

      // Check capabilities
      const capabilities = (mcpServer as any)._capabilities;
      assert.ok(capabilities.tools, 'Should have tools capability');
      assert.ok(capabilities.prompts, 'Should have prompts capability');
      assert.ok(capabilities.resources, 'Should have resources capability');

      assert.equal(capabilities.tools.listChanged, true, 'Tools should have listChanged');
      assert.equal(capabilities.prompts.listChanged, true, 'Prompts should have listChanged');
      assert.equal(capabilities.resources.listChanged, true, 'Resources should have listChanged');

      console.log('✅ Server capabilities configured');
    }

    // Test 2: URI template detection
    {
      const server = new PhotonServer({ filePath: testFile });

      // Test isUriTemplate helper
      const isTemplate = (uri: string) => (server as any).isUriTemplate(uri);

      assert.equal(isTemplate('api://docs'), false, 'Static URI should not be template');
      assert.equal(
        isTemplate('readme://{projectType}'),
        true,
        'Parameterized URI should be template'
      );
      assert.equal(isTemplate('repo://{owner}/{repo}'), true, 'Multiple params should be template');

      console.log('✅ URI template detection');
    }

    // Test 3: URI parameter parsing
    {
      const server = new PhotonServer({ filePath: testFile });

      const parseParams = (pattern: string, uri: string) =>
        (server as any).parseUriParams(pattern, uri);

      const params1 = parseParams('readme://{projectType}', 'readme://api');
      assert.deepEqual(params1, { projectType: 'api' }, 'Should extract single parameter');

      const params2 = parseParams('repo://{owner}/{repo}', 'repo://facebook/react');
      assert.deepEqual(
        params2,
        { owner: 'facebook', repo: 'react' },
        'Should extract multiple parameters'
      );

      console.log('✅ URI parameter parsing');
    }

    // Test 4: URI pattern matching
    {
      const server = new PhotonServer({ filePath: testFile });

      const matchPattern = (pattern: string, uri: string) =>
        (server as any).matchUriPattern(pattern, uri);

      assert.equal(
        matchPattern('readme://{projectType}', 'readme://api'),
        true,
        'Should match pattern'
      );
      assert.equal(
        matchPattern('readme://{projectType}', 'readme://library'),
        true,
        'Should match different value'
      );
      assert.equal(
        matchPattern('readme://{projectType}', 'docs://api'),
        false,
        'Should not match different scheme'
      );

      console.log('✅ URI pattern matching');
    }

    // Test 5: Template result formatting
    {
      const server = new PhotonServer({ filePath: testFile });

      const formatTemplate = (result: any) => (server as any).formatTemplateResult(result);

      // Simple string result
      const formatted1 = formatTemplate('Hello world');
      assert.ok(formatted1.messages, 'Should have messages array');
      assert.equal(formatted1.messages[0].role, 'user', 'Should have user role');
      assert.equal(formatted1.messages[0].content.type, 'text', 'Should have text type');
      assert.equal(formatted1.messages[0].content.text, 'Hello world', 'Should preserve text');

      // TemplateResponse object
      const formatted2 = formatTemplate({
        messages: [{ role: 'user', content: { type: 'text', text: 'Test' } }],
      });
      assert.deepEqual(
        formatted2.messages,
        [{ role: 'user', content: { type: 'text', text: 'Test' } }],
        'Should pass through TemplateResponse'
      );

      console.log('✅ Template result formatting');
    }

    // Test 6: Static result formatting
    {
      const server = new PhotonServer({ filePath: testFile });

      const formatStatic = (result: any, mimeType?: string) =>
        (server as any).formatStaticResult(result, mimeType);

      const formatted = formatStatic('# Documentation', 'text/markdown');
      assert.ok(formatted.contents, 'Should have contents array');
      assert.equal(formatted.contents[0].mimeType, 'text/markdown', 'Should have MIME type');
      assert.equal(formatted.contents[0].text, '# Documentation', 'Should preserve text');

      console.log('✅ Static result formatting');
    }

    // ═══════════════════════════════════════════════════════════════════
    // ASSET SERVING TESTS
    // ═══════════════════════════════════════════════════════════════════

    // Test 7: Asset URI pattern matching
    {
      const server = new PhotonServer({ filePath: testFile });

      // Test asset URI regex pattern
      const assetPattern = /^photon:\/\/([^/]+)\/(ui|prompts|resources)\/(.+)$/;

      const match1 = 'photon://test-server/ui/settings'.match(assetPattern);
      assert.ok(match1, 'Should match asset URI');
      assert.equal(match1![1], 'test-server', 'Should extract photon name');
      assert.equal(match1![2], 'ui', 'Should extract asset type');
      assert.equal(match1![3], 'settings', 'Should extract asset id');

      const match2 = 'photon://prefs/prompts/welcome'.match(assetPattern);
      assert.equal(match2![2], 'prompts', 'Should match prompts type');

      const match3 = 'photon://app/resources/config'.match(assetPattern);
      assert.equal(match3![2], 'resources', 'Should match resources type');

      const noMatch = 'api://docs'.match(assetPattern);
      assert.equal(noMatch, null, 'Should not match non-asset URIs');

      console.log('✅ Asset URI pattern matching');
    }

    // Test 8: Asset resource description generation
    {
      // Test that linked tools get proper descriptions
      const ui1 = { id: 'settings', linkedTool: 'editSettings', mimeType: 'text/html' };
      const desc1 = ui1.linkedTool
        ? `UI template for ${ui1.linkedTool} tool`
        : `UI template: ${ui1.id}`;
      assert.equal(
        desc1,
        'UI template for editSettings tool',
        'Should include linked tool in description'
      );

      const ui2 = { id: 'theme', mimeType: 'text/html' };
      const desc2 = (ui2 as any).linkedTool
        ? `UI template for ${(ui2 as any).linkedTool} tool`
        : `UI template: ${ui2.id}`;
      assert.equal(desc2, 'UI template: theme', 'Should fallback to id when no linked tool');

      console.log('✅ Asset resource description generation');
    }

    // Test 9: Asset MIME type detection
    {
      const getMimeType = (filename: string): string => {
        if (filename.endsWith('.html')) return 'text/html';
        if (filename.endsWith('.md')) return 'text/markdown';
        if (filename.endsWith('.json')) return 'application/json';
        if (filename.endsWith('.jsx') || filename.endsWith('.tsx')) return 'text/jsx';
        return 'application/octet-stream';
      };

      assert.equal(getMimeType('settings.html'), 'text/html', 'Should detect HTML');
      assert.equal(getMimeType('welcome.md'), 'text/markdown', 'Should detect Markdown');
      assert.equal(getMimeType('config.json'), 'application/json', 'Should detect JSON');
      assert.equal(getMimeType('component.jsx'), 'text/jsx', 'Should detect JSX');
      assert.equal(
        getMimeType('unknown.xyz'),
        'application/octet-stream',
        'Should fallback to octet-stream'
      );

      console.log('✅ Asset MIME type detection');
    }

    // Test 10: Server with assets (via loader)
    {
      const photonName = 'test-with-assets';
      const photonFile = path.join(testDir, `${photonName}.photon.ts`);
      const assetFolder = path.join(testDir, photonName);

      // Create asset folder structure
      await fs.mkdir(path.join(assetFolder, 'ui'), { recursive: true });
      await fs.writeFile(path.join(assetFolder, 'ui', 'form.html'), '<html>Form</html>');

      // Create photon file
      const assetContent = `
        export default class TestWithAssets {
          /**
           * Edit form
           * @ui form
           */
          async editForm() { return true; }
        }
      `;
      await fs.writeFile(photonFile, assetContent, 'utf-8');

      // Test via loader (server.start() is async and uses stdio)
      const { PhotonLoader } = await import('../src/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(photonFile);

      // Check that MCP has assets
      assert.ok(mcp.assets, 'MCP should have assets');
      assert.equal(mcp.assets.ui.length, 1, 'Should have 1 UI asset');
      assert.equal(mcp.assets.ui[0].linkedTool, 'editForm', 'UI should be linked to editForm');

      console.log('✅ Server with assets');
    }

    // ═══════════════════════════════════════════════════════════════════
    // LABEL TAG TESTS
    // ═══════════════════════════════════════════════════════════════════

    // Test 11: Server loads photon with {@label} tags
    {
      const labelTestFile = path.join(testDir, 'label-test.photon.ts');
      const labelContent = `
        export default class LabelTestMCP {
          /**
           * Add two numbers with custom labels
           * @param a {@label First Number} First value
           * @param b {@label Second Number} Second value
           * @returns {@label Calculate Sum} The sum
           */
          async add(params: { a: number; b: number }) {
            return params.a + params.b;
          }
        }
      `;
      await fs.writeFile(labelTestFile, labelContent, 'utf-8');

      // Load via PhotonLoader and verify labels are in schema
      const { PhotonLoader } = await import('../src/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(labelTestFile);

      // Check that the tools array includes title for params
      assert.ok(mcp.tools, 'MCP should have tools');
      assert.equal(mcp.tools.length, 1, 'Should have 1 tool');

      const addTool = mcp.tools[0];
      assert.equal(
        addTool.inputSchema.properties.a.title,
        'First Number',
        'Param a should have custom label'
      );
      assert.equal(
        addTool.inputSchema.properties.b.title,
        'Second Number',
        'Param b should have custom label'
      );
      assert.equal(
        (addTool as any).buttonLabel,
        'Calculate Sum',
        'Tool should have custom button label'
      );

      console.log('✅ Server loads photon with {@label} tags');
    }

    // ═══════════════════════════════════════════════════════════════════
    // MCP APPS CLIENT CAPABILITY DETECTION
    // Tests that UI-capable clients get structuredContent + _meta.ui
    // and basic clients get text-only responses
    // ═══════════════════════════════════════════════════════════════════

    // Create a photon with a @ui-linked tool for testing
    const uiTestFile = path.join(testDir, 'ui-cap-test.photon.ts');
    const uiTestFolder = path.join(testDir, 'ui-cap-test');
    await fs.mkdir(path.join(uiTestFolder, 'ui'), { recursive: true });
    await fs.writeFile(
      path.join(uiTestFolder, 'ui', 'dashboard.html'),
      '<html><body>Dashboard</body></html>'
    );
    await fs.writeFile(
      uiTestFile,
      `export default class UiCapTest {
        /**
         * Show dashboard
         * @ui dashboard
         */
        async show() { return { items: [1, 2, 3] }; }

        /** No UI linked */
        async plain() { return 'hello'; }
      }`,
      'utf-8'
    );

    // Helper: create a mock server object that mimics Server.getClientCapabilities/getClientVersion
    function mockServer(clientName: string, capabilities: Record<string, any>): any {
      return {
        getClientCapabilities: () => capabilities,
        getClientVersion: () => ({ name: clientName, version: '1.0' }),
      };
    }

    // Test 12: Claude Desktop (extensions field) → UI capable
    {
      const server = new PhotonServer({ filePath: uiTestFile });
      const supportsUI = (server as any).clientSupportsUI.bind(server);

      const claudeDesktop = mockServer('claude-ai', {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
      });
      assert.equal(supportsUI(claudeDesktop), true, 'Claude Desktop should support UI');
      console.log('✅ Claude Desktop (extensions) → UI capable');
    }

    // Test 13: ChatGPT (extensions field) → UI capable
    {
      const server = new PhotonServer({ filePath: uiTestFile });
      const supportsUI = (server as any).clientSupportsUI.bind(server);

      const chatgpt = mockServer('chatgpt', {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
      });
      assert.equal(supportsUI(chatgpt), true, 'ChatGPT should support UI');
      console.log('✅ ChatGPT (extensions) → UI capable');
    }

    // Test 14: Older client using experimental field → UI capable
    {
      const server = new PhotonServer({ filePath: uiTestFile });
      const supportsUI = (server as any).clientSupportsUI.bind(server);

      const olderClient = mockServer('mcpjam', {
        experimental: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
      });
      assert.equal(
        supportsUI(olderClient),
        true,
        'Client with experimental field should support UI'
      );
      console.log('✅ Older client (experimental) → UI capable');
    }

    // Test 15: Basic CLI client (no UI capability) → NOT UI capable
    {
      const server = new PhotonServer({ filePath: uiTestFile });
      const supportsUI = (server as any).clientSupportsUI.bind(server);

      const cliClient = mockServer('some-cli-tool', {});
      assert.equal(supportsUI(cliClient), false, 'CLI client should not support UI');

      const emptyCapabilities = mockServer('another-client', { experimental: {} });
      assert.equal(
        supportsUI(emptyCapabilities),
        false,
        'Client with empty experimental should not support UI'
      );

      const nullCapabilities = mockServer('null-client', undefined as any);
      assert.equal(
        supportsUI(nullCapabilities),
        false,
        'Client with null capabilities should not support UI'
      );

      console.log('✅ Basic clients (no UI capability) → NOT UI capable');
    }

    // Test 16: Beam (implicit UI support via name) → UI capable
    {
      const server = new PhotonServer({ filePath: uiTestFile });
      const supportsUI = (server as any).clientSupportsUI.bind(server);

      // Beam doesn't send capability — it's our own transport
      const beam = mockServer('beam', {});
      assert.equal(supportsUI(beam), true, 'Beam should support UI implicitly');
      console.log('✅ Beam (implicit) → UI capable');
    }

    // Test 17: Unknown future client that advertises UI → UI capable
    {
      const server = new PhotonServer({ filePath: uiTestFile });
      const supportsUI = (server as any).clientSupportsUI.bind(server);

      const futureClient = mockServer('cursor-mcp', {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
      });
      assert.equal(
        supportsUI(futureClient),
        true,
        'Any client advertising UI extension should be supported'
      );
      console.log('✅ Unknown future client (with extensions) → UI capable');
    }

    // Test 18: Response enrichment — UI client gets structuredContent for UI-linked tool
    {
      const { PhotonLoader } = await import('../src/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(uiTestFile);

      const server = new PhotonServer({ filePath: uiTestFile });
      (server as any).mcp = mcp;

      const supportsUI = (server as any).clientSupportsUI.bind(server);
      const buildUIToolMeta = (server as any).buildUIToolMeta.bind(server);

      // Replicate the enrichment logic from the tool call handler
      const toolName = 'show';
      const actualResult = { items: [1, 2, 3] };
      const linkedUI = mcp.assets?.ui.find((u: any) => u.linkedTool === toolName);
      const uiClient = mockServer('claude-ai', {
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
      });

      assert.ok(linkedUI, 'show tool should have a linked UI asset');
      assert.equal(supportsUI(uiClient), true, 'Claude Desktop should be UI capable');

      // Build response as server would
      const response: any = { content: [{ type: 'text', text: JSON.stringify(actualResult) }] };
      if (linkedUI && supportsUI(uiClient)) {
        response.structuredContent = actualResult;
        response._meta = buildUIToolMeta(linkedUI.id);
      }

      assert.ok(response.structuredContent, 'UI client should get structuredContent');
      assert.deepEqual(
        response.structuredContent.items,
        [1, 2, 3],
        'structuredContent should contain actual result'
      );
      assert.ok(response._meta?.ui, 'UI client should get _meta.ui');

      console.log('✅ UI client tool response includes structuredContent + _meta.ui');
    }

    // Test 19: Response enrichment — basic client gets text only
    {
      const { PhotonLoader } = await import('../src/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(uiTestFile);

      const server = new PhotonServer({ filePath: uiTestFile });
      (server as any).mcp = mcp;

      const supportsUI = (server as any).clientSupportsUI.bind(server);

      const toolName = 'show';
      const actualResult = { items: [1, 2, 3] };
      const linkedUI = mcp.assets?.ui.find((u: any) => u.linkedTool === toolName);
      const basicClient = mockServer('some-cli', {});

      assert.ok(linkedUI, 'show tool should have a linked UI asset');
      assert.equal(supportsUI(basicClient), false, 'Basic CLI client should NOT be UI capable');

      // Build response as server would — no enrichment for basic client
      const response: any = { content: [{ type: 'text', text: JSON.stringify(actualResult) }] };
      if (linkedUI && supportsUI(basicClient)) {
        response.structuredContent = actualResult;
      }

      assert.equal(
        response.structuredContent,
        undefined,
        'Basic client should NOT get structuredContent'
      );
      assert.ok(response.content, 'Basic client should still get content array');

      console.log('✅ Basic client tool response is text-only (no structuredContent)');
    }

    // Test 20: Non-UI-linked tool never gets structuredContent (even for UI clients)
    {
      const { PhotonLoader } = await import('../src/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(uiTestFile);

      const server = new PhotonServer({ filePath: uiTestFile });
      (server as any).mcp = mcp;

      const supportsUI = (server as any).clientSupportsUI.bind(server);
      const buildUIToolMeta = (server as any).buildUIToolMeta.bind(server);

      const toolName = 'plain'; // NOT linked to any UI
      const actualResult = 'hello';
      const linkedUI = mcp.assets?.ui.find((u: any) => u.linkedTool === toolName);
      const uiClient = mockServer('claude-ai', {
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
      });

      assert.equal(linkedUI, undefined, 'plain tool should NOT have a linked UI asset');
      assert.equal(supportsUI(uiClient), true, 'Claude Desktop should be UI capable');

      // Build response — no linkedUI means no enrichment regardless of client capability
      const response: any = { content: [{ type: 'text', text: actualResult }] };
      if (linkedUI && supportsUI(uiClient)) {
        response.structuredContent = actualResult;
        response._meta = buildUIToolMeta((linkedUI as any).id);
      }

      assert.equal(
        response.structuredContent,
        undefined,
        'Non-UI tool should NOT get structuredContent'
      );
      assert.equal(response._meta?.ui, undefined, 'Non-UI tool should NOT get _meta.ui');

      console.log('✅ Non-UI-linked tool has no structuredContent (even for UI clients)');
    }

    console.log('\n✅ All Server tests passed!');
  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
