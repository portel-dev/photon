/**
 * SmartFetcher - Intelligent data fetching based on viewport and state changes
 *
 * Listens to viewport changes and JSON Patch state updates, decides what data
 * ranges need to be fetched, and makes optimized requests to the server.
 */

import { ViewportManager, ViewportChangeEvent, VisibleRange } from './viewport-manager.js';

export interface SmartFetcherConfig {
  viewportManager: ViewportManager;
  photonInstance: any;
  pageSize?: number;
  maxCacheItems?: number;
  debug?: boolean;
}

export interface FetchRequest {
  start: number;
  limit: number;
  timestamp?: number;
}

/**
 * Tracks fetched ranges to avoid duplicate requests
 */
class RangeCache {
  private ranges: Array<{ start: number; end: number }> = [];
  private maxItems: number;
  private currentItems: number = 0;

  constructor(maxItems: number = 100_000) {
    this.maxItems = maxItems;
  }

  /**
   * Check if range is already cached
   */
  has(start: number, end: number): boolean {
    return this.ranges.some((range) => range.start <= start && range.end >= end);
  }

  /**
   * Get uncached ranges needed to cover [start, end)
   */
  getUncachedRanges(start: number, end: number): Array<{ start: number; end: number }> {
    if (this.has(start, end)) {
      return [];
    }

    const uncached: Array<{ start: number; end: number }> = [];
    let current = start;

    for (const range of this.ranges) {
      if (range.start > current) {
        uncached.push({ start: current, end: Math.min(range.start, end) });
        current = range.end;
      }
      if (current >= end) {
        break;
      }
    }

    if (current < end) {
      uncached.push({ start: current, end });
    }

    return uncached;
  }

  /**
   * Mark range as cached
   */
  add(start: number, end: number) {
    const items = end - start;
    this.currentItems += items;

    // Add to ranges, merging adjacent ranges
    this.ranges.push({ start, end });
    this.ranges.sort((a, b) => a.start - b.start);
    this.mergeOverlapping();

    // Evict old ranges if we exceed max items
    if (this.currentItems > this.maxItems) {
      this.evictOldest();
    }
  }

  /**
   * Merge overlapping ranges
   */
  private mergeOverlapping() {
    const merged: Array<{ start: number; end: number }> = [];

    for (const range of this.ranges) {
      if (merged.length === 0) {
        merged.push(range);
      } else {
        const last = merged[merged.length - 1];
        if (range.start <= last.end) {
          // Overlapping - merge
          last.end = Math.max(last.end, range.end);
        } else {
          // No overlap - add new range
          merged.push(range);
        }
      }
    }

    this.ranges = merged;
  }

  /**
   * Evict oldest ranges to stay under max items
   */
  private evictOldest() {
    while (this.currentItems > this.maxItems && this.ranges.length > 0) {
      const removed = this.ranges.shift();
      if (removed) {
        this.currentItems -= removed.end - removed.start;
      }
    }
  }

  clear() {
    this.ranges = [];
    this.currentItems = 0;
  }
}

/**
 * SmartFetcher coordinates viewport tracking with intelligent data loading
 */
export class SmartFetcher {
  private viewportManager: ViewportManager;
  private photonInstance: any;
  private pageSize: number;
  private cache: RangeCache;
  private debug: boolean;

  private pendingFetch: Promise<void> | null = null;
  private lastFetchTime: number = 0;
  private fetchDebounceMs: number = 100;

  private viewportCallback: (event: ViewportChangeEvent) => void;

  constructor(config: SmartFetcherConfig) {
    this.viewportManager = config.viewportManager;
    this.photonInstance = config.photonInstance;
    this.pageSize = config.pageSize ?? this.viewportManager.getPageSize();
    this.cache = new RangeCache(config.maxCacheItems ?? 100_000);
    this.debug = config.debug ?? false;

    this.viewportCallback = (event) => void this.onViewportChange(event);
    this.viewportManager.onChange(this.viewportCallback);

    this.log('SmartFetcher initialized', { pageSize: this.pageSize });
  }

  /**
   * Handle viewport change - determine if fetching is needed
   */
  private async onViewportChange(event: ViewportChangeEvent) {
    const { bufferRange } = event;

    // Check if we need to fetch for the buffer range
    const uncachedRanges = this.cache.getUncachedRanges(bufferRange.start, bufferRange.end);

    if (uncachedRanges.length > 0) {
      // Debounce fetches to avoid hammering server
      if (Date.now() - this.lastFetchTime > this.fetchDebounceMs) {
        this.log('Viewport change - fetching uncached ranges', uncachedRanges);
        await this.fetchRanges(uncachedRanges, (start, limit) =>
          this.photonInstance.list(start, limit)
        );
      }
    }
  }

  /**
   * Fetch one or more ranges (public for external use)
   */
  async fetchRanges(
    ranges: Array<{ start: number; end: number }>,
    fetcher?: (start: number, limit: number) => Promise<any[]>
  ): Promise<void> {
    if (this.pendingFetch) {
      await this.pendingFetch;
    }

    this.lastFetchTime = Date.now();

    // Use provided fetcher or fall back to instance method
    const fetchFn = fetcher || ((start, limit) => this.photonInstance.list(start, limit));

    // Batch adjacent ranges to reduce request count
    const batchedRanges = this.batchRanges(ranges);

    this.pendingFetch = (async () => {
      for (const range of batchedRanges) {
        try {
          this.log('Fetching range', range);
          const items = await fetchFn(range.start, range.end - range.start);
          this.cache.add(range.start, range.end);
          this.log('Fetched range', { start: range.start, count: items.length });
        } catch (error) {
          console.error(`Failed to fetch range [${range.start}, ${range.end}):`, error);
        }
      }
    })();

    await this.pendingFetch;
    this.pendingFetch = null;
  }

  /**
   * Batch adjacent ranges to reduce request count
   */
  private batchRanges(
    ranges: Array<{ start: number; end: number }>
  ): Array<{ start: number; end: number }> {
    if (ranges.length === 0) {
      return [];
    }

    ranges.sort((a, b) => a.start - b.start);
    const batched: Array<{ start: number; end: number }> = [];
    let current = ranges[0];

    for (let i = 1; i < ranges.length; i++) {
      const next = ranges[i];
      const gap = next.start - current.end;

      // Batch if gap is small (less than 1 page)
      if (gap < this.pageSize) {
        current.end = next.end;
      } else {
        batched.push(current);
        current = next;
      }
    }

    batched.push(current);
    return batched;
  }

  /**
   * Get optimal page size based on device
   */
  getOptimalPageSize(): number {
    // Mobile: smaller pages for faster rendering
    if (window.innerWidth < 600) {
      return 10;
    }
    // Tablet: medium pages
    if (window.innerWidth < 1024) {
      return 25;
    }
    // Desktop: larger pages
    return 50;
  }

  /**
   * Fetch a specific range
   */
  async fetch(start: number, limit: number): Promise<any[]> {
    const end = start + limit;

    if (this.cache.has(start, end)) {
      this.log('Range already cached', { start, end });
      return []; // Already have it
    }

    const uncached = this.cache.getUncachedRanges(start, end);
    await this.fetchRanges(uncached, (s, l) => this.photonInstance.list(s, l));

    return [];
  }

  /**
   * Get all currently cached ranges
   */
  getCachedRanges(): Array<{ start: number; end: number }> {
    return this.cache['ranges'] || [];
  }

  /**
   * Get current cache size in items
   */
  getCacheSize(): number {
    return this.cache['currentItems'] || 0;
  }

  /**
   * Clear cache (useful for refresh)
   */
  clearCache() {
    this.cache.clear();
    this.log('Cache cleared');
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.viewportManager.offChange(this.viewportCallback);
    this.cache.clear();
    this.log('SmartFetcher destroyed');
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: any) {
    if (this.debug) {
      console.log(`[SmartFetcher] ${message}`, data);
    }
  }
}
