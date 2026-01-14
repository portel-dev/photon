/**
 * Test photon with runtime requirement
 *
 * @runtime ^1.0.0
 */
export default class RuntimeVersion {
  /**
   * Simple ping method
   */
  async ping(): Promise<{ pong: boolean }> {
    return { pong: true };
  }
}
