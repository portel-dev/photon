/**
 * Resilient Test Photon - exercises middleware tags
 *
 * @version 1.0.0
 */
export default class ResilientTest {
  private callCount = 0;

  /**
   * Fails twice then succeeds (for @retryable testing)
   * @retryable 3
   */
  async flaky(): Promise<string> {
    this.callCount++;
    if (this.callCount < 3) {
      throw new Error(`Attempt ${this.callCount} failed`);
    }
    return 'success-after-retries';
  }

  /**
   * Returns cached result (for @cached testing)
   * @cached 60
   * @readOnly
   */
  async timestamp(): Promise<number> {
    return Date.now();
  }

  /**
   * A simple method to test basic execution
   * @readOnly
   */
  async ping(): Promise<string> {
    return 'pong';
  }
}
