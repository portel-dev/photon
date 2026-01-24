/**
 * Tests for Daemon Tools MCP Integration
 *
 * Tests the daemon features exposed as MCP tools via Beam.
 */

import { strict as assert } from 'assert';
import {
  getDaemonTools,
  handleDaemonTool,
  isDaemonTool,
  cleanupDaemonSession,
} from '../dist/auto-ui/daemon-tools.js';

console.log('🧪 Running Daemon Tools MCP Tests...\n');

let passed = 0;
let failed = 0;

function test(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITION TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('📋 Tool Definition Tests');

{
  const tools = getDaemonTools();

  test(
    tools.length === 10,
    `getDaemonTools: returns 10 tools (got ${tools.length})`
  );

  const toolNames = tools.map(t => t.name);
  test(
    toolNames.includes('beam/daemon/subscribe'),
    'getDaemonTools: includes subscribe tool'
  );
  test(
    toolNames.includes('beam/daemon/unsubscribe'),
    'getDaemonTools: includes unsubscribe tool'
  );
  test(
    toolNames.includes('beam/daemon/publish'),
    'getDaemonTools: includes publish tool'
  );
  test(
    toolNames.includes('beam/daemon/lock'),
    'getDaemonTools: includes lock tool'
  );
  test(
    toolNames.includes('beam/daemon/unlock'),
    'getDaemonTools: includes unlock tool'
  );
  test(
    toolNames.includes('beam/daemon/locks'),
    'getDaemonTools: includes locks tool'
  );
  test(
    toolNames.includes('beam/daemon/schedule'),
    'getDaemonTools: includes schedule tool'
  );
  test(
    toolNames.includes('beam/daemon/unschedule'),
    'getDaemonTools: includes unschedule tool'
  );
  test(
    toolNames.includes('beam/daemon/jobs'),
    'getDaemonTools: includes jobs tool'
  );
  test(
    toolNames.includes('beam/daemon/status'),
    'getDaemonTools: includes status tool'
  );
}

// ═══════════════════════════════════════════════════════════════════
// TOOL IDENTIFICATION TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 Tool Identification Tests');

{
  test(
    isDaemonTool('beam/daemon/subscribe') === true,
    'isDaemonTool: identifies daemon subscribe tool'
  );
  test(
    isDaemonTool('beam/daemon/publish') === true,
    'isDaemonTool: identifies daemon publish tool'
  );
  test(
    isDaemonTool('beam/daemon/lock') === true,
    'isDaemonTool: identifies daemon lock tool'
  );
  test(
    isDaemonTool('beam/daemon/status') === true,
    'isDaemonTool: identifies daemon status tool'
  );
  test(
    isDaemonTool('photon/method') === false,
    'isDaemonTool: rejects non-daemon tool'
  );
  test(
    isDaemonTool('beam/configure') === false,
    'isDaemonTool: rejects beam/configure'
  );
  test(
    isDaemonTool('beam/browse') === false,
    'isDaemonTool: rejects beam/browse'
  );
}

// ═══════════════════════════════════════════════════════════════════
// INPUT SCHEMA TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 Input Schema Tests');

{
  const tools = getDaemonTools();
  const subscribeTool = tools.find(t => t.name === 'beam/daemon/subscribe');
  const publishTool = tools.find(t => t.name === 'beam/daemon/publish');
  const lockTool = tools.find(t => t.name === 'beam/daemon/lock');
  const scheduleTool = tools.find(t => t.name === 'beam/daemon/schedule');

  test(
    subscribeTool?.inputSchema.required?.includes('patterns'),
    'subscribe: requires patterns parameter'
  );
  test(
    subscribeTool?.inputSchema.required?.includes('photon'),
    'subscribe: requires photon parameter'
  );

  test(
    publishTool?.inputSchema.required?.includes('channel'),
    'publish: requires channel parameter'
  );
  test(
    publishTool?.inputSchema.required?.includes('message'),
    'publish: requires message parameter'
  );

  test(
    lockTool?.inputSchema.required?.includes('name'),
    'lock: requires name parameter'
  );
  test(
    lockTool?.inputSchema.required?.includes('photon'),
    'lock: requires photon parameter'
  );
  test(
    lockTool?.inputSchema.properties?.timeout !== undefined,
    'lock: has optional timeout parameter'
  );

  test(
    scheduleTool?.inputSchema.required?.includes('jobId'),
    'schedule: requires jobId parameter'
  );
  test(
    scheduleTool?.inputSchema.required?.includes('method'),
    'schedule: requires method parameter'
  );
  test(
    scheduleTool?.inputSchema.required?.includes('cron'),
    'schedule: requires cron parameter'
  );
}

// ═══════════════════════════════════════════════════════════════════
// HANDLE DAEMON TOOL TESTS (without actual daemon)
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 Handle Daemon Tool Tests');

{
  const sessionId = 'test-session-123';
  const notifications: Array<{ method: string; params: unknown }> = [];
  const sendNotification = (method: string, params: unknown) => {
    notifications.push({ method, params });
  };

  // Test status tool (works without daemon)
  const statusResult = await handleDaemonTool(
    'beam/daemon/status',
    { photon: 'test-photon' },
    sessionId,
    sendNotification
  );

  test(
    statusResult.content[0].type === 'text',
    'status: returns text content'
  );
  test(
    !statusResult.isError,
    'status: does not error without daemon'
  );

  // Test locks tool (returns empty when no daemon)
  const locksResult = await handleDaemonTool(
    'beam/daemon/locks',
    { photon: 'test-photon' },
    sessionId,
    sendNotification
  );

  test(
    locksResult.content[0].type === 'text',
    'locks: returns text content'
  );

  // Test jobs tool
  const jobsResult = await handleDaemonTool(
    'beam/daemon/jobs',
    { photon: 'test-photon' },
    sessionId,
    sendNotification
  );

  test(
    jobsResult.content[0].type === 'text',
    'jobs: returns text content'
  );

  // Test subscribe without daemon (should succeed with warning)
  const subscribeResult = await handleDaemonTool(
    'beam/daemon/subscribe',
    { photon: 'test-photon', patterns: ['test-channel'] },
    sessionId,
    sendNotification
  );

  test(
    subscribeResult.content[0].type === 'text',
    'subscribe: returns text content'
  );

  // Test unsubscribe
  const unsubscribeResult = await handleDaemonTool(
    'beam/daemon/unsubscribe',
    { photon: 'test-photon', patterns: ['test-channel'] },
    sessionId,
    sendNotification
  );

  test(
    unsubscribeResult.content[0].type === 'text',
    'unsubscribe: returns text content'
  );

  // Test invalid tool name
  const invalidResult = await handleDaemonTool(
    'beam/daemon/invalid',
    {},
    sessionId,
    sendNotification
  );

  test(
    invalidResult.isError === true,
    'invalid tool: returns error'
  );
  test(
    invalidResult.content[0].text.includes('Unknown'),
    'invalid tool: error message mentions unknown'
  );
}

// ═══════════════════════════════════════════════════════════════════
// SESSION CLEANUP TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 Session Cleanup Tests');

{
  const sessionId = 'cleanup-test-session';
  const sendNotification = () => {};

  // Subscribe to channels
  await handleDaemonTool(
    'beam/daemon/subscribe',
    { photon: 'test-photon', patterns: ['channel-1'] },
    sessionId,
    sendNotification
  );
  await handleDaemonTool(
    'beam/daemon/subscribe',
    { photon: 'test-photon', patterns: ['channel-2'] },
    sessionId,
    sendNotification
  );

  // Cleanup should not throw
  let cleanupError = false;
  try {
    cleanupDaemonSession(sessionId);
  } catch {
    cleanupError = true;
  }

  test(
    cleanupError === false,
    'cleanupDaemonSession: does not throw'
  );

  // Cleanup of non-existent session should not throw
  cleanupError = false;
  try {
    cleanupDaemonSession('non-existent-session');
  } catch {
    cleanupError = true;
  }

  test(
    cleanupError === false,
    'cleanupDaemonSession: handles non-existent session'
  );
}

// ═══════════════════════════════════════════════════════════════════
// TOOL METADATA TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 Tool Metadata Tests');

{
  const tools = getDaemonTools();

  for (const tool of tools) {
    const hasDescription = typeof tool.description === 'string' && tool.description.length > 0;
    test(
      hasDescription,
      `${tool.name}: has description`
    );

    const hasInputSchema = typeof tool.inputSchema === 'object';
    test(
      hasInputSchema,
      `${tool.name}: has input schema`
    );
  }
}

console.log(`\n✅ Daemon Tools MCP tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
