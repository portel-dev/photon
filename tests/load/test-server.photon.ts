/**
 * Test MCP for Load Testing
 *
 * Provides various test endpoints with different characteristics
 */

export default class LoadTest {
  /**
   * Fast operation - returns immediately
   * @param value Test value
   */
  async fast(params: { value: string }) {
    return { result: params.value, timestamp: Date.now() };
  }

  /**
   * Slow operation - simulates processing time
   * @param delay Delay in milliseconds
   */
  async slow(params: { delay: number }) {
    await new Promise(resolve => setTimeout(resolve, params.delay));
    return { result: 'completed', delay: params.delay };
  }

  /**
   * Memory intensive operation
   * @param size Size of array to create (in thousands)
   */
  async memory(params: { size: number }) {
    const array = new Array(params.size * 1000).fill(0).map((_, i) => ({
      id: i,
      data: `item-${i}`,
      timestamp: Date.now(),
    }));
    return { count: array.length, sample: array.slice(0, 5) };
  }

  /**
   * CPU intensive operation
   * @param iterations Number of iterations
   */
  async cpu(params: { iterations: number }) {
    let result = 0;
    for (let i = 0; i < params.iterations; i++) {
      result += Math.sqrt(i) * Math.sin(i);
    }
    return { result, iterations: params.iterations };
  }

  /**
   * Large response operation
   * @param size Size of response (KB)
   */
  async largeResponse(params: { size: number }) {
    const data = 'x'.repeat(params.size * 1024);
    return { size: data.length, preview: data.substring(0, 100) };
  }

  /**
   * Complex schema operation with nested objects
   * @param data Complex nested data
   */
  async complexSchema(params: {
    data: {
      user: { name: string; email: string; age: number };
      settings: { theme: string; notifications: boolean };
      tags: string[];
    }
  }) {
    return {
      processed: true,
      user: params.data.user.name,
      tagCount: params.data.tags.length
    };
  }

  /**
   * Error simulation
   * @param shouldFail Whether to throw an error
   */
  async error(params: { shouldFail: boolean }) {
    if (params.shouldFail) {
      throw new Error('Simulated error for testing');
    }
    return { result: 'success' };
  }
}
