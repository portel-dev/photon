/**
 * Viewport Manager for Automatic Scroll Detection
 *
 * Automatically tracks which items are visible on screen using IntersectionObserver.
 * Reports viewport changes to ViewportAwareProxy for smart fetching.
 *
 * Usage:
 * ```typescript
 * const viewportMgr = new ViewportManager(proxy, {
 *   container: listElement,
 *   itemSelector: '.list-item',
 *   pageSize: 20,
 *   bufferSize: 5
 * });
 * viewportMgr.start();
 * ```
 */

import type { ViewportAwareProxy } from './viewport-aware-proxy.js';

export interface ViewportManagerOptions {
  container: HTMLElement;
  itemSelector: string;
  pageSize?: number;
  bufferSize?: number;
  threshold?: number | number[];
  rootMargin?: string;
}

/**
 * Manages viewport tracking using IntersectionObserver
 * Automatically updates ViewportAwareProxy with visible range
 */
export class ViewportManager {
  private _proxy: ViewportAwareProxy;
  private _options: Required<ViewportManagerOptions>;
  private _observer: IntersectionObserver | null = null;
  private _visibleItems: Set<number> = new Set();
  private _allItems: HTMLElement[] = [];
  private _updateTimeout: ReturnType<typeof setTimeout> | null = null;
  private _isActive: boolean = false;

  constructor(proxy: ViewportAwareProxy, options: ViewportManagerOptions) {
    this._proxy = proxy;
    this._options = {
      pageSize: options.pageSize ?? 20,
      bufferSize: options.bufferSize ?? 5,
      threshold: options.threshold ?? 0.1,
      rootMargin: options.rootMargin ?? '50px',
      ...options,
    };
  }

  /**
   * Start observing viewport changes
   */
  start(): void {
    if (this._isActive) return;

    this._isActive = true;
    this._collectItems();
    this._createObserver();
    this._observeItems();

    // Initial viewport update
    void this._updateViewport();
  }

  /**
   * Stop observing viewport changes
   */
  stop(): void {
    if (!this._isActive) return;

    this._isActive = false;
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._updateTimeout) {
      clearTimeout(this._updateTimeout);
      this._updateTimeout = null;
    }
    this._visibleItems.clear();
    this._allItems = [];
  }

  /**
   * Get current visible range
   */
  getVisibleRange(): { start: number; end: number } | null {
    if (this._visibleItems.size === 0) {
      return null;
    }

    const indices = Array.from(this._visibleItems).sort((a, b) => a - b);
    const start = indices[0];
    const end = indices[indices.length - 1] + 1;

    return { start, end };
  }

  /**
   * Collect all items in container
   */
  private _collectItems(): void {
    const items = this._options.container.querySelectorAll(this._options.itemSelector);

    this._allItems = Array.from(items).filter((el): el is HTMLElement => el instanceof HTMLElement);
  }

  /**
   * Create IntersectionObserver for scroll tracking
   */
  private _createObserver(): void {
    this._observer = new IntersectionObserver((entries) => this._onIntersection(entries), {
      root: null,
      threshold: this._options.threshold,
      rootMargin: this._options.rootMargin,
    });
  }

  /**
   * Observe all items in list
   */
  private _observeItems(): void {
    if (!this._observer) return;

    for (const item of this._allItems) {
      this._observer.observe(item);
    }
  }

  /**
   * Handle intersection changes
   */
  private _onIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const index = this._getItemIndex(entry.target as HTMLElement);
      if (index < 0) continue;

      if (entry.isIntersecting) {
        this._visibleItems.add(index);
      } else {
        this._visibleItems.delete(index);
      }
    }

    // Debounce viewport updates
    if (this._updateTimeout) {
      clearTimeout(this._updateTimeout);
    }

    this._updateTimeout = setTimeout(() => {
      void this._updateViewport();
    }, 50);
  }

  /**
   * Get index of item element
   */
  private _getItemIndex(element: HTMLElement): number {
    const indexAttr = element.getAttribute('data-index');
    if (indexAttr) {
      return parseInt(indexAttr, 10);
    }

    // Fallback: find by position in list
    return this._allItems.indexOf(element);
  }

  /**
   * Update viewport in proxy based on visible items
   */
  private async _updateViewport(): Promise<void> {
    const range = this.getVisibleRange();

    if (!range) {
      // No visible items, use default
      await this._proxy.setViewport(0, this._options.pageSize);
      return;
    }

    // Expand viewport with buffer
    const start = Math.max(0, range.start - this._options.bufferSize);
    const end = range.end + this._options.bufferSize;

    await this._proxy.setViewport(start, end);
  }

  /**
   * Check if manager is active
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Get collected items count
   */
  get itemCount(): number {
    return this._allItems.length;
  }

  /**
   * Get visible items count
   */
  get visibleCount(): number {
    return this._visibleItems.size;
  }
}

/**
 * Auto-create and attach viewport manager to a proxy
 * Useful for quick initialization with standard settings
 */
export function attachViewportManager(
  proxy: ViewportAwareProxy,
  containerSelector: string,
  itemSelector: string = '[data-index]',
  options?: Partial<ViewportManagerOptions>
): ViewportManager | null {
  const container = document.querySelector(containerSelector) as HTMLElement;
  if (!container) {
    console.warn(`Container not found: ${containerSelector}`);
    return null;
  }

  const manager = new ViewportManager(proxy, {
    container,
    itemSelector,
    ...options,
  });

  manager.start();
  return manager;
}

/**
 * Detect client type and return appropriate page size
 */
export function getPageSizeForClient(): number {
  // Mobile
  if (navigator.devicePixelRatio < 2 && window.innerWidth < 768) {
    return 10;
  }

  // Tablet
  if (window.innerWidth < 1024) {
    return 50;
  }

  // Desktop
  return 100;
}

/**
 * Detect if running on mobile
 */
export function isMobileDevice(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  return /mobile|android|iphone|ipad|phone/i.test(userAgent);
}
