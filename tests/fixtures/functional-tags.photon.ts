/**
 * Test fixture: Functional Tags
 * Every method uses one or more functional JSDoc tags for testing runtime enforcement.
 */

let callCount = 0;

export default class FunctionalTagsTest {
  /**
   * Simple cached method — returns incrementing counter
   * @cached 2s
   */
  async cached() {
    callCount++;
    return { value: callCount };
  }

  /**
   * Method that always fails — for retry testing
   * @retryable 2 100ms
   */
  async retryable() {
    callCount++;
    throw new Error('always fails');
  }

  /**
   * Slow method — for timeout testing
   * @timeout 200ms
   */
  async slow() {
    await new Promise((r) => setTimeout(r, 5_000));
    return { done: true };
  }

  /**
   * Rate-limited method
   * @throttled 3/s
   */
  async throttled() {
    return { ok: true };
  }

  /**
   * Queued method with concurrency 1
   * @queued 1
   */
  async queued(params: { id: string }) {
    await new Promise((r) => setTimeout(r, 50));
    return { id: params.id, time: Date.now() };
  }

  /**
   * Method with validation
   * @validate params.email must be a valid email
   * @validate params.amount must be positive
   */
  async validated(params: { email: string; amount: number }) {
    return { email: params.email, amount: params.amount };
  }

  /**
   * Deprecated method
   * @deprecated Use newMethod instead
   */
  async oldMethod() {
    return { legacy: true };
  }

  /**
   * New method (not deprecated)
   */
  async newMethod() {
    return { modern: true };
  }

  /**
   * Combined tags
   * @cached 1s
   * @timeout 5s
   * @retryable 1 100ms
   */
  async combined() {
    callCount++;
    return { count: callCount };
  }

  /**
   * Reset the call counter (test utility)
   */
  async resetCounter() {
    callCount = 0;
    return { reset: true };
  }
}
