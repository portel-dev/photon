#!/usr/bin/env node
/**
 * Test suite for GitHub Issues MCP
 *
 * Usage:
 *   export GITHUB_TOKEN="your_token_here"
 *   npx tsx tests/github-issues.test.ts
 */

import { MCPTestClient, validators } from '../src/test-client.js';
import path from 'path';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ Set GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  console.log('🧪 Testing GitHub Issues MCP\n');

  const client = new MCPTestClient();

  try {
    // Start the MCP server
    const photonPath = path.join(process.cwd(), 'dist', 'cli.js');
    const mcpPath = path.join(process.cwd(), 'examples', 'github-issues.photon.ts');

    await client.start('node', [photonPath, mcpPath], {
      GITHUB_TOKEN: token,
    });

    console.log('✅ MCP server started\n');

    // Initialize
    const initResponse = await client.initialize();
    console.log('✅ Initialized:', initResponse.result?.serverInfo?.name);

    // Run test cases
    const results = await client.runTests([
      {
        name: 'List tools should return all GitHub tools',
        method: 'tools/list',
        validate: validators.and(
          validators.hasResult,
          validators.custom((result) => {
            const tools = result?.tools || [];
            const expectedTools = [
              'listIssues',
              'getIssue',
              'createIssue',
              'updateIssue',
              'addComment',
              'listComments',
              'searchIssues',
            ];

            for (const toolName of expectedTools) {
              if (!tools.find((t: any) => t.name === toolName)) {
                return `Missing tool: ${toolName}`;
              }
            }
            return true;
          })
        ),
      },
      {
        name: 'List issues from anthropics/anthropic-sdk-typescript',
        method: 'tools/call',
        params: {
          name: 'listIssues',
          arguments: {
            owner: 'anthropics',
            repo: 'anthropic-sdk-typescript',
            state: 'open',
            per_page: 3,
          },
        },
        validate: validators.and(
          validators.hasResult,
          validators.hasField('content.0.text'),
          validators.custom((result) => {
            const text = result?.content?.[0]?.text;
            if (!text) return 'Missing content text';

            const data = JSON.parse(text);
            if (!data.success) return `API call failed: ${data.error}`;
            if (!Array.isArray(data.issues)) return 'Issues should be an array';
            if (data.issues.length === 0) return 'Should return at least one issue';

            // Validate issue structure
            const issue = data.issues[0];
            if (!issue.number) return 'Issue missing number';
            if (!issue.title) return 'Issue missing title';
            if (!issue.html_url) return 'Issue missing html_url';

            return true;
          })
        ),
      },
      {
        name: 'Search issues with query',
        method: 'tools/call',
        params: {
          name: 'searchIssues',
          arguments: {
            query: 'repo:anthropics/anthropic-sdk-typescript is:issue is:open',
            per_page: 2,
          },
        },
        validate: validators.and(
          validators.hasResult,
          validators.custom((result) => {
            const text = result?.content?.[0]?.text;
            if (!text) return 'Missing content text';

            const data = JSON.parse(text);
            if (!data.success) return `Search failed: ${data.error}`;
            if (data.total_count === undefined) return 'Missing total_count';
            if (!Array.isArray(data.issues)) return 'Issues should be an array';

            return true;
          })
        ),
      },
      {
        name: 'Get specific issue',
        method: 'tools/call',
        params: {
          name: 'getIssue',
          arguments: {
            owner: 'anthropics',
            repo: 'anthropic-sdk-typescript',
            issue_number: 1,
          },
        },
        validate: validators.and(
          validators.hasResult,
          validators.custom((result) => {
            const text = result?.content?.[0]?.text;
            if (!text) return 'Missing content text';

            const data = JSON.parse(text);
            if (!data.success) return `Get issue failed: ${data.error}`;
            if (!data.issue) return 'Missing issue data';
            if (data.issue.number !== 1) return 'Wrong issue number';

            return true;
          })
        ),
      },
      {
        name: 'List comments on issue',
        method: 'tools/call',
        params: {
          name: 'listComments',
          arguments: {
            owner: 'anthropics',
            repo: 'anthropic-sdk-typescript',
            issue_number: 1,
          },
        },
        validate: validators.and(
          validators.hasResult,
          validators.custom((result) => {
            const text = result?.content?.[0]?.text;
            if (!text) return 'Missing content text';

            const data = JSON.parse(text);
            if (!data.success) return `List comments failed: ${data.error}`;
            if (!Array.isArray(data.comments)) return 'Comments should be an array';

            return true;
          })
        ),
      },
      {
        name: 'Invalid repo should return error',
        method: 'tools/call',
        params: {
          name: 'listIssues',
          arguments: {
            owner: 'nonexistent',
            repo: 'nonexistent-repo-12345',
            state: 'open',
          },
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          const data = JSON.parse(text);
          if (data.success) return 'Should fail for nonexistent repo';
          if (!data.error) return 'Should include error message';

          return true;
        }),
      },
    ]);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`\n📊 Test Results:`);
    console.log(`   ✅ Passed: ${results.passed}`);
    console.log(`   ❌ Failed: ${results.failed}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach((error) => console.log(`   - ${error}`));
    }

    console.log('\n' + '='.repeat(50));

    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Test suite error:', error);
    process.exit(1);
  } finally {
    await client.shutdown();
  }
}

main();
