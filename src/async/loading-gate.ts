/**
 * LoadingGate — One-shot initialization barrier.
 *
 * Ensures an async init function runs exactly once, even if multiple
 * callers race to trigger it. All callers receive the same result.
 *
 * Usage:
 *   const gate = new LoadingGate();
 *   // In any code path that needs init to be done:
 *   await gate.ensure(async () => { ... expensive init ... });
 */

export class LoadingGate<T = void> {
  private _promise: Promise<T> | undefined;
  private _resolved = false;
  private _value: T | undefined;

  /** Whether the gate has been opened (init completed successfully). */
  get isReady(): boolean {
    return this._resolved;
  }

  /**
   * Run the init function if it hasn't been started yet.
   * If init is in progress, join the existing promise.
   * If init completed, return the cached result immediately.
   */
  async ensure(init: () => Promise<T>): Promise<T> {
    if (this._resolved) return this._value!;

    if (!this._promise) {
      this._promise = init().then(
        (value) => {
          this._resolved = true;
          this._value = value;
          return value;
        },
        (error) => {
          // Allow retry on failure
          this._promise = undefined;
          throw error;
        }
      );
    }

    return this._promise;
  }

  /** Reset the gate so init can run again. */
  reset(): void {
    this._promise = undefined;
    this._resolved = false;
    this._value = undefined;
  }
}
