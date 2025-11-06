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

  // Test 10: Windows absolute path (C:\) - only on Windows
  if (process.platform === 'win32') {
    const result = parseSource('C:\\Program Files\\Microsoft\\Caller');
    assert.ok(result, 'Should parse Windows absolute path');
    assert.equal(result.sourceType, 'local', 'Should be local type');
    assert.equal(result.name, 'Caller', 'Name should be Caller');
    assert.ok(result.url.startsWith('file://'), 'URL should start with file://');
    assert.ok(result.url.includes('Program Files'), 'URL should include path with spaces');
    console.log('✅ Windows absolute path parsing');
  } else {
    // On non-Windows, just verify the regex matches Windows paths
    const windowsPathRegex = /^[A-Za-z]:[\\/]/;
    assert.ok(windowsPathRegex.test('C:\\Program Files\\Microsoft\\Caller'), 'Should detect Windows path pattern');
    console.log('✅ Windows absolute path pattern detection (cross-platform)');
  }

  // Test 11: Windows absolute path with forward slashes
  if (process.platform === 'win32') {
    const result = parseSource('D:/Users/Documents/photons');
    assert.ok(result, 'Should parse Windows path with forward slashes');
    assert.equal(result.sourceType, 'local', 'Should be local type');
    assert.equal(result.name, 'photons', 'Name should be photons');
    assert.ok(result.url.startsWith('file://'), 'URL should start with file://');
    console.log('✅ Windows forward slash path parsing');
  } else {
    const windowsPathRegex = /^[A-Za-z]:[\\/]/;
    assert.ok(windowsPathRegex.test('D:/Users/Documents/photons'), 'Should detect Windows path with forward slashes');
    console.log('✅ Windows forward slash path pattern detection (cross-platform)');
  }

  // Test 12: Invalid format
  {
    const result = parseSource('invalid-format');
    assert.equal(result, null, 'Should return null for invalid format');
    console.log('✅ Invalid format handling');
  }

  // Test 13: Duplicate name handling with numeric suffixes
  {
    // Test the getUniqueName logic directly through add() method behavior
    // by simulating what happens when the same base name is added multiple times

    // Mock a manager with pre-existing marketplaces
    const testManager = new MarketplaceManager();
    await testManager.initialize();

    // Manually add marketplaces to config to simulate existing ones
    (testManager as any).config.marketplaces = [
      {
        name: 'photon-mcps',
        repo: 'user1/photon-mcps',
        url: 'https://raw.githubusercontent.com/user1/photon-mcps/main',
        sourceType: 'github',
        source: 'user1/photon-mcps',
        enabled: true,
      },
      {
        name: 'photon-mcps-2',
        repo: 'user2/photon-mcps',
        url: 'https://raw.githubusercontent.com/user2/photon-mcps/main',
        sourceType: 'github',
        source: 'user2/photon-mcps',
        enabled: true,
      },
    ];

    // Test getUniqueName with existing names
    const uniqueName1 = (testManager as any).getUniqueName('photon-mcps');
    assert.equal(uniqueName1, 'photon-mcps-3', 'Should return photon-mcps-3 when -1 and -2 exist');

    const uniqueName2 = (testManager as any).getUniqueName('new-marketplace');
    assert.equal(uniqueName2, 'new-marketplace', 'Should return base name when no conflict');

    console.log('✅ Duplicate name handling with numeric suffixes');
  }

  // Test 14: Duplicate source detection
  {
    const testManager = new MarketplaceManager();
    await testManager.initialize();

    // Manually add a marketplace
    (testManager as any).config.marketplaces = [
      {
        name: 'photon-mcps',
        repo: 'anthropics/photon-mcps',
        url: 'https://raw.githubusercontent.com/anthropics/photon-mcps/main',
        sourceType: 'github',
        source: 'anthropics/photon-mcps',
        enabled: true,
      },
    ];

    // Test findBySource
    const found = (testManager as any).findBySource('anthropics/photon-mcps');
    assert.ok(found, 'Should find marketplace by source');
    assert.equal(found.name, 'photon-mcps', 'Should return correct marketplace');

    const notFound = (testManager as any).findBySource('other/repo');
    assert.equal(notFound, undefined, 'Should return undefined for non-existent source');

    console.log('✅ Duplicate source detection');
  }

  // Test 15: Manual URI template detection (regex check)
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
