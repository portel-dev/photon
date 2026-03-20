/**
 * Background Job Processor
 *
 * Demonstrates MCP Tasks for fire-and-forget async operations.
 * Designed for tasks/create — the client gets a task ID immediately
 * and polls tasks/get for progress and results.
 *
 * @version 1.0.0
 * @runtime ^1.9.0
 */

import { io } from '@portel/photon-core';

interface ProcessResult {
  item: string;
  status: 'processed' | 'skipped';
  duration: number;
}

export default class BackgroundJob {
  /**
   * Process a batch of items with progress tracking
   *
   * When invoked via tasks/create, the runtime wraps this method:
   * 1. Client receives { taskId } immediately
   * 2. Progress yields update the task's progress field
   * 3. Return value is stored as the task's result
   * 4. Errors set the task state to 'failed'
   *
   * @param items List of items to process
   */
  async *process(params: { items: string[] }) {
    const results: ProcessResult[] = [];
    const total = params.items.length;

    yield io.emit.status(`Starting batch processing of ${total} items`);

    for (let i = 0; i < total; i++) {
      const item = params.items[i];
      const start = Date.now();

      yield io.emit.progress(i / total, `Processing ${item}...`);

      // Simulate varying work
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

      results.push({
        item,
        status: 'processed',
        duration: Date.now() - start,
      });
    }

    yield io.emit.progress(1.0, 'All items processed');
    yield io.emit.toast(`Processed ${total} items`, 'success');

    return {
      processed: results.length,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      results,
    };
  }

  /**
   * Quick status check (non-background)
   */
  async status() {
    return {
      ready: true,
      timestamp: new Date().toISOString(),
    };
  }
}
