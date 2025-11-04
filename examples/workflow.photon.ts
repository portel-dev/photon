/**
 * Workflow Photon MCP - Simple task management
 *
 * Demonstrates workflow and task orchestration capabilities.
 * This is a simplified version for demonstration purposes.
 *
 * Run with: npx photon workflow.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

interface Task {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  created: string;
}

export default class Workflow {
  private tasks: Map<string, Task> = new Map();

  /**
   * Optional initialization hook
   */
  async onInitialize() {
    console.error('[workflow] Initialized with empty task list');
  }

  /**
   * List all tasks
   */
  async list(params: {}) {
    const tasks = Array.from(this.tasks.values());
    return {
      success: true,
      count: tasks.length,
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        created: t.created,
      })),
    };
  }

  /**
   * Get details of a specific task
   * @param id Task ID
   */
  async get(params: { id: string }) {
    const task = this.tasks.get(params.id);
    if (!task) {
      return {
        success: false,
        error: `Task not found: ${params.id}`,
      };
    }

    return {
      success: true,
      task,
    };
  }

  /**
   * Create a new task
   * @param name Task name
   * @param description Task description
   */
  async create(params: { name: string; description: string }) {
    const id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const task: Task = {
      id,
      name: params.name,
      description: params.description,
      status: 'pending',
      created: new Date().toISOString(),
    };

    this.tasks.set(id, task);

    return {
      success: true,
      message: 'Task created successfully',
      task,
    };
  }

  /**
   * Update task status
   * @param id Task ID
   * @param status New status (pending, in_progress, completed)
   */
  async updateStatus(params: { id: string; status: 'pending' | 'in_progress' | 'completed' }) {
    const task = this.tasks.get(params.id);
    if (!task) {
      return {
        success: false,
        error: `Task not found: ${params.id}`,
      };
    }

    task.status = params.status;

    return {
      success: true,
      message: `Task ${params.id} status updated to ${params.status}`,
      task,
    };
  }

  /**
   * Delete a task
   * @param id Task ID
   */
  async delete(params: { id: string }) {
    const task = this.tasks.get(params.id);
    if (!task) {
      return {
        success: false,
        error: `Task not found: ${params.id}`,
      };
    }

    this.tasks.delete(params.id);

    return {
      success: true,
      message: `Task ${params.id} deleted successfully`,
    };
  }

  /**
   * Validate a workflow definition
   * @param name Workflow name
   * @param steps Number of steps
   */
  async validate(params: { name: string; steps: number }) {
    const isValid = params.name.length > 0 && params.steps > 0;

    return {
      success: true,
      valid: isValid,
      message: isValid
        ? `Workflow "${params.name}" with ${params.steps} steps is valid`
        : 'Invalid workflow: name must not be empty and steps must be > 0',
    };
  }
}
