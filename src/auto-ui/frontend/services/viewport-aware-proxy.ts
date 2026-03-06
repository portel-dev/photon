/**
 * Viewport-Aware Proxy for Smart Client-Side Pagination
 *
 * Provides array-like interface for large datasets with automatic pagination:
 * - Tracks viewport (what user sees on screen)
 * - Auto-fetches missing data ranges
 * - Caches fetched items intelligently
 * - Works with standard MCP protocol
 * - Transparent to any MCP client implementation
 *
 * Server returns paginated data with metadata:
 * {
 *   items: [...],
 *   _pagination: { totalCount, start, end, hasMore, hasMoreBefore }
 * }
 */

import type { MCPClientService } from './mcp-client.js';

export interface PaginationMetadata {
  totalCount: number;
  start: number;
  end: number;
  hasMore: boolean;
  hasMoreBefore?: boolean;
}

export interface ViewportRange {
  start: number;
  end: number;
}

export interface FetchOptions {
  pageSize?: number;
  bufferSize?: number;
  maxCacheSize?: number;
}

/**
 * Viewport-aware proxy for paginated data
 * Provides array-like interface with automatic smart fetching
 */
export class ViewportAwareProxy {
  private _photonName: string;
  private _methodName: string;
  private _mcpClient: MCPClientService;
  private _fetchOptions: Required<FetchOptions>;

  // Cache management
  private _cache: Map<number, any> = new Map();
  private _viewport: ViewportRange = { start: 0, end: 20 };
  private _pendingRanges: Set<string> = new Set();
  private _pagination: PaginationMetadata = {
    totalCount: 0,
    start: 0,
    end: 0,
    hasMore: false,
  };

  // Event listeners
  private _listeners: Map<string, Set<(data?: unknown) => void>> = new Map();

  constructor(
    photonName: string,
    methodName: string,
    mcpClient: MCPClientService,
    options: FetchOptions = {}
  ) {
    this._photonName = photonName;
    this._methodName = methodName;
    this._mcpClient = mcpClient;
    this._fetchOptions = {
      pageSize: options.pageSize ?? 20,
      bufferSize: options.bufferSize ?? 5,
      maxCacheSize: options.maxCacheSize ?? 1000,
    };
  }

  /**
   * Initialize with paginated response from server
   * Server should return: { items: [...], _pagination: {...} }
   */
  initializeWithResponse(response: any): void {
    if (!response || typeof response !== 'object') {
      return;
    }

    const { items = [], _pagination } = response;

    if (_pagination) {
      this._pagination = _pagination;

      // Cache the initial items
      items.forEach((item: any, offset: number) => {
        this._cache.set(_pagination.start + offset, item);
      });

      // Emit initialized event
      this._emit('initialized', { pagination: this._pagination });
    }
  }

  /**
   * Set visible viewport (what user sees on screen)
   * Automatically fetches data for this range + buffer
   */
  async setViewport(start: number, end: number): Promise<void> {
    this._viewport = { start, end };

    // Calculate ranges to fetch with buffer
    const bufferedStart = Math.max(0, start - this._fetchOptions.bufferSize);
    const bufferedEnd = Math.min(this._pagination.totalCount, end + this._fetchOptions.bufferSize);

    // Find missing ranges
    const missingRanges = this._findMissingRanges(bufferedStart, bufferedEnd);

    // Fetch all missing ranges in parallel
    await Promise.all(
      missingRanges.map((range) =>
        this._fetchRange(range.start, range.end).catch((err) => {
          console.error(`Failed to fetch range [${range.start}, ${range.end}]`, err);
        })
      )
    );
  }

  /**
   * Get items in current viewport (array-like interface)
   */
  get items(): unknown[] {
    const items: unknown[] = [];
    for (let i = this._viewport.start; i < this._viewport.end; i++) {
      if (this._cache.has(i)) {
        items.push(this._cache.get(i));
      }
    }
    return items;
  }

  /**
   * Get item by index
   */
  getItem(index: number): unknown {
    return this._cache.get(index);
  }

  /**
   * Get total count of items (if available)
   */
  get totalCount(): number {
    return this._pagination.totalCount;
  }

  /**
   * Get current pagination state
   */
  get pagination(): Readonly<PaginationMetadata> {
    return { ...this._pagination };
  }

  /**
   * Get current viewport
   */
  get viewport(): Readonly<ViewportRange> {
    return { ...this._viewport };
  }

  /**
   * Get cache size (for debugging)
   */
  get cacheSize(): number {
    return this._cache.size;
  }

  /**
   * Check if a range is cached
   */
  isCached(start: number, end: number): boolean {
    for (let i = start; i < end; i++) {
      if (!this._cache.has(i)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Subscribe to events
   */
  on(event: string, callback: (data?: unknown) => void): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
  }

  /**
   * Unsubscribe from events
   */
  off(event: string, callback: (data?: unknown) => void): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this._cache.clear();
    this._emit('cache-cleared');
  }

  /**
   * Apply patches from state-changed events
   * Updates cache with new/modified items
   */
  applyPatches(patches: any[]): void {
    for (const patch of patches) {
      this._applyPatch(patch);
    }
    this._emit('patched', { patches });
  }

  /**
   * Find which ranges need to be fetched
   */
  private _findMissingRanges(start: number, end: number): ViewportRange[] {
    const missing: number[] = [];

    for (let i = start; i < end; i++) {
      if (!this._cache.has(i)) {
        missing.push(i);
      }
    }

    // Group into contiguous ranges
    const ranges: ViewportRange[] = [];
    if (missing.length === 0) return ranges;

    let rangeStart = missing[0];
    let rangeEnd = missing[0];

    for (let i = 1; i < missing.length; i++) {
      if (missing[i] === rangeEnd + 1) {
        rangeEnd = missing[i];
      } else {
        ranges.push({ start: rangeStart, end: rangeEnd + 1 });
        rangeStart = missing[i];
        rangeEnd = missing[i];
      }
    }

    ranges.push({ start: rangeStart, end: rangeEnd + 1 });

    return ranges;
  }

  /**
   * Fetch a range of items via MCP
   */
  private async _fetchRange(start: number, end: number): Promise<void> {
    const rangeKey = `${start}-${end}`;

    // Prevent duplicate fetches
    if (this._pendingRanges.has(rangeKey)) {
      return;
    }

    this._pendingRanges.add(rangeKey);

    try {
      const toolName = `${this._photonName}/${this._methodName}`;
      const result = await this._mcpClient.callTool(toolName, {
        start,
        limit: Math.min(end - start, this._fetchOptions.pageSize),
      });

      if (result.isError) {
        console.error(`Failed to fetch ${toolName}[${start}:${end}]`, result);
        return;
      }

      const parsed = this._mcpClient.parseToolResult(result);

      // Handle paginated response format
      if (parsed && typeof parsed === 'object') {
        const { items = [], _pagination } = parsed;

        // Update pagination metadata
        if (_pagination) {
          this._pagination = _pagination;
        }

        // Cache items
        items.forEach((item: any, offset: number) => {
          this._cache.set(start + offset, item);
        });

        // Prune cache if too large
        if (this._cache.size > this._fetchOptions.maxCacheSize) {
          this._pruneCache();
        }

        this._emit('fetched', { start, end, itemCount: items.length });
      }
    } finally {
      this._pendingRanges.delete(rangeKey);
    }
  }

  /**
   * Apply a single JSON Patch to cache
   */
  private _applyPatch(patch: unknown): void {
    const { op, path } = patch as Record<string, unknown>;

    // Parse path like "/items/5" → index 5
    const match = path.match(/\/items\/(\d+)/);
    if (!match) return;

    const index = parseInt(match[1], 10);

    switch (op) {
      case 'add': {
        // Shift cache indices
        const newCache = new Map<number, any>();
        for (const [key, value] of this._cache) {
          if (key >= index) {
            newCache.set(key + 1, value);
          } else {
            newCache.set(key, value);
          }
        }
        newCache.set(index, patch.value);
        this._cache = newCache;
        this._pagination.totalCount++;
        break;
      }

      case 'remove': {
        // Shift cache indices
        const newCache = new Map<number, any>();
        for (const [key, value] of this._cache) {
          if (key > index) {
            newCache.set(key - 1, value);
          } else if (key < index) {
            newCache.set(key, value);
          }
        }
        this._cache = newCache;
        this._pagination.totalCount--;
        break;
      }

      case 'replace': {
        this._cache.set(index, patch.value);
        break;
      }
    }
  }

  /**
   * Remove least-recently-used items from cache when it gets too large
   */
  private _pruneCache(): void {
    const toRemove = this._cache.size - this._fetchOptions.maxCacheSize;
    if (toRemove <= 0) return;

    // Keep items near viewport, remove others
    const viewportCenter = this._viewport.start + (this._viewport.end - this._viewport.start) / 2;

    const sortedKeys = Array.from(this._cache.keys()).sort(
      (a, b) => Math.abs(a - viewportCenter) - Math.abs(b - viewportCenter)
    );

    for (let i = 0; i < toRemove && i < sortedKeys.length; i++) {
      this._cache.delete(sortedKeys[i]);
    }
  }

  /**
   * Emit event to listeners
   */
  private _emit(event: string, data?: any): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in ${event} listener:`, err);
        }
      }
    }
  }
}

/**
 * Factory function to create viewport-aware proxy for a photon method
 */
export function createViewportAwareProxy(
  photonName: string,
  methodName: string,
  mcpClient: MCPClientService,
  options?: FetchOptions
): ViewportAwareProxy {
  return new ViewportAwareProxy(photonName, methodName, mcpClient, options);
}
