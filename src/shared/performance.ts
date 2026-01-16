/**
 * Performance monitoring utilities
 * Provides timing, metrics collection, and performance insights
 */

import { Logger } from './logger.js';

export interface TimingMetric {
  name: string;
  startTime: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export class PerformanceMonitor {
  private timings: Map<string, TimingMetric> = new Map();
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Start timing an operation
   */
  start(name: string, metadata?: Record<string, unknown>): void {
    this.timings.set(name, {
      name,
      startTime: Date.now(),
      metadata,
    });
  }

  /**
   * End timing an operation and return duration
   */
  end(name: string): number | undefined {
    const metric = this.timings.get(name);
    if (!metric) {
      this.logger?.warn(`No timing found for: ${name}`);
      return undefined;
    }

    const duration = Date.now() - metric.startTime;
    metric.duration = duration;

    this.logger?.debug(`⏱️  ${name}: ${duration}ms`, metric.metadata);

    return duration;
  }

  /**
   * Measure a synchronous function
   */
  measure<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    this.start(name, metadata);
    try {
      const result = fn();
      return result;
    } finally {
      this.end(name);
    }
  }

  /**
   * Measure an async function
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    this.start(name, metadata);
    try {
      const result = await fn();
      return result;
    } finally {
      this.end(name);
    }
  }

  /**
   * Get all timings
   */
  getTimings(): TimingMetric[] {
    return Array.from(this.timings.values()).filter((m) => m.duration !== undefined);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    count: number;
    average: number;
    slowest: TimingMetric | undefined;
  } {
    const completed = this.getTimings();
    const total = completed.reduce((sum, m) => sum + (m.duration ?? 0), 0);
    const count = completed.length;
    const average = count > 0 ? total / count : 0;
    const slowest = completed.reduce(
      (max, m) => (!max || (m.duration ?? 0) > (max.duration ?? 0) ? m : max),
      undefined as TimingMetric | undefined
    );

    return { total, count, average, slowest };
  }

  /**
   * Clear all timings
   */
  clear(): void {
    this.timings.clear();
  }
}

/**
 * Simple memoization decorator for functions
 */
export function memoize<T extends (...args: never[]) => unknown>(
  fn: T,
  options: { ttl?: number; maxSize?: number } = {}
): T {
  const cache = new Map<string, { value: ReturnType<T>; timestamp: number }>();
  const { ttl = Infinity, maxSize = 100 } = options;

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = JSON.stringify(args);
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.value;
    }

    const value = fn(...args) as ReturnType<T>;

    // Evict oldest if at capacity
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, { value, timestamp: Date.now() });
    return value;
  }) as T;
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delayMs);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delayMs) {
      lastCall = now;
      fn(...args);
    }
  };
}
