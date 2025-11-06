/**
 * Tests for Marketplace Manager - Source type parsing
 */

import { MarketplaceManager } from '../src/marketplace-manager.js';
import { strict as assert } from 'assert';

async function runTests() {
  console.log('🧪 Running Marketplace Manager Tests...\n');

  const manager = new MarketplaceManager();
  await manager.initialize();

  // Access private method for testing
  const parseSource = (input: string) => (manager as any).parseMarketplaceSource(input);

  // Test 1: GitHub shorthand
  {
    const result = parseSource('username/repo');
    assert.ok(result, 'Should parse GitHub shorthand');
    assert.equal(result.sourceType, 'github', 'Should be github type');
    assert.equal(result.name, 'repo', 'Name should be repo');
    assert.equal(result.repo, 'username/repo', 'Repo should be username/repo');
    assert.equal(result.url, 'https://raw.githubusercontent.com/username/repo/main', 'URL should be raw GitHub');
    console.log('✅ GitHub shorthand parsing');
  }

  // Test 2: GitHub HTTPS
  {
    const result = parseSource('https://github.com/username/repo');
    assert.ok(result, 'Should parse GitHub HTTPS');
    assert.equal(result.sourceType, 'github', 'Should be github type');
    assert.equal(result.name, 'repo', 'Name should be repo');
    console.log('✅ GitHub HTTPS parsing');
  }

  // Test 3: GitHub HTTPS with .git
  {
    const result = parseSource('https://github.com/username/repo.git');
    assert.ok(result, 'Should parse GitHub HTTPS with .git');
    assert.equal(result.sourceType, 'github', 'Should be github type');
    assert.equal(result.name, 'repo', 'Name should be repo');
    console.log('✅ GitHub HTTPS with .git parsing');
  }

  // Test 4: GitHub SSH
  {
    const result = parseSource('git@github.com:username/repo.git');
    assert.ok(result, 'Should parse GitHub SSH');
    assert.equal(result.sourceType, 'git-ssh', 'Should be git-ssh type');
    assert.equal(result.name, 'repo', 'Name should be repo');
    assert.equal(result.repo, 'username/repo', 'Repo should be username/repo');
    assert.equal(result.url, 'https://raw.githubusercontent.com/username/repo/main', 'Should convert to HTTPS URL');
    console.log('✅ GitHub SSH parsing');
  }

  // Test 5: Direct URL with marketplace.json
  {
    const result = parseSource('https://example.com/marketplace.json');
    assert.ok(result, 'Should parse direct URL');
    assert.equal(result.sourceType, 'url', 'Should be url type');
    assert.equal(result.name, 'marketplace', 'Name should be marketplace');
    assert.equal(result.url, 'https://example.com', 'URL should be base URL');
    console.log('✅ Direct URL parsing');
  }

  // Test 6: Direct URL with path
  {
    const result = parseSource('https://cdn.example.com/photons/my-marketplace.json');
    assert.ok(result, 'Should parse direct URL with path');
    assert.equal(result.sourceType, 'url', 'Should be url type');
    assert.equal(result.name, 'my-marketplace', 'Name should be my-marketplace');
    assert.equal(result.url, 'https://cdn.example.com/photons', 'URL should be parent directory');
    console.log('✅ Direct URL with path parsing');
  }

  // Test 7: Local relative path
  {
    const result = parseSource('./local-mcps');
    assert.ok(result, 'Should parse local relative path');
    assert.equal(result.sourceType, 'local', 'Should be local type');
    assert.equal(result.name, 'local-mcps', 'Name should be local-mcps');
    assert.ok(result.url.startsWith('file://'), 'URL should be file:// protocol');
    console.log('✅ Local relative path parsing');
  }

  // Test 8: Local absolute path
  {
    const result = parseSource('/absolute/path/to/mcps');
    assert.ok(result, 'Should parse local absolute path');
    assert.equal(result.sourceType, 'local', 'Should be local type');
    assert.equal(result.name, 'mcps', 'Name should be mcps');
    assert.equal(result.url, 'file:///absolute/path/to/mcps', 'URL should be file:// with absolute path');
    console.log('✅ Local absolute path parsing');
  }

  // Test 9: Local home directory path
  {
    const result = parseSource('~/my-photons');
    assert.ok(result, 'Should parse home directory path');
    assert.equal(result.sourceType, 'local', 'Should be local type');
    assert.equal(result.name, 'my-photons', 'Name should be my-photons');
    assert.ok(result.url.includes(process.env.HOME || ''), 'Should expand ~ to home directory');
    console.log('✅ Local home directory path parsing');
  }

  // Test 10: Invalid format
  {
    const result = parseSource('invalid-format');
    assert.equal(result, null, 'Should return null for invalid format');
    console.log('✅ Invalid format handling');
  }

  // Test 11: Manual URI template detection (regex check)
  {
    const isTemplate = (uri: string) => /\{[^}]+\}/.test(uri);

    assert.equal(isTemplate('api://docs'), false, 'Static URI should not be template');
    assert.equal(isTemplate('readme://{projectType}'), true, 'URI with {param} should be template');
    assert.equal(isTemplate('github://repos/{owner}/{repo}'), true, 'URI with multiple {params} should be template');
    console.log('✅ URI template regex detection');
  }

  console.log('\n✅ All Marketplace Manager tests passed!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
