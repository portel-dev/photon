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
   * @param a {@min 0} {@label First Number} First number to add
   * @param b {@min 0} {@label Second Number} Second number to add
   * @returns {@label Calculate Sum} The sum of a and b
   */
  async add(params: { a: number; b: number }): Promise<number> {
    return params.a + params.b;
  }

  /**
   * Method with optional parameter
   * @param name {@placeholder Enter your name} {@hint This will be used in the greeting} Name to greet
   * @param greeting {@placeholder Hi, Hey, Hello...} Optional greeting prefix
   */
  async greet(params: { name: string; greeting?: string }): Promise<string> {
    const greeting = params.greeting || 'Hello';
    return `${greeting}, ${params.name}!`;
  }

  /**
   * Search for items
   * @icon 🔍
   * @param query {@placeholder Type to search...} {@hint Search is case-insensitive} Search query
   * @returns {@label Search Now} The search results
   */
  async search(params: { query: string }): Promise<object> {
    return {
      query: params.query,
      results: ['Result 1', 'Result 2', 'Result 3'],
      total: 3
    };
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

  // ============================================================================
  // Smart Rendering Test Methods
  // ============================================================================

  /**
   * Users with smart field detection (name->title, email->subtitle, avatar->icon)
   */
  async getSmartUsers(): Promise<object[]> {
    return [
      { name: 'Alice Smith', email: 'alice@example.com', avatar: 'A', status: 'active' },
      { name: 'Bob Jones', email: 'bob@example.com', avatar: 'B', status: 'inactive' },
      { name: 'Carol White', email: 'carol@example.com', avatar: 'C', status: 'active' }
    ];
  }

  /**
   * Products with layout hints override
   * @format list {@title productName, @subtitle description, @badge category}
   */
  async getProducts(): Promise<object[]> {
    return [
      { productName: 'Laptop Pro', description: 'High-performance laptop', category: 'Electronics', price: 1299 },
      { productName: 'Wireless Mouse', description: 'Ergonomic wireless mouse', category: 'Accessories', price: 49 },
      { productName: 'USB-C Hub', description: 'Multi-port USB-C adapter', category: 'Accessories', price: 79 }
    ];
  }

  /**
   * Single card with hints
   * @format card {@title displayName, @subtitle role}
   */
  async getProfile(): Promise<object> {
    return {
      displayName: 'John Developer',
      role: 'Senior Engineer',
      department: 'Engineering',
      location: 'Remote'
    };
  }

  /**
   * String array for chips rendering
   */
  async getTags(): Promise<string[]> {
    return ['JavaScript', 'TypeScript', 'React', 'Node.js', 'GraphQL'];
  }

  /**
   * Data with date and email fields for type detection
   */
  async getContacts(): Promise<object[]> {
    return [
      { name: 'Support', email: 'support@company.com', createdAt: '2024-01-15' },
      { name: 'Sales', email: 'sales@company.com', createdAt: '2024-02-20' }
    ];
  }
}
