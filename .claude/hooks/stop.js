#!/usr/bin/env node
/**
 * Claude Code Stop Hook - Kanban Task Enforcement
 *
 * When Claude tries to finish, this hook checks for pending tasks.
 * If tasks exist, it returns an error which makes Claude continue working.
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
    console.error(`Tasks pending. Check kanban board for project "${BOARD}"`);
    process.exit(1);
  }
} catch {
  // Kanban not available - let it pass
}

process.exit(0);
