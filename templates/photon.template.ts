/**
 * TemplateName Photon MCP
 *
 * Single-file MCP server using Photon.
 *
 * Run with: photon mcp template-name --dev
 */

export default class TemplateName {
  // User-configurable knobs. Photon auto-generates a `settings` MCP tool
  // from this object and persists changes to
  // ~/.photon/state/<photon>/<instance>-settings.json.
  //
  // Reach for this whenever a value should be runtime-configurable. Use a
  // constructor parameter only for primitive secrets (API keys, tokens)
  // that should live in .env. Uncomment and edit:
  //
  //   protected settings = {
  //     /** Friendly description shown in the settings tool */
  //     greeting: 'Hello',
  //   };

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
   * Echo a message back
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
    return { a: params.a, b: params.b, sum: params.a + params.b };
  }

  /**
   * Get current timestamp
   */
  async getCurrentTime() {
    return new Date().toISOString();
  }
}
