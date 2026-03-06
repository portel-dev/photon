/**
 * @photon Paginated List
 * @description Demonstrates framework-managed viewport pagination with JSON Patch synchronization
 *
 * This example shows how to implement a @stateful photon that returns paginated data
 * compatible with ViewportAwareProxy. The framework automatically:
 * - Tracks visible viewport on client side using IntersectionObserver
 * - Applies JSON Patch updates to local state
 * - Syncs changes across multiple clients via state-changed events
 *
 * @stateful
 * @runtime ^1.6.0
 */

import type { PhotonRequest } from '@portel/photon-core';

interface Item {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

export default class PaginatedListPhoton {
  /**
   * Items array injected at constructor level for @stateful reactivity
   * Framework detects mutations and broadcasts JSON Patches to all clients
   */
  items: Item[];

  constructor() {
    // Inject with empty array default - CRITICAL for @stateful to work
    this.items = [];
    this._generateSampleData();
  }

  /**
   * Get paginated items
   *
   * Framework automatically:
   * - Detects this returns an array
   * - Wraps with _pagination metadata
   * - Creates ViewportAwareProxy for smart pagination
   * - Tracks viewport and auto-fetches missing ranges
   *
   * @param start Start index (inclusive)
   * @param limit Number of items to return
   * @returns Array of items (framework wraps with pagination metadata)
   *
   * @example
   * // Just return the subset - framework handles pagination!
   * const items = await photon.list(0, 20);
   * // Returns: [item0, item1, ..., item19]
   * //
   * // Framework automatically wraps to:
   * // { items: [...], _pagination: { totalCount: 100, start: 0, end: 20, hasMore: true } }
   */
  async list(start: number = 0, limit: number = 20): Promise<Item[]> {
    // Validate inputs
    start = Math.max(0, Math.floor(start));
    limit = Math.max(1, Math.floor(limit));

    // Calculate bounds
    const end = Math.min(start + limit, this.items.length);

    // Just return the subset - framework handles pagination!
    return this.items.slice(start, end);
  }

  /**
   * Add a new item to the list
   * Emits state-changed event with add patch that all clients receive
   *
   * Server sends: {
   *   instance: "paginatedList",
   *   patches: [{ op: "add", path: "/items/0", value: { id, title, ... } }]
   * }
   *
   * Client-side ViewportAwareProxy automatically:
   * - Applies patch to local state
   * - Updates cache indices
   * - Triggers event for UI to re-render if in viewport
   */
  async add(title: string, description: string): Promise<Item> {
    const item: Item = {
      id: crypto.randomUUID(),
      title,
      description,
      createdAt: new Date().toISOString(),
    };

    // Add to beginning of list
    this.items.unshift(item);

    // The @stateful decorator automatically emits state-changed with patches
    // Clients receive: patches = [{ op: "add", path: "/items/0", value: item }]
    return item;
  }

  /**
   * Update an item in the list
   * Emits replace patch that updates a single item
   */
  async update(id: string, title: string, description: string): Promise<Item | null> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated: Item = {
      ...this.items[index],
      title,
      description,
    };

    this.items[index] = updated;

    // Clients receive: patches = [{ op: "replace", path: "/items/N", value: updated }]
    return updated;
  }

  /**
   * Delete an item from the list
   * Emits remove patch that shifts remaining items
   */
  async delete(id: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;

    this.items.splice(index, 1);

    // Clients receive: patches = [{ op: "remove", path: "/items/N" }]
    // ViewportAwareProxy automatically re-indexes remaining items
    return true;
  }

  /**
   * Clear all items
   * In real app, would clear from database
   */
  async clear(): Promise<void> {
    this.items = [];
  }

  /**
   * Get current total count
   */
  count(): number {
    return this.items.length;
  }

  /**
   * Generate sample data for demonstration
   */
  private _generateSampleData(): void {
    const titles = [
      'Learn TypeScript',
      'Build MCP Apps',
      'Master Photon',
      'Implement Pagination',
      'Design UI Components',
      'Write Tests',
      'Deploy to Production',
      'Monitor Performance',
      'Optimize Database',
      'Secure API',
    ];

    const descriptions = [
      'Deep dive into TypeScript and type safety',
      'Create Model Context Protocol applications',
      'Build powerful photon-based tools',
      'Implement viewport-aware infinite scrolling',
      'Design reusable component systems',
      'Write comprehensive test suites',
      'Deploy applications to production',
      'Monitor and optimize performance',
      'Optimize database queries',
      'Implement security best practices',
    ];

    for (let i = 0; i < 100; i++) {
      this.items.push({
        id: `item-${i}`,
        title: `${titles[i % titles.length]} #${Math.floor(i / titles.length) + 1}`,
        description: descriptions[i % descriptions.length],
        createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      });
    }
  }
}

/**
 * USAGE EXAMPLE IN BEAM UI:
 *
 * 1. User navigates to the photon
 * 2. Initial response returns:
 *    {\n *      items: [...first 20 items...],
 *      _pagination: { totalCount: 100, start: 0, end: 20, hasMore: true }
 *    }
 *
 * 3. Framework creates ViewportAwareProxy:
 *    - Wraps items property with proxy
 *    - Initializes with _pagination metadata
 *    - Sets up IntersectionObserver on result container
 *
 * 4. User scrolls (viewport changes):
 *    - IntersectionObserver detects items leaving/entering viewport
 *    - ViewportManager calls proxy.setViewport(30, 50)
 *    - ViewportAwareProxy calculates buffer: 30-5=25 to 50+5=55
 *    - Auto-fetches missing range [20, 25] and [50, 55]
 *    - Updates cache, emits 'fetched' event
 *    - Result viewer re-renders with new items
 *
 * 5. Another client calls list.add('New Item', 'Description'):
 *    - Server broadcasts state-changed with:
 *      { instance: "paginatedList", patches: [{ op: "add", path: "/items/0", value: {...} }] }
 *    - First client's ViewportAwareProxy receives event
 *    - Applies patch: shifts items, updates indices, increments totalCount
 *    - Emits 'patched' event
 *    - Result viewer updates to show new item
 *
 * 6. ViewportAwareProxy intelligently handles patches:
 *    - If patch is outside viewport: updates cache only
 *    - If patch is within viewport: updates cache + triggers UI render
 *    - Buffer items are updated but not shown unless viewport expands
 *
 * PAGINATION METADATA FORMAT:
 *
 * All paginated responses must include _pagination object:
 * {
 *   items: Array<T>,
 *   _pagination: {
 *     totalCount: number,    // Total items available across all pages
 *     start: number,         // Start index of current items (inclusive)
 *     end: number,           // End index of current items (exclusive)
 *     hasMore: boolean,      // Whether more items exist beyond current end
 *     hasMoreBefore?: boolean // Optional: whether items exist before current start
 *   }
 * }
 *
 * ViewportAwareProxy uses this metadata to:
 * - Know total dataset size for cache sizing
 * - Track which ranges are cached
 * - Determine if more fetches are needed
 * - Handle edge cases (first page, last page)
 */
