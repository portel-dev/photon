/**
 * Promise Test Photon — Minimal fixture for validating platform promises
 *
 * This photon deliberately exercises core platform promises:
 * - P1: Single file, three interfaces (CLI, MCP, Beam)
 * - P2: Human + Agent same surface
 * - P3: Zero config (no imports needed beyond this file)
 * - P4: Format-driven rendering (@format tags)
 *
 * @version 1.0.0
 */
export default class PromiseTest {
  /**
   * Returns a greeting — simplest possible method
   * @param name Who to greet
   * @readOnly
   */
  async greet({ name }: { name: string }): Promise<string> {
    return `Hello, ${name}!`;
  }

  /**
   * Returns structured data for table rendering
   * @format table
   * @readOnly
   */
  async users() {
    return [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
      { id: 3, name: 'Charlie', role: 'user' },
    ];
  }

  /**
   * Returns markdown content
   * @format markdown
   * @readOnly
   */
  async docs() {
    return `# Promise Test

## Features

- **Greet**: Returns a greeting
- **Users**: Returns a table of users
- **Docs**: Returns this markdown

All methods work via CLI, MCP, and Beam.`;
  }

  /**
   * Adds two numbers — tests parameter validation
   * @param a {@min 0} First number
   * @param b {@min 0} Second number
   */
  async add({ a, b }: { a: number; b: number }): Promise<number> {
    return a + b;
  }
}
