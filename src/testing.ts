/**
 * Photon Testing Utilities
 *
 * Helpers for writing tests in photons
 *
 * Usage in photon:
 *   import { mock, expect } from '@portel/photon/testing';
 */

/**
 * Mock a method on an object, returns a restore function
 *
 * @example
 * ```typescript
 * async testWithMock() {
 *   const restore = mock(this, 'fetchData', async () => ({ data: 'mocked' }));
 *   const result = await this.process();
 *   restore();
 *   return { passed: result.data === 'mocked' };
 * }
 * ```
 */
export function mock<T extends object, K extends keyof T>(
  obj: T,
  method: K,
  implementation: T[K]
): () => void {
  const original = obj[method];
  obj[method] = implementation;
  return () => {
    obj[method] = original;
  };
}

/**
 * Create a mock function that tracks calls
 *
 * @example
 * ```typescript
 * const mockFn = fn(() => 'mocked');
 * mockFn('arg1', 'arg2');
 * console.log(mockFn.calls); // [['arg1', 'arg2']]
 * console.log(mockFn.callCount); // 1
 * ```
 */
export function fn<T extends (...args: any[]) => any>(
  implementation?: T
): T & { calls: Parameters<T>[]; callCount: number; reset: () => void } {
  const calls: Parameters<T>[] = [];

  const mockFn = ((...args: Parameters<T>) => {
    calls.push(args);
    return implementation?.(...args);
  }) as T & { calls: Parameters<T>[]; callCount: number; reset: () => void };

  Object.defineProperty(mockFn, 'calls', {
    get: () => calls,
  });

  Object.defineProperty(mockFn, 'callCount', {
    get: () => calls.length,
  });

  mockFn.reset = () => {
    calls.length = 0;
  };

  return mockFn;
}

/**
 * Simple assertion helpers
 */
export const expect = {
  /**
   * Assert two values are equal (===)
   */
  equal<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  /**
   * Assert two values are deeply equal
   */
  deepEqual<T>(actual: T, expected: T, message?: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  },

  /**
   * Assert value is truthy
   */
  truthy(value: any, message?: string): void {
    if (!value) {
      throw new Error(message || `Expected truthy value, got ${value}`);
    }
  },

  /**
   * Assert value is falsy
   */
  falsy(value: any, message?: string): void {
    if (value) {
      throw new Error(message || `Expected falsy value, got ${value}`);
    }
  },

  /**
   * Assert function throws
   */
  async throws(fn: () => Promise<any> | any, message?: string): Promise<void> {
    try {
      await fn();
      throw new Error(message || 'Expected function to throw');
    } catch (e: any) {
      if (e.message === (message || 'Expected function to throw')) {
        throw e;
      }
      // Success - it threw
    }
  },

  /**
   * Assert array contains value
   */
  contains<T>(array: T[], value: T, message?: string): void {
    if (!array.includes(value)) {
      throw new Error(message || `Expected array to contain ${value}`);
    }
  },

  /**
   * Assert value matches regex
   */
  matches(value: string, pattern: RegExp, message?: string): void {
    if (!pattern.test(value)) {
      throw new Error(message || `Expected "${value}" to match ${pattern}`);
    }
  },
};

/**
 * Skip a test with a reason
 *
 * @example
 * ```typescript
 * async testRequiresRedis() {
 *   if (!process.env.REDIS_URL) {
 *     return skip('REDIS_URL not configured');
 *   }
 *   // actual test...
 * }
 * ```
 */
export function skip(reason: string): { skipped: true; reason: string } {
  return { skipped: true, reason };
}

/**
 * Test context for auto-cleanup of mocks
 */
export class TestContext {
  private restoreFns: (() => void)[] = [];

  /**
   * Mock a method with auto-restore on cleanup
   */
  mock<T extends object, K extends keyof T>(obj: T, method: K, implementation: T[K]): void {
    const restore = mock(obj, method, implementation);
    this.restoreFns.push(restore);
  }

  /**
   * Restore all mocks
   */
  cleanup(): void {
    for (const restore of this.restoreFns) {
      restore();
    }
    this.restoreFns = [];
  }
}
