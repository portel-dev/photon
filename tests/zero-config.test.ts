/**
 * Tests for Zero-Config MCP Features
 *
 * Tests:
 * - parsePhotonSpec() — parsing extended photon name format
 * - buildPlaceholderTools() — via PhotonServer with unresolvedPhoton
 * - UnresolvedPhoton constructor handling — server accepts unresolved without filePath validation
 */

import { strict as assert } from 'assert';

// ══════════════════════════════════════════════════════════════════════════════
// parsePhotonSpec Tests
// ══════════════════════════════════════════════════════════════════════════════

import { parsePhotonSpec } from '../src/cli.js';

function testParsePhotonSpec() {
  console.log('📋 Testing parsePhotonSpec()...\n');

  // 1. Simple name
  {
    const result = parsePhotonSpec('rss-feed');
    assert.deepEqual(result, { name: 'rss-feed' });
    console.log('  ✅ Simple name: "rss-feed"');
  }

  // 2. Marketplace source
  {
    const result = parsePhotonSpec('alice/repo:rss-feed');
    assert.deepEqual(result, { name: 'rss-feed', marketplaceSource: 'alice/repo' });
    console.log('  ✅ Marketplace source: "alice/repo:rss-feed"');
  }

  // 3. Colon without slash (not a marketplace)
  {
    const result = parsePhotonSpec('rss:feed');
    assert.deepEqual(result, { name: 'rss:feed' });
    console.log('  ✅ Colon without slash: "rss:feed"');
  }

  // 4. Multiple colons
  {
    const result = parsePhotonSpec('org/repo:my-photon');
    assert.deepEqual(result, { name: 'my-photon', marketplaceSource: 'org/repo' });
    console.log('  ✅ Standard marketplace format: "org/repo:my-photon"');
  }

  // 5. Right side has slash (invalid marketplace format)
  {
    const result = parsePhotonSpec('org/repo:a/b');
    assert.deepEqual(result, { name: 'org/repo:a/b' });
    console.log('  ✅ Right side with slash (not marketplace): "org/repo:a/b"');
  }

  // 6. Empty right side
  {
    const result = parsePhotonSpec('org/repo:');
    assert.deepEqual(result, { name: 'org/repo:' });
    console.log('  ✅ Empty right side: "org/repo:"');
  }

  // 7. No colon at all
  {
    const result = parsePhotonSpec('simple-photon');
    assert.deepEqual(result, { name: 'simple-photon' });
    console.log('  ✅ No colon: "simple-photon"');
  }

  // 8. Colon at position 0 (no left side)
  {
    const result = parsePhotonSpec(':something');
    assert.deepEqual(result, { name: ':something' });
    console.log('  ✅ Colon at start: ":something"');
  }

  console.log('\n  All parsePhotonSpec tests passed!\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// PhotonServer with UnresolvedPhoton Tests
// ══════════════════════════════════════════════════════════════════════════════

import { PhotonServer, UnresolvedPhoton } from '../src/server.js';

function testUnresolvedPhotonConstructor() {
  console.log('📋 Testing PhotonServer with UnresolvedPhoton...\n');

  // 1. Constructor accepts unresolvedPhoton without filePath validation error
  {
    const unresolvedPhoton: UnresolvedPhoton = {
      name: 'test-photon',
      workingDir: '/tmp/test',
      sources: [
        {
          marketplace: {
            name: 'test-marketplace',
            repo: 'org/repo',
            url: 'https://example.com',
            sourceType: 'github' as any,
            source: 'org/repo',
            enabled: true,
          },
          metadata: {
            name: 'test-photon',
            version: '1.0.0',
            description: 'A test photon',
            tools: ['fetch', 'search'],
          },
        },
      ],
    };

    // Should NOT throw — empty filePath is allowed when unresolvedPhoton is set
    const server = new PhotonServer({
      filePath: '',
      unresolvedPhoton,
    });
    assert.ok(server, 'Server should be created with unresolvedPhoton');
    console.log('  ✅ Constructor accepts unresolvedPhoton with empty filePath');
  }

  // 2. Constructor without unresolvedPhoton requires valid filePath
  {
    let threw = false;
    try {
      new PhotonServer({
        filePath: '',
      });
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, 'Should throw when filePath is empty and no unresolvedPhoton');
    console.log('  ✅ Constructor throws without unresolvedPhoton and empty filePath');
  }

  console.log('\n  All UnresolvedPhoton constructor tests passed!\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// buildPlaceholderTools Tests (via server internals)
// ══════════════════════════════════════════════════════════════════════════════

function testBuildPlaceholderTools() {
  console.log('📋 Testing buildPlaceholderTools() via PhotonServer...\n');

  // 1. With metadata tools: returns named placeholder tools
  {
    const unresolvedPhoton: UnresolvedPhoton = {
      name: 'test-photon',
      workingDir: '/tmp/test',
      sources: [
        {
          marketplace: {
            name: 'mp1',
            repo: 'org/repo',
            url: 'https://example.com',
            sourceType: 'github' as any,
            source: 'org/repo',
            enabled: true,
          },
          metadata: {
            name: 'test-photon',
            version: '1.0.0',
            description: 'Test',
            tools: ['fetch', 'search'],
          },
        },
      ],
    };

    const server = new PhotonServer({
      filePath: '',
      unresolvedPhoton,
    });

    // Access the private method via type casting
    const tools = (server as any).buildPlaceholderTools();
    assert.equal(tools.length, 2, 'Should have 2 placeholder tools');
    assert.equal(tools[0].name, 'fetch', 'First tool should be "fetch"');
    assert.equal(tools[1].name, 'search', 'Second tool should be "search"');
    assert.ok(
      tools[0].description.includes('Requires setup'),
      'Should have setup description'
    );
    console.log('  ✅ With metadata tools: returns named placeholder tools');
  }

  // 2. Without metadata tools: returns single "setup" tool
  {
    const unresolvedPhoton: UnresolvedPhoton = {
      name: 'test-photon',
      workingDir: '/tmp/test',
      sources: [
        {
          marketplace: {
            name: 'mp1',
            repo: 'org/repo',
            url: 'https://example.com',
            sourceType: 'github' as any,
            source: 'org/repo',
            enabled: true,
          },
          // No metadata.tools
        },
      ],
    };

    const server = new PhotonServer({
      filePath: '',
      unresolvedPhoton,
    });

    const tools = (server as any).buildPlaceholderTools();
    assert.equal(tools.length, 1, 'Should have 1 setup tool');
    assert.equal(tools[0].name, 'setup', 'Tool should be named "setup"');
    assert.ok(
      tools[0].description.includes('Set up'),
      'Should mention setup in description'
    );
    console.log('  ✅ Without metadata tools: returns single "setup" tool');
  }

  // 3. Multiple sources merge and deduplicate tool names
  {
    const unresolvedPhoton: UnresolvedPhoton = {
      name: 'test-photon',
      workingDir: '/tmp/test',
      sources: [
        {
          marketplace: {
            name: 'mp1',
            repo: 'org/repo1',
            url: 'https://example.com',
            sourceType: 'github' as any,
            source: 'org/repo1',
            enabled: true,
          },
          metadata: {
            name: 'test-photon',
            version: '1.0.0',
            description: 'Test',
            tools: ['fetch', 'search'],
          },
        },
        {
          marketplace: {
            name: 'mp2',
            repo: 'org/repo2',
            url: 'https://example2.com',
            sourceType: 'github' as any,
            source: 'org/repo2',
            enabled: true,
          },
          metadata: {
            name: 'test-photon',
            version: '1.0.0',
            description: 'Test',
            tools: ['search', 'analyze'], // 'search' is duplicate
          },
        },
      ],
    };

    const server = new PhotonServer({
      filePath: '',
      unresolvedPhoton,
    });

    const tools = (server as any).buildPlaceholderTools();
    const toolNames = tools.map((t: any) => t.name);
    assert.equal(tools.length, 3, 'Should have 3 unique tools');
    assert.ok(toolNames.includes('fetch'), 'Should include fetch');
    assert.ok(toolNames.includes('search'), 'Should include search');
    assert.ok(toolNames.includes('analyze'), 'Should include analyze');
    console.log('  ✅ Multiple sources merge and deduplicate tool names');
  }

  // 4. No unresolvedPhoton returns empty array
  {
    // Need a valid filePath when no unresolvedPhoton
    const server = new PhotonServer({
      filePath: '/tmp/test.photon.ts',
    });

    const tools = (server as any).buildPlaceholderTools();
    assert.equal(tools.length, 0, 'Should return empty array without unresolvedPhoton');
    console.log('  ✅ No unresolvedPhoton: returns empty array');
  }

  console.log('\n  All buildPlaceholderTools tests passed!\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// Run all tests
// ══════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('🧪 Running Zero-Config Tests...\n');

  testParsePhotonSpec();
  testUnresolvedPhotonConstructor();
  testBuildPlaceholderTools();

  console.log('✅ All zero-config tests passed!');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
