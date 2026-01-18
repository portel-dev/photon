#!/usr/bin/env node
/**
 * Claude Code Stop Hook - Kanban Task Enforcement
 *
 * When Claude tries to finish, this hook checks for pending tasks.
 * If tasks exist, it blocks stopping and makes Claude continue working.
 */

import { execSync } from 'child_process';
import { basename } from 'path';

// Default to current directory name (project name)
const BOARD = process.env.KANBAN_BOARD || basename(process.cwd());

try {
  const result = execSync(`photon cli kanban getMyTasks --board ${BOARD} --json`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const tasks = JSON.parse(result.trim());

  if (Array.isArray(tasks) && tasks.length > 0) {
    // Output JSON to stdout with decision: block
    console.log(JSON.stringify({
      decision: 'block',
      reason: `Tasks pending. Check kanban board for project "${BOARD}"`
    }));
  }
} catch {
  // Kanban not available - let it pass
}

process.exit(0);
