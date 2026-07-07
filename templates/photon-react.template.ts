/**
 * TemplateName Photon MCP
 *
 * Single-file MCP server with custom React + Vite UI.
 *
 * Run with: photon mcp template-name --dev
 * @ui app ./ui/dist/index.html
 */

export default class TemplateName {
  // User-configurable knobs. Photon auto-generates a `settings` MCP tool
  // from this object and persists changes to
  // ~/.photon/state/<photon>/<instance>-settings.json.
  protected settings = {
    /** Title shown in the custom dashboard */
    title: 'Photon React Starter',
  };

  /**
   * Main entry method required for PWA app packaging.
   */
  async main() {
    return {
      status: 'online',
      message: 'React backend is ready.',
      timestamp: new Date().toISOString(),
    };
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
}
