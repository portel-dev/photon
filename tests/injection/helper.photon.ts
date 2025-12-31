/**
 * Helper Photon for testing Photon-to-Photon dependency injection
 */
export default class HelperPhoton {
  /**
   * Returns a greeting message
   * @param name Name to greet
   */
  async greet(params: { name: string }): Promise<{ message: string }> {
    return { message: `Hello, ${params.name}!` };
  }

  /**
   * Returns system info for testing
   */
  async info(): Promise<{ name: string; version: string }> {
    return { name: 'HelperPhoton', version: '1.0.0' };
  }
}
