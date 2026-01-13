/**
 * Demo Photon - Comprehensive feature demonstration
 *
 * Demonstrates all Photon runtime features with Node.js compatible syntax.
 * This version avoids TypeScript parameter properties for compatibility.
 *
 * @version 1.0.0
 */

import { io } from '@portel/photon-core';

interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Demo Photon showcasing Photon runtime features
 */
export default class DemoPhoton {
  private apiKey: string;
  private counter: number;
  private todos: string[];

  constructor(apiKey: string = 'demo-key') {
    this.apiKey = apiKey;
    this.counter = 0;
    this.todos = [];
  }

  // ═══════════════════════════════════════════════════════════════
  // BASIC RETURN TYPES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns a simple string
   * @format primitive
   */
  async getString(): Promise<string> {
    return 'Hello from Photon!';
  }

  /**
   * Returns a number
   * @format primitive
   */
  async getNumber(): Promise<number> {
    return 42;
  }

  /**
   * Returns a boolean
   * @format primitive
   */
  async getBoolean(): Promise<boolean> {
    return true;
  }

  /**
   * Returns an object
   * @format json
   */
  async getObject(): Promise<{ message: string; timestamp: string }> {
    return {
      message: 'Success',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Returns an array
   * @format list
   */
  async getArray(): Promise<string[]> {
    return ['Apple', 'Banana', 'Cherry', 'Date'];
  }

  // ═══════════════════════════════════════════════════════════════
  // PARAMETERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Echo back a message
   * @param message The message to echo
   * @format primitive
   */
  async echo(params: { message: string }): Promise<string> {
    return `Echo: ${params.message}`;
  }

  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   * @format primitive
   */
  async add(params: { a: number; b: number }): Promise<number> {
    return params.a + params.b;
  }

  /**
   * Greet with optional name
   * @param name Optional name (default: "World")
   * @format primitive
   */
  async greet(params: { name?: string }): Promise<string> {
    const name = params.name || 'World';
    return `Hello, ${name}!`;
  }

  /**
   * Set log level
   * @param level Log level to set
   * @format primitive
   */
  async setLogLevel(params: { level: 'debug' | 'info' | 'warn' | 'error' }): Promise<string> {
    return `Log level set to: ${params.level}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // PROGRESS INDICATORS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Demonstrates progress indicators
   * @param steps Number of steps to execute
   * @format primitive
   */
  async *showProgress(params: { steps?: number }): AsyncGenerator<any> {
    const steps = params.steps || 5;

    yield io.emit.status('Starting process...');
    await new Promise(resolve => setTimeout(resolve, 500));

    for (let i = 1; i <= steps; i++) {
      yield io.emit.progress(i / steps, `Processing step ${i} of ${steps}`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    yield io.emit.progress(1, 'Complete!');
    return `Completed ${steps} steps successfully`;
  }

  /**
   * Spinner progress (indeterminate)
   * @format primitive
   */
  async *showSpinner(): AsyncGenerator<any> {
    yield io.emit.status('Loading data...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    yield io.emit.status('Processing...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    yield io.emit.status('Finalizing...');
    await new Promise(resolve => setTimeout(resolve, 500));

    return 'Done!';
  }

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Show a notification toast
   * @param message The message to display
   * @param type Notification type: success, error, warning, info
   * @format primitive
   */
  async *showNotification(params: {
    message: string;
    type?: 'success' | 'error' | 'warning' | 'info';
  }): AsyncGenerator<any> {
    const type = params.type || 'info';
    yield io.emit.toast(params.message, type);
    return `Notification shown: ${params.message}`;
  }

  /**
   * Show multiple notification types
   * @format primitive
   */
  async *notificationDemo(): AsyncGenerator<any> {
    yield io.emit.toast('This is an info message', 'info');
    await new Promise(resolve => setTimeout(resolve, 1000));

    yield io.emit.toast('This is a success message', 'success');
    await new Promise(resolve => setTimeout(resolve, 1000));

    yield io.emit.toast('This is a warning message', 'warning');
    await new Promise(resolve => setTimeout(resolve, 1000));

    yield io.emit.toast('This is an error message', 'error');

    return 'All notifications shown!';
  }

  // ═══════════════════════════════════════════════════════════════
  // ELICITATION (ASK/YIELD)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Ask for user's name interactively
   * @format primitive
   */
  async *askName(): AsyncGenerator<any> {
    const name = yield io.ask.text('What is your name?', { default: 'Anonymous' });
    const age = yield io.ask.text('How old are you?');

    return `Hello ${name}, you are ${age} years old!`;
  }

  /**
   * Confirm action with user
   * @format primitive
   */
  async *confirmAction(): AsyncGenerator<any> {
    const confirmed = yield io.ask.confirm('Are you sure you want to continue?', { default: false });

    if (confirmed) {
      return 'Action confirmed and executed!';
    } else {
      return 'Action cancelled by user.';
    }
  }

  /**
   * Select from options
   * @format primitive
   */
  async *selectOption(): AsyncGenerator<any> {
    const choice = yield io.ask.select('Choose your favorite color:', ['Red', 'Green', 'Blue', 'Yellow'], { default: 'Blue' });

    return `You selected: ${choice}`;
  }

  /**
   * Multi-step form with progress
   * @format primitive
   */
  async *multiStepForm(): AsyncGenerator<any> {
    yield io.emit.status('Starting registration...');

    const username = yield io.ask.text('Enter username:');

    yield io.emit.progress(0.33, 'Step 1/3 complete');

    const email = yield io.ask.text('Enter email:');

    yield io.emit.progress(0.66, 'Step 2/3 complete');

    const confirmed = yield io.ask.confirm(`Create account for ${username} (${email})?`, { default: true });

    yield io.emit.progress(1, 'Complete!');

    if (confirmed) {
      return {
        success: true,
        message: 'Account created successfully!',
        username,
        email,
      };
    } else {
      return { success: false, message: 'Registration cancelled' };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Counter with persistent state
   * @param action Action to perform
   * @format json
   */
  async counter(params: { action: 'increment' | 'decrement' | 'reset' | 'get' }): Promise<{ count: number; action: string }> {
    switch (params.action) {
      case 'increment':
        this.counter++;
        break;
      case 'decrement':
        this.counter--;
        break;
      case 'reset':
        this.counter = 0;
        break;
      case 'get':
        break;
    }
    return { count: this.counter, action: params.action };
  }

  /**
   * Todo list manager
   * @param action Action to perform
   * @param item Todo item text
   * @format json
   */
  async todos(params: {
    action: 'add' | 'remove' | 'list' | 'clear';
    item?: string;
  }): Promise<{ todos: string[]; message: string }> {
    switch (params.action) {
      case 'add':
        if (params.item) {
          this.todos.push(params.item);
          return { todos: this.todos, message: `Added: ${params.item}` };
        }
        return { todos: this.todos, message: 'No item provided' };

      case 'remove':
        if (params.item) {
          const index = this.todos.indexOf(params.item);
          if (index > -1) {
            this.todos.splice(index, 1);
            return { todos: this.todos, message: `Removed: ${params.item}` };
          }
          return { todos: this.todos, message: 'Item not found' };
        }
        return { todos: this.todos, message: 'No item provided' };

      case 'clear':
        this.todos = [];
        return { todos: [], message: 'All todos cleared' };

      case 'list':
        return { todos: this.todos, message: `${this.todos.length} todos` };

      default:
        return { todos: this.todos, message: 'Invalid action' };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UI FORMATS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns users as table
   * @format table
   */
  async getUsers(): Promise<User[]> {
    return [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
      { id: '3', name: 'Charlie', email: 'charlie@example.com' },
    ];
  }

  /**
   * Returns markdown documentation
   * @format markdown
   */
  async getDocs(): Promise<string> {
    return `# Demo Photon Documentation

## Features

This photon demonstrates:

- **Basic Types**: String, number, boolean, object, array
- **Parameters**: Required, optional, enums
- **Progress**: Spinners and progress bars
- **Elicitation**: Interactive user input during execution
- **State**: Persistent data across calls
- **UI Formats**: Tables, markdown, JSON

## Usage

\`\`\`bash
photon cli demo getString
photon cli demo add --a 5 --b 3
photon cli demo showProgress --steps 10
\`\`\`

## Interactive Examples

The following methods use elicitation:

- \`askName\` - Asks for user information
- \`confirmAction\` - Gets user confirmation
- \`selectOption\` - Choice from list
- \`multiStepForm\` - Multi-step workflow

Try them in the playground for the best experience!
`;
  }

  /**
   * Returns hierarchical tree data
   * @format tree
   */
  async getTree(): Promise<any> {
    return {
      name: 'Project',
      children: [
        {
          name: 'src',
          children: [
            { name: 'index.ts', size: 1024 },
            { name: 'utils.ts', size: 512 },
          ],
        },
        {
          name: 'tests',
          children: [
            { name: 'demo.test.ts', size: 2048 },
          ],
        },
        { name: 'package.json', size: 256 },
        { name: 'README.md', size: 1536 },
      ],
    };
  }

  /**
   * Get configuration (demonstrates accessing constructor params)
   * @format json
   */
  async getConfig(): Promise<{ apiKeySet: boolean; apiKeyLength: number }> {
    return {
      apiKeySet: this.apiKey !== 'demo-key',
      apiKeyLength: this.apiKey.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE METHODS (should not be exposed)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Private helper method - should not be exposed as a tool
   */
  async _privateMethod(): Promise<string> {
    return 'This should not be visible';
  }
}
