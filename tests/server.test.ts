/**
 * Tests for Photon Server - MCP protocol handlers
 */

import { PhotonServer } from '../src/server.js';
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
      assert.equal(isTemplate('readme://{projectType}'), true, 'Parameterized URI should be template');
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
      assert.deepEqual(params2, { owner: 'facebook', repo: 'react' }, 'Should extract multiple parameters');

      console.log('✅ URI parameter parsing');
    }

    // Test 4: URI pattern matching
    {
      const server = new PhotonServer({ filePath: testFile });

      const matchPattern = (pattern: string, uri: string) =>
        (server as any).matchUriPattern(pattern, uri);

      assert.equal(matchPattern('readme://{projectType}', 'readme://api'), true, 'Should match pattern');
      assert.equal(matchPattern('readme://{projectType}', 'readme://library'), true, 'Should match different value');
      assert.equal(matchPattern('readme://{projectType}', 'docs://api'), false, 'Should not match different scheme');

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
        messages: [
          { role: 'user', content: { type: 'text', text: 'Test' } }
        ]
      });
      assert.deepEqual(formatted2.messages, [
        { role: 'user', content: { type: 'text', text: 'Test' } }
      ], 'Should pass through TemplateResponse');

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
