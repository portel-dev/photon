/**
 * Test Photon for dependency injection
 *
 * Demonstrates injection types:
 * - Environment variables (primitives)
 * - Photon instances (@photon)
 *
 * Note: MCP injection (@mcp) requires a running MCP server
 *
 * @photon helper ./helper.photon.ts
 */
export default class TestInjection {
  constructor(
    // Primitives → injected from env vars
    private apiKey: string,
    private timeout: number = 5000,
    private debug: boolean = false,
    // Non-primitive matching @photon declaration → injected Photon
    private helper: any
  ) {}

  /**
   * Test calling the helper Photon
   * @param name Name to pass to helper
   */
  async callHelper(params: { name: string }): Promise<{ greeting: string }> {
    if (!this.helper) {
      throw new Error('Helper Photon not injected');
    }
    const result = await this.helper.greet({ name: params.name });
    return { greeting: result.message };
  }

  /**
   * Get injection status for debugging
   */
  async status(): Promise<{
    apiKey: string;
    timeout: number;
    debug: boolean;
    hasHelper: boolean;
  }> {
    return {
      apiKey: this.apiKey ? '***' : '(missing)',
      timeout: this.timeout,
      debug: this.debug,
      hasHelper: !!this.helper,
    };
  }
}
