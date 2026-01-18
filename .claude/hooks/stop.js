#!/usr/bin/env node
/**
 * Claude Code Stop Hook - Kanban Task Enforcement
 *
 * When Claude tries to finish, this hook checks for pending tasks.
 * If tasks exist, it returns an error which makes Claude continue working.
 */

import { execSync } from 'child_process';

const BOARD = process.env.KANBAN_BOARD || 'photon';

async function checkPendingTasks() {
  try {
    // Call kanban MCP via photon CLI
    const result = execSync(`photon cli kanban getMyTasks --board ${BOARD} --json`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const tasks = JSON.parse(result.trim());

    if (!Array.isArray(tasks) || tasks.length === 0) {
      process.exit(0);
    }

    // Found pending tasks - format and return error
    console.log('==========================================');
    console.log(`PENDING TASKS ON KANBAN BOARD: ${BOARD}`);
    console.log('==========================================\n');
    console.log(`You have ${tasks.length} task(s) that need attention:\n`);

    for (const task of tasks) {
      const priority = task.priority || 'medium';
      const description = task.description || 'No description';
      console.log(`[${priority}] ${task.title}`);
      console.log(`   ${description}`);
      console.log(`   Status: ${task.column}\n`);
    }

    console.log('Please complete these tasks before finishing.');
    console.log('Use the kanban MCP to:');
    console.log("  - Move tasks to 'Done' when complete");
    console.log('  - Add comments to track progress');
    console.log('  - Update task status as you work\n');
    console.log('==========================================');

    process.exit(1);
  } catch (error) {
    // If photon CLI fails or kanban not available, let it pass
    process.exit(0);
  }
}

checkPendingTasks();
