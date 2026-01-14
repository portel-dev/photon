/**
 * Test photon requiring a future runtime version
 *
 * @runtime ^99.0.0
 */
export default class FutureRuntime {
  /**
   * This should never load
   */
  async neverRuns(): Promise<void> {
    throw new Error('Should not run');
  }
}
