/**
 * CF DO bridge smoke fixture: a stateful counter.
 *
 * Used by the deploy-side test that verifies `this.memory` and `this.emit`
 * survive the daemon → DO translation. Same source runs locally on the
 * daemon and deploys to Cloudflare Workers as a Durable Object via
 * `photon host deploy cf cf-counter`.
 *
 * @version 0.0.1
 * @icon 🔢
 */
export default class CfCounter {
  /**
   * Add `n` to the persisted counter and return the new value.
   * Emits a `counter:changed` event on every call so WS subscribers see live
   * updates.
   *
   * @param n - Amount to add (defaults to 1)
   */
  async increment(n: number = 1): Promise<{ value: number }> {
    const value = await (this as any).memory.update(
      'count',
      (current: number | null) => (current ?? 0) + n
    );
    (this as any).emit({ channel: 'counter:changed', value });
    return { value };
  }

  /**
   * Read the current counter value without changing it.
   */
  async get(): Promise<{ value: number }> {
    const value = (await (this as any).memory.get('count')) ?? 0;
    return { value };
  }

  /**
   * Reset the counter to zero.
   */
  async reset(): Promise<{ value: number }> {
    await (this as any).memory.set('count', 0);
    (this as any).emit({ channel: 'counter:changed', value: 0 });
    return { value: 0 };
  }
}
