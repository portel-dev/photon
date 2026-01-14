/**
 * Test photon with npm dependencies
 *
 * @dependencies uuid@^9.0.0
 */
export default class WithDeps {
  /**
   * Generate a UUID using the uuid package
   */
  async generateId(): Promise<{ id: string }> {
    const { v4: uuidv4 } = await import('uuid');
    return { id: uuidv4() };
  }

  /**
   * Simple method without deps
   */
  async ping(): Promise<{ pong: boolean }> {
    return { pong: true };
  }
}
