/**
 * PhotonMCP Base Class
 *
 * Optional base class for creating Photon MCPs.
 * You don't need to extend this - any class with async methods works!
 *
 * Usage:
 * ```typescript
 * export default class Calculator extends PhotonMCP {
 *   /**
 *    * Add two numbers together
 *    * @param a First number
 *    * @param b Second number
 *    *\/
 *   async add(params: { a: number; b: number }) {
 *     return params.a + params.b;
 *   }
 * }
 * ```
 *
 * Or without extending (plain class):
 * ```typescript
 * export default class Calculator {
 *   async add(params: { a: number; b: number }) {
 *     return params.a + params.b;
 *   }
 * }
 * ```
 */

/**
 * Simple base class for creating Photon MCPs
 *
 * - Class name = MCP name
 * - Public async methods = Tools
 * - Return value = Tool result
 */
export class PhotonMCP {
  /**
   * Get MCP name from class name
   * Converts PascalCase to kebab-case (e.g., MyAwesomeMCP → my-awesome-mcp)
   */
  static getMCPName(): string {
    return this.name
      .replace(/MCP$/, '') // Remove "MCP" suffix if present
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, ''); // Remove leading dash
  }

  /**
   * Get all tool methods from this class
   * Returns all public async methods except lifecycle hooks
   */
  static getToolMethods(): string[] {
    const prototype = this.prototype;
    const methods: string[] = [];

    // Get all property names from prototype chain
    let current = prototype;
    while (current && current !== PhotonMCP.prototype) {
      Object.getOwnPropertyNames(current).forEach((name) => {
        // Skip constructor, private methods (starting with _), and lifecycle hooks
        if (
          name !== 'constructor' &&
          !name.startsWith('_') &&
          name !== 'onInitialize' &&
          name !== 'onShutdown' &&
          typeof (prototype as any)[name] === 'function' &&
          !methods.includes(name)
        ) {
          methods.push(name);
        }
      });
      current = Object.getPrototypeOf(current);
    }

    return methods;
  }

  /**
   * Execute a tool method
   */
  async executeTool(toolName: string, parameters: any): Promise<any> {
    const method = (this as any)[toolName];

    if (!method || typeof method !== 'function') {
      throw new Error(`Tool not found: ${toolName}`);
    }

    try {
      const result = await method.call(this, parameters);
      return result;
    } catch (error: any) {
      console.error(`Tool execution failed: ${toolName} - ${error.message}`);
      throw error;
    }
  }

  /**
   * Optional lifecycle hooks
   */
  async onInitialize?(): Promise<void>;
  async onShutdown?(): Promise<void>;
}
