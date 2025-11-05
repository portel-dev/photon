/**
 * Quick test for GitHub Issues MCP
 *
 * Usage:
 *   export GITHUB_TOKEN="your_token_here"
 *   npx tsx test-github.ts
 */

import GitHubIssues from './examples/github-issues.photon.js';

async function test() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error('❌ Set GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  console.log('🧪 Testing GitHub Issues MCP\n');

  const github = new GitHubIssues(token);
  await github.onInitialize();

  // Test 1: List issues from a popular repo
  console.log('Test 1: List issues from anthropics/anthropic-sdk-typescript');
  const result = await github.listIssues({
    owner: 'anthropics',
    repo: 'anthropic-sdk-typescript',
    state: 'open',
    per_page: 3
  });

  if (result.success) {
    console.log(`✅ Found ${result.count} issues`);
    result.issues.forEach((issue: any, i: number) => {
      console.log(`  ${i + 1}. #${issue.number}: ${issue.title}`);
    });
  } else {
    console.log(`❌ Error: ${result.error}`);
  }

  // Test 2: Search issues
  console.log('\nTest 2: Search issues');
  const searchResult = await github.searchIssues({
    query: 'repo:anthropics/anthropic-sdk-typescript is:issue is:open',
    per_page: 3
  });

  if (searchResult.success) {
    console.log(`✅ Found ${searchResult.count} issues (total: ${searchResult.total_count})`);
  } else {
    console.log(`❌ Error: ${searchResult.error}`);
  }

  console.log('\n✅ Tests complete!');
}

test().catch(console.error);
