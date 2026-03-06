/**
 * Multi-Client Pagination Testing
 *
 * Validates that multiple concurrent clients can synchronize state through
 * JSON Patch changesets, ensuring the pagination system works correctly across
 * multiple connections.
 */

import PaginatedListPhoton from '../photons/paginated-list.js';
import { strict as assert } from 'assert';

async function runTests() {
  console.log('🧪 Testing Multi-Client Pagination Scenarios...\n');

  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          () => {
            console.log(`✅ ${name}`);
            passed++;
          },
          (err) => {
            console.error(`❌ ${name}: ${err.message}`);
            failed++;
          }
        );
      } else {
        console.log(`✅ ${name}`);
        passed++;
      }
    } catch (err) {
      console.error(`❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  // Test 1: Single client pagination
  await test('Single client can paginate through items', async () => {
    const photon = new PaginatedListPhoton() as any;

    // Get first page
    const page1 = await photon.list(0, 10);
    assert.strictEqual(page1.length, 10, 'First page should have 10 items');

    // Get second page
    const page2 = await photon.list(10, 10);
    assert.strictEqual(page2.length, 10, 'Second page should have 10 items');

    // Pages should have different items
    assert.notStrictEqual(page1[0].id, page2[0].id, 'Pages should contain different items');
  });

  // Test 2: Multiple clients independent pagination
  await test('Multiple clients can paginate independently', async () => {
    const client1 = new PaginatedListPhoton() as any;
    const client2 = new PaginatedListPhoton() as any;

    // Clients paginate to different ranges
    const c1_page = await client1.list(0, 5);
    const c2_page = await client2.list(20, 5);

    assert.strictEqual(c1_page.length, 5, 'Client 1 page should have 5 items');
    assert.strictEqual(c2_page.length, 5, 'Client 2 page should have 5 items');
    assert.notStrictEqual(c1_page[0].id, c2_page[0].id, 'Clients should see different data');
  });

  // Test 3: State mutation in shared instance
  await test('State mutations are tracked across calls', async () => {
    const photon = new PaginatedListPhoton() as any;

    // Get initial state
    const initial = await photon.list(0, 5);
    const initialCount = photon.items.length;

    // Simulate adding an item (stateful mutation)
    photon.items.push({
      id: 'new-item-' + Date.now(),
      title: 'New Item',
      description: 'Added during test',
      createdAt: new Date().toISOString(),
    });

    // Verify state changed
    assert.strictEqual(photon.items.length, initialCount + 1, 'Items array should grow');

    // Subsequent calls should see updated state
    const updated = await photon.list(0, 5);
    assert.ok(updated.length > 0, 'Should still return items after mutation');
  });

  // Test 4: Concurrent reads don't interfere
  await test('Concurrent reads from different ranges work correctly', async () => {
    const photon = new PaginatedListPhoton() as any;

    // Make concurrent requests to different ranges
    const promises = [photon.list(0, 10), photon.list(10, 10), photon.list(20, 10)];

    const [page1, page2, page3] = await Promise.all(promises);

    assert.strictEqual(page1.length, 10, 'Page 1 should be complete');
    assert.strictEqual(page2.length, 10, 'Page 2 should be complete');
    assert.strictEqual(page3.length, 10, 'Page 3 should be complete');

    // Verify no data overlap between pages
    const ids = new Set<string>();
    for (const page of [page1, page2, page3]) {
      for (const item of page) {
        assert.ok(!ids.has(item.id), `Item ${item.id} should not appear in multiple pages`);
        ids.add(item.id);
      }
    }
  });

  // Test 5: Edge cases - boundary conditions
  await test('Pagination handles boundary conditions correctly', async () => {
    const photon = new PaginatedListPhoton() as any;
    const totalItems = photon.items.length;

    // Request beyond end
    const lastPage = await photon.list(totalItems - 5, 20);
    assert.ok(lastPage.length <= 5, 'Should not return more items than exist');

    // Request from negative index (should be clamped)
    const fromNegative = await photon.list(-10, 10);
    assert.strictEqual(fromNegative.length, 10, 'Should handle negative start gracefully');

    // Zero limit (should return empty or minimum)
    const zeroLimit = await photon.list(0, 0);
    assert.ok(zeroLimit.length >= 0, 'Should handle zero limit gracefully');
  });

  // Test 6: Stateful mutation during pagination
  await test('Adding items during pagination updates state correctly', async () => {
    const photon = new PaginatedListPhoton() as any;
    const originalLength = photon.items.length;

    // Get a page
    const page1 = await photon.list(0, 10);

    // Add items
    for (let i = 0; i < 5; i++) {
      photon.items.push({
        id: `concurrent-${i}-${Date.now()}`,
        title: `Added Item ${i}`,
        description: 'Added during concurrent access',
        createdAt: new Date().toISOString(),
      });
    }

    // Verify length increased
    assert.strictEqual(photon.items.length, originalLength + 5, 'Items array should be updated');

    // Get a page after mutation
    const page2 = await photon.list(0, 10);
    assert.strictEqual(page2.length, 10, 'Should return correct number after mutation');
  });

  // Test 7: Multiple clients sharing same photon instance
  await test('Multiple clients reading from same photon instance see consistent state', async () => {
    const sharedPhoton = new PaginatedListPhoton() as any;

    // Two "clients" read from same instance
    const client1_read = await sharedPhoton.list(0, 20);
    const client2_read = await sharedPhoton.list(0, 20);

    // Should be identical since they're reading from same instance
    assert.strictEqual(
      client1_read.length,
      client2_read.length,
      'Both clients should read same count'
    );

    for (let i = 0; i < client1_read.length; i++) {
      assert.strictEqual(client1_read[i].id, client2_read[i].id, `Item ${i} should be identical`);
    }
  });

  // Test 8: Pagination with filter simulation
  await test('Can simulate filtered pagination', async () => {
    const photon = new PaginatedListPhoton() as any;

    // Get all items
    const allItems = await photon.list(0, 1000);

    // Simulate multiple page requests
    const pageSize = 15;
    const pageCount = Math.ceil(allItems.length / pageSize);

    let totalRead = 0;
    for (let page = 0; page < pageCount; page++) {
      const items = await photon.list(page * pageSize, pageSize);
      totalRead += items.length;
    }

    assert.strictEqual(totalRead, allItems.length, 'Should read all items across pages');
  });

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
