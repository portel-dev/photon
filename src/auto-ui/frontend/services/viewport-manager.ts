/**
 * ViewportManager - Tracks visible viewport for smart pagination
 *
 * Monitors which items are currently visible on screen using IntersectionObserver.
 * Calculates visible range and maintains padding cushion for smooth scrolling.
 *
 * Used by SmartFetcher to decide when to load more data.
 */

export interface VisibleRange {
  start: number;
  end: number;
}

export interface ViewportConfig {
  element: HTMLElement;
  pageSize: number;
  paddingAbove?: number; // Extra items to keep loaded above visible area
  paddingBelow?: number; // Extra items to keep loaded below visible area
  debug?: boolean;
}

export interface ViewportChangeEvent {
  visibleRange: VisibleRange;
  bufferRange: VisibleRange; // Range to keep in memory (visible + padding)
  scrollDirection: 'up' | 'down' | 'none';
  timestamp: number;
}

/**
 * Utility function to get optimal page size for current client
 */
export function getPageSizeForClient(): number {
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
 * Tracks visible item range using IntersectionObserver
 *
 * Works by:
 * 1. Creating sentinel elements for each item in the list
 * 2. Observing which sentinels are visible
 * 3. Calculating the visible range from first/last visible sentinel
 * 4. Adding padding to determine what data to keep loaded
 */
export class ViewportManager {
  private element: HTMLElement;
  private pageSize: number;
  private paddingAbove: number;
  private paddingBelow: number;
  private debug: boolean;

  private observer: IntersectionObserver | null = null;
  private visibleSentinels = new Set<number>();
  private lastVisibleRange: VisibleRange = { start: 0, end: 0 };
  private lastScrollDirection: 'up' | 'down' | 'none' = 'none';
  private changeCallbacks: ((event: ViewportChangeEvent) => void)[] = [];

  constructor(config: ViewportConfig) {
    this.element = config.element;
    this.pageSize = config.pageSize;
    this.paddingAbove = config.paddingAbove ?? this.pageSize;
    this.paddingBelow = config.paddingBelow ?? this.pageSize * 2;
    this.debug = config.debug ?? false;

    this.log('ViewportManager initialized', {
      pageSize: this.pageSize,
      paddingAbove: this.paddingAbove,
      paddingBelow: this.paddingBelow,
    });
    this.initializeObserver();
  }

  private initializeObserver() {
    const options: IntersectionObserverInit = {
      root: null,
      rootMargin: '100px',
      threshold: 0,
    };

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = this.getSentinelIndex(entry.target);
        if (index !== null) {
          if (entry.isIntersecting) {
            this.visibleSentinels.add(index);
          } else {
            this.visibleSentinels.delete(index);
          }
        }
      }
      this.updateVisibleRange();
    }, options);
  }

  createSentinel(index: number): HTMLElement {
    const sentinel = document.createElement('div');
    sentinel.setAttribute('data-viewport-sentinel', String(index));
    sentinel.style.height = '0px';
    sentinel.style.overflow = 'hidden';
    return sentinel;
  }

  observeSentinel(sentinel: HTMLElement) {
    if (this.observer) {
      this.observer.observe(sentinel);
    }
  }

  unobserveSentinel(sentinel: HTMLElement) {
    if (this.observer) {
      this.observer.unobserve(sentinel);
    }
  }

  private getSentinelIndex(element: Element): number | null {
    const attr = element.getAttribute('data-viewport-sentinel');
    return attr !== null ? parseInt(attr, 10) : null;
  }

  private updateVisibleRange() {
    if (this.visibleSentinels.size === 0) {
      return;
    }

    const indices = Array.from(this.visibleSentinels).sort((a, b) => a - b);
    const visibleStart = indices[0];
    const visibleEnd = indices[indices.length - 1] + 1;

    const direction = this.determineScrollDirection(visibleStart);
    const bufferStart = Math.max(
      0,
      visibleStart - Math.ceil(this.paddingAbove / this.pageSize) * this.pageSize
    );
    const bufferEnd = visibleEnd + Math.ceil(this.paddingBelow / this.pageSize) * this.pageSize;

    const rangeChanged =
      visibleStart !== this.lastVisibleRange.start || visibleEnd !== this.lastVisibleRange.end;

    if (rangeChanged) {
      this.lastVisibleRange = { start: visibleStart, end: visibleEnd };
      this.lastScrollDirection = direction;

      const event: ViewportChangeEvent = {
        visibleRange: { start: visibleStart, end: visibleEnd },
        bufferRange: { start: bufferStart, end: bufferEnd },
        scrollDirection: direction,
        timestamp: Date.now(),
      };

      this.log('Viewport changed', event);

      for (const callback of this.changeCallbacks) {
        callback(event);
      }
    }
  }

  private determineScrollDirection(newStart: number): 'up' | 'down' | 'none' {
    if (newStart < this.lastVisibleRange.start) {
      return 'up';
    } else if (newStart > this.lastVisibleRange.start) {
      return 'down';
    }
    return 'none';
  }

  getVisibleRange(): VisibleRange {
    return this.lastVisibleRange;
  }

  getBufferRange(totalItems: number): VisibleRange {
    const { start, end } = this.lastVisibleRange;
    const bufferStart = Math.max(0, start - this.paddingAbove);
    const bufferEnd = Math.min(totalItems, end + this.paddingBelow);
    return { start: bufferStart, end: bufferEnd };
  }

  getScrollDirection(): 'up' | 'down' | 'none' {
    return this.lastScrollDirection;
  }

  getPageSize(): number {
    return this.pageSize;
  }

  onChange(callback: (event: ViewportChangeEvent) => void) {
    this.changeCallbacks.push(callback);
  }

  offChange(callback: (event: ViewportChangeEvent) => void) {
    this.changeCallbacks = this.changeCallbacks.filter((cb) => cb !== callback);
  }

  setPageSize(newPageSize: number) {
    if (newPageSize !== this.pageSize) {
      this.pageSize = newPageSize;
      this.log('Page size updated', { newPageSize });
      this.updateVisibleRange();
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.changeCallbacks = [];
    this.visibleSentinels.clear();
    this.log('ViewportManager destroyed');
  }

  private log(message: string, data?: any) {
    if (this.debug) {
      console.log(`[ViewportManager] ${message}`, data);
    }
  }
}
