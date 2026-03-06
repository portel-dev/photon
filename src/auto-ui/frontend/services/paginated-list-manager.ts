/**
 * Phase 5c: Paginated List Manager
 *
 * Integrates ViewportManager and SmartFetcher with PhotonInstanceProxy
 * to provide complete viewport-aware pagination for large datasets.
 *
 * Responsibilities:
 * - Track visible item range via ViewportManager
 * - Trigger smart fetching via SmartFetcher
 * - Apply patches to maintain state in correct order
 * - Manage visible data cache
 * - Handle multi-client synchronization
 */

import { PhotonInstanceProxy } from './photon-instance-manager.js';
import { ViewportManager } from './viewport-manager.js';
import { SmartFetcher, type FetchRequest } from './smart-fetcher.js';

export interface PaginatedListManagerOptions {
  /** The photon instance proxy managing state */
  instance: PhotonInstanceProxy;

  /** Property name holding paginated items (e.g., 'items') */
  listProperty: string;

  /** Container element for viewport tracking */
  containerElement: HTMLElement;

  /** Function to fetch data from photon */
  fetcher: (start: number, limit: number) => Promise<any[]>;

  /** Called when viewport changes and new data is needed */
  onFetchNeeded?: (range: { start: number; end: number }) => void;
}

/**
 * Manages paginated list display with viewport-aware smart fetching
 */
export class PaginatedListManager {
  private instance: PhotonInstanceProxy;
  private listProperty: string;
  private viewportManager: ViewportManager;
  private smartFetcher: SmartFetcher;
  private fetcher: (start: number, limit: number) => Promise<any[]>;
  private onFetchNeeded?: (range: { start: number; end: number }) => void;

  /** Track patches applied to prevent re-application */
  private appliedPatchIds: Set<string> = new Set();

  /** Queue patches to ensure ordering */
  private patchQueue: any[] = [];
  private processingPatches = false;

  constructor(options: PaginatedListManagerOptions) {
    this.instance = options.instance;
    this.listProperty = options.listProperty;
    this.fetcher = options.fetcher;
    this.onFetchNeeded = options.onFetchNeeded;

    // Determine optimal page size based on device
    const pageSize = this.getOptimalPageSize();

    // Initialize viewport tracking
    this.viewportManager = new ViewportManager({
      element: options.containerElement,
      pageSize,
      paddingAbove: pageSize,
      paddingBelow: pageSize * 2,
      debug: false,
    });

    // Initialize smart fetching
    this.smartFetcher = new SmartFetcher({
      viewportManager: this.viewportManager,
      photonInstance: this.instance,
      pageSize,
      debug: false,
    });

    // Listen for viewport changes
    this.viewportManager.onChange((range) => {
      void this.handleViewportChange(range);
    });

    // Listen for patches from server
    this.instance.on('state-changed', (patches) => {
      this.handlePatchesReceived(patches);
    });
  }

  /**
   * Handle viewport changes - trigger smart fetching
   */
  private async handleViewportChange(range: { start: number; end: number }): Promise<void> {
    const bufferRange = this.viewportManager.getBufferRange(
      (this.instance.state[this.listProperty] || []).length
    );

    // Notify listener
    if (this.onFetchNeeded) {
      this.onFetchNeeded(bufferRange);
    }

    // Trigger smart fetch for uncached ranges
    const items = this.instance.state[this.listProperty] || [];
    const fetchRequests: FetchRequest[] = [];

    // Check if buffer range needs fetching
    if (bufferRange.start >= 0 && bufferRange.end <= items.length) {
      // Data already cached, no fetch needed
      return;
    }

    // Request fetch for buffer range
    fetchRequests.push({
      start: bufferRange.start,
      limit: bufferRange.end - bufferRange.start,
    });

    if (fetchRequests.length > 0) {
      await this.smartFetcher.fetchRanges(fetchRequests, this.fetcher);
    }
  }

  /**
   * Handle patches received from server
   * Apply in correct order and update cache
   */
  private handlePatchesReceived(patches: any[]): void {
    this.patchQueue.push(...patches);

    if (!this.processingPatches) {
      void this.processPatchQueue();
    }
  }

  /**
   * Process queued patches in order
   */
  private async processPatchQueue(): Promise<void> {
    if (this.processingPatches || this.patchQueue.length === 0) {
      return;
    }

    this.processingPatches = true;

    try {
      while (this.patchQueue.length > 0) {
        const patch = this.patchQueue.shift()!;

        // Generate patch ID for deduplication
        const patchId = this.generatePatchId(patch);
        if (this.appliedPatchIds.has(patchId)) {
          continue; // Skip already applied patches
        }

        // Apply patch to state
        this.applyPatchToCache(patch);
        this.appliedPatchIds.add(patchId);

        // Check if we need new data after this patch
        const visibleRange = this.viewportManager.getVisibleRange();
        const bufferRange = this.viewportManager.getBufferRange(
          (this.instance.state[this.listProperty] || []).length
        );

        const items = this.instance.state[this.listProperty] || [];
        if (bufferRange.end > items.length) {
          // Need more data
          await this.smartFetcher.fetchRanges(
            [{ start: items.length, limit: bufferRange.end - items.length }],
            this.fetcher
          );
        }

        // Small delay to allow UI to update
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.processingPatches = false;
    }
  }

  /**
   * Apply a single patch to the cache
   */
  private applyPatchToCache(patch: any): void {
    const { op, path, value } = patch;

    // Only process patches for our list property
    if (!path.includes(`/${this.listProperty}`)) {
      return;
    }

    const items = this.instance.state[this.listProperty] || [];

    try {
      switch (op) {
        case 'add': {
          // Extract index from path like '/items/5'
          const match = path.match(new RegExp(`/${this.listProperty}/(\\d+)`));
          if (match) {
            const index = parseInt(match[1], 10);
            items.splice(index, 0, value);
          } else {
            items.push(value);
          }
          break;
        }

        case 'remove': {
          const match = path.match(new RegExp(`/${this.listProperty}/(\\d+)`));
          if (match) {
            const index = parseInt(match[1], 10);
            items.splice(index, 1);
          }
          break;
        }

        case 'replace': {
          const match = path.match(new RegExp(`/${this.listProperty}/(\\d+)`));
          if (match) {
            const index = parseInt(match[1], 10);
            items[index] = value;
          }
          break;
        }
      }
    } catch (error) {
      console.error('Failed to apply patch to cache', { patch, error });
    }
  }

  /**
   * Generate a unique ID for a patch (for deduplication)
   */
  private generatePatchId(patch: any): string {
    return `${patch.op}:${patch.path}:${JSON.stringify(patch.value || patch.from)}`;
  }

  /**
   * Determine optimal page size based on device
   */
  private getOptimalPageSize(): number {
    // Mobile: smaller pages for faster rendering
    if (typeof window !== 'undefined' && window.innerWidth < 600) {
      return 10;
    }
    // Tablet: medium pages
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      return 25;
    }
    // Desktop: larger pages (or default in non-browser)
    return 50;
  }

  /**
   * Get the visible range of items
   */
  getVisibleRange(): { start: number; end: number } {
    return this.viewportManager.getVisibleRange();
  }

  /**
   * Get the buffer range (visible + padding)
   */
  getBufferRange(): { start: number; end: number } {
    return this.viewportManager.getBufferRange(
      (this.instance.state[this.listProperty] || []).length
    );
  }

  /**
   * Clear cache to force refetch
   */
  clearCache(): void {
    this.smartFetcher.clearCache();
    this.appliedPatchIds.clear();
    this.patchQueue = [];
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cachedRanges: Array<{ start: number; end: number }>;
    cacheSize: number;
    appliedPatches: number;
  } {
    return {
      cachedRanges: this.smartFetcher.getCachedRanges(),
      cacheSize: this.smartFetcher.getCacheSize(),
      appliedPatches: this.appliedPatchIds.size,
    };
  }

  /**
   * Cleanup on unmount
   */
  destroy(): void {
    this.viewportManager.destroy();
    this.smartFetcher.clearCache();
    this.instance.off('state-changed', () => {});
  }
}

/**
 * Factory function to create paginated list manager
 */
export function createPaginatedListManager(
  options: PaginatedListManagerOptions
): PaginatedListManager {
  return new PaginatedListManager(options);
}
