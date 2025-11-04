/**
 * TemplateName Photon MCP
 *
 * Single-file MCP server using Photon
 * Run with: npx photon template-name.photon.ts --dev
 */

export default class TemplateName {
  /**
   * Optional initialization hook
   * Called once when the MCP is loaded
   */
  async onInitialize?() {
    console.error('[template-name] Initialized');
  }

  /**
   * Optional shutdown hook
   * Called when the MCP is shutting down
   */
  async onShutdown?() {
    console.error('[template-name] Shutting down');
  }

  /**
   * Example echo tool
   * @param message Message to echo back
   */
  async echo(params: { message: string }) {
    return `Echo: ${params.message}`;
  }

  /**
   * Add two numbers together
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return {
      success: true,
      content: `${params.a} + ${params.b} = ${params.a + params.b}`,
    };
  }

  /**
   * Get current timestamp
   */
  async getCurrentTime(params: {}) {
    const now = new Date();
    return {
      success: true,
      content: `Current time: ${now.toISOString()}`,
    };
  }
}
