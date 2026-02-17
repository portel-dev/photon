/**
 * Starter photon templates for the Studio template gallery.
 */

export interface PhotonTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  source: string;
}

export const templates: PhotonTemplate[] = [
  {
    id: 'basic',
    name: 'Basic',
    description: 'Minimal hello-world photon',
    icon: '👋',
    source: `/**
 * Hello World
 *
 * A minimal photon with a single greeting method.
 *
 * @version 1.0.0
 * @icon 👋
 */
export default class HelloWorld {
  /**
   * Say hello to someone
   * @param name The person to greet {@label Name}
   * @returns A friendly greeting
   */
  async greet(params: { name: string }): Promise<string> {
    return \`Hello, \${params.name}! Welcome to Photon.\`;
  }
}
`,
  },
  {
    id: 'crud-api',
    name: 'CRUD API',
    description: 'REST wrapper with list/get/create/update/delete',
    icon: '🗄️',
    source: `/**
 * Item Manager
 *
 * CRUD operations for managing items. Replace with your own
 * data source (database, API, etc).
 *
 * @version 1.0.0
 * @icon 🗄️
 * @stateful true
 */
export default class ItemManager {
  private items: Map<string, { id: string; name: string; status: string; createdAt: string }> = new Map();

  /**
   * List all items
   * @format list {@title name, @subtitle status, @badge status}
   * @returns All items {@label List Items}
   * @icon 📋
   */
  async list(): Promise<any[]> {
    return Array.from(this.items.values());
  }

  /**
   * Get a single item by ID
   * @param id Item identifier
   * @format card
   * @icon 🔍
   */
  async get(params: { id: string }): Promise<any> {
    const item = this.items.get(params.id);
    if (!item) throw new Error(\`Item \${params.id} not found\`);
    return item;
  }

  /**
   * Create a new item
   * @param name Item name {@label Name}
   * @param status Initial status {@choice active,draft,archived} {@default active}
   * @returns The created item
   * @icon ➕
   */
  async create(params: { name: string; status?: string }): Promise<any> {
    const id = Math.random().toString(36).slice(2, 10);
    const item = {
      id,
      name: params.name,
      status: params.status || 'active',
      createdAt: new Date().toISOString(),
    };
    this.items.set(id, item);
    return item;
  }

  /**
   * Update an existing item
   * @param id Item identifier
   * @param name New name {@label Name}
   * @param status New status {@choice active,draft,archived}
   * @returns The updated item
   * @icon ✏️
   */
  async update(params: { id: string; name?: string; status?: string }): Promise<any> {
    const item = this.items.get(params.id);
    if (!item) throw new Error(\`Item \${params.id} not found\`);
    if (params.name) item.name = params.name;
    if (params.status) item.status = params.status;
    return item;
  }

  /**
   * Delete an item
   * @param id Item identifier
   * @returns Deletion confirmation
   * @icon 🗑️
   */
  async delete(params: { id: string }): Promise<{ deleted: boolean }> {
    const existed = this.items.delete(params.id);
    if (!existed) throw new Error(\`Item \${params.id} not found\`);
    return { deleted: true };
  }
}
`,
  },
  {
    id: 'stateful-game',
    name: 'Stateful Game',
    description: 'Game template with board rendering and @ui',
    icon: '🎮',
    source: `/**
 * Tic Tac Toe
 *
 * A simple game demonstrating stateful photons with
 * board rendering and UI templates.
 *
 * @version 1.0.0
 * @icon 🎮
 * @stateful true
 */
export default class TicTacToe {
  private board: string[] = Array(9).fill('');
  private currentPlayer: 'X' | 'O' = 'X';
  private winner: string | null = null;

  /**
   * View the current board
   * @autorun
   * @format card
   * @returns Current game state {@label Show Board}
   * @icon 🎯
   */
  async board_view(): Promise<any> {
    return {
      board: this._renderBoard(),
      currentPlayer: this.currentPlayer,
      winner: this.winner,
      gameOver: this.winner !== null || this.board.every(c => c !== ''),
    };
  }

  /**
   * Place a mark on the board
   * @param position Board position (0-8) {@min 0} {@max 8}
   * @returns Updated game state
   * @icon ✏️
   */
  async play(params: { position: number }): Promise<any> {
    if (this.winner) throw new Error('Game is over!');
    if (this.board[params.position]) throw new Error('Position already taken');
    if (params.position < 0 || params.position > 8) throw new Error('Invalid position');

    this.board[params.position] = this.currentPlayer;
    this.winner = this._checkWinner();
    if (!this.winner) {
      this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    }

    return this.board_view();
  }

  /**
   * Reset the game
   * @returns Fresh game state {@label New Game}
   * @icon 🔄
   */
  async reset(): Promise<any> {
    this.board = Array(9).fill('');
    this.currentPlayer = 'X';
    this.winner = null;
    return this.board_view();
  }

  private _renderBoard(): string {
    const rows = [
      this.board.slice(0, 3),
      this.board.slice(3, 6),
      this.board.slice(6, 9),
    ];
    return rows
      .map(row => row.map(c => c || '.').join(' | '))
      .join('\\n---------\\n');
  }

  private _checkWinner(): string | null {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
      if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
        return this.board[a];
      }
    }
    return null;
  }
}
`,
  },
  {
    id: 'scheduled-job',
    name: 'Scheduled Job',
    description: 'Cron-scheduled task with daemon features',
    icon: '⏰',
    source: `/**
 * Task Scheduler
 *
 * Demonstrates scheduled jobs and cron expressions.
 * Methods run automatically on the configured schedule
 * when the photon daemon is active.
 *
 * @version 1.0.0
 * @icon ⏰
 * @stateful true
 */
export default class TaskScheduler {
  private log: { timestamp: string; action: string }[] = [];

  /**
   * View scheduled job history
   * @autorun
   * @format table
   * @returns Recent job executions {@label Job History}
   * @icon 📊
   */
  async history(): Promise<any[]> {
    return this.log.slice(-20);
  }

  /**
   * Cleanup old data daily at midnight
   * @scheduled 0 0 * * *
   * @returns Cleanup result
   * @icon 🧹
   */
  async cleanup(): Promise<{ cleaned: number }> {
    const count = Math.floor(Math.random() * 50);
    this.log.push({
      timestamp: new Date().toISOString(),
      action: \`Cleaned \${count} old records\`,
    });
    return { cleaned: count };
  }

  /**
   * Generate hourly report
   * @cron 0 * * * *
   * @returns Report status
   * @icon 📈
   */
  async report(): Promise<{ status: string }> {
    this.log.push({
      timestamp: new Date().toISOString(),
      action: 'Generated hourly report',
    });
    return { status: 'Report generated' };
  }

  /**
   * Health check every 5 minutes
   * @cron 0/5 * * * *
   * @returns Health status
   * @icon 💚
   */
  async health(): Promise<{ healthy: boolean; uptime: number }> {
    return {
      healthy: true,
      uptime: process.uptime(),
    };
  }
}
`,
  },
  {
    id: 'webhook-receiver',
    name: 'Webhook Receiver',
    description: 'HTTP webhook endpoint handler',
    icon: '🔗',
    source: `/**
 * Webhook Handler
 *
 * Receives and processes incoming webhooks from external services.
 * Webhook endpoints are automatically exposed by the photon daemon.
 *
 * @version 1.0.0
 * @icon 🔗
 * @stateful true
 */
export default class WebhookHandler {
  private events: any[] = [];

  /**
   * View received webhook events
   * @autorun
   * @format table
   * @returns Recent webhook events {@label Event Log}
   * @icon 📋
   */
  async events_list(): Promise<any[]> {
    return this.events.slice(-50).reverse();
  }

  /**
   * Handle incoming GitHub webhook events
   * @webhook github
   * @param action Event action
   * @param repository Repository info
   * @returns Processing result
   * @icon 🐙
   */
  async handleGithubEvent(params: {
    action: string;
    repository?: { full_name: string };
  }): Promise<{ processed: boolean }> {
    this.events.push({
      source: 'github',
      action: params.action,
      repo: params.repository?.full_name || 'unknown',
      receivedAt: new Date().toISOString(),
    });
    return { processed: true };
  }

  /**
   * Handle incoming Stripe webhook events
   * @webhook stripe
   * @param type Event type
   * @param data Event data
   * @returns Processing result
   * @icon 💳
   */
  async handleStripeEvent(params: {
    type: string;
    data?: any;
  }): Promise<{ processed: boolean }> {
    this.events.push({
      source: 'stripe',
      type: params.type,
      receivedAt: new Date().toISOString(),
    });
    return { processed: true };
  }

  /**
   * Clear all stored events
   * @returns Cleared count
   * @icon 🗑️
   */
  async clear(): Promise<{ cleared: number }> {
    const count = this.events.length;
    this.events = [];
    return { cleared: count };
  }
}
`,
  },
];
