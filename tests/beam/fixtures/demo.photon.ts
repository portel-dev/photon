/**
 * Demo Photon - Test fixture with predictable outputs
 *
 * This photon provides methods with known outputs for E2E testing.
 * Each method returns a specific type of data for testing different renderers.
 */

export default class Demo {
  /**
   * Simple string result
   */
  async getString(): Promise<string> {
    return 'Hello from Photon!';
  }

  /**
   * Simple number result
   */
  async getNumber(): Promise<number> {
    return 42;
  }

  /**
   * Simple boolean result
   */
  async getBoolean(): Promise<boolean> {
    return true;
  }

  /**
   * Key-value object for kv-table rendering
   */
  async getConfig(): Promise<object> {
    return {
      apiKeySet: false,
      apiKeyLength: 0,
      environment: 'test',
      version: '1.0.0',
      debug: true,
      maxRetries: 3
    };
  }

  /**
   * Array of objects for grid-table rendering
   * @format table
   */
  async getUsers(): Promise<object[]> {
    return [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com' }
    ];
  }

  /**
   * Markdown content
   * @format markdown
   */
  async getDocs(): Promise<string> {
    return `# Demo Photon Documentation

## Features

- **String output**: Returns simple text
- **Number output**: Returns numeric values
- **Boolean output**: Returns true/false
- **Table output**: Renders as formatted tables
- **Markdown output**: Renders with formatting

## Usage

Call any method to see its output rendered in BEAM UI.
`;
  }

  /**
   * Simple string array
   */
  async getArray(): Promise<string[]> {
    return ['Apple', 'Banana', 'Cherry', 'Date'];
  }

  /**
   * Method with parameters (for form testing)
   * @param a {@min 0} First number (required)
   * @param b {@min 0} Second number (required)
   */
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  /**
   * Method with optional parameter
   * @param name Name to greet
   * @param greeting Optional greeting prefix
   */
  async greet(name: string, greeting: string = 'Hello'): Promise<string> {
    return `${greeting}, ${name}!`;
  }

  /**
   * Mermaid diagram
   * @format mermaid
   */
  async getDiagram(): Promise<string> {
    return `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do something]
    B -->|No| D[Do something else]
    C --> E[End]
    D --> E`;
  }

  /**
   * Nested object (for JSON rendering)
   */
  async getNestedData(): Promise<object> {
    return {
      user: {
        id: 1,
        profile: {
          name: 'Test User',
          settings: {
            theme: 'dark',
            notifications: true
          }
        }
      },
      metadata: {
        created: '2024-01-01',
        updated: '2024-01-15'
      }
    };
  }

  /**
   * Empty array
   */
  async getEmpty(): Promise<any[]> {
    return [];
  }

  /**
   * Null value
   */
  async getNull(): Promise<null> {
    return null;
  }
}
