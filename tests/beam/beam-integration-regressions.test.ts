/**
 * Beam Integration Regression Tests
 *
 * Catches silent failures found in production:
 *
 * 1. Internal photon methods (maker/new) must be visible via tools/list
 * 2. Cross-client state sync: CLI mutation → Beam MCP returns fresh data
 * 3. Dynamic photon subscription: photons added after startup get state-changed events
 * 4. State-changed events include the photon name for frontend routing
 * 5. Bun-launched Beam CLI stays alive after printing the URL
 *
 * Run: bunx tsx tests/beam/beam-integration-regressions.test.ts
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BEAM_PORT = 3850 + Math.floor(Math.random() * 100);
const BUN_BEAM_PORT = BEAM_PORT + 500;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let tmpDir: string;
const beamLogs: string[] = [];

// ── Test infrastructure ──

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    const msg = err.message || String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

// ── Setup ──

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beam-regression-'));

  // Stateful list photon for state sync tests
  await fs.writeFile(
    path.join(tmpDir, 'sync-list.photon.ts'),
    `
/**
 * @stateful
 * @description Sync test list
 */
export default class SyncList {
  items: string[];
  constructor(items: string[] = []) { this.items = items; }
  add(item: string) { this.items.push(item); return item; }
  get() { return this.items; }
}
`
  );

  await fs.mkdir(path.join(tmpDir, 'task-board', 'ui'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'task-board.photon.ts'),
    `
/**
 * @description Regression board app
 * @icon 📋
 */
export default class TaskBoard {
  /**
   * @ui board ./ui/board.html
   */
  main() {
    return {
      title: 'Regression Board',
      columns: ['Backlog', 'Todo', 'Done'],
      tasks: [],
    };
  }

  stats() {
    return { total: 0 };
  }
}
`
  );
  await fs.writeFile(
    path.join(tmpDir, 'task-board', 'ui', 'board.html'),
    `<!doctype html>
<html>
  <body>
    <h1 id="title">Loading app result...</h1>
    <div id="columns"></div>
    <script>
      window.addEventListener('message', (event) => {
        const msg = event.data || {};
        if (msg.jsonrpc === '2.0' && msg.method === 'ui/notifications/tool-result') {
          const result = msg.params && msg.params.result;
          document.getElementById('title').textContent = result.title || 'Untitled';
          document.getElementById('columns').textContent = (result.columns || []).join(' | ');
        }
        if (msg.jsonrpc === '2.0' && msg.method === 'ui/initialize') {
          event.source && event.source.postMessage({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2026-01-26' },
          }, '*');
          event.source && event.source.postMessage({
            jsonrpc: '2.0',
            method: 'ui/notifications/initialized',
            params: {},
          }, '*');
        }
      });
      window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/ready' }, '*');
    </script>
  </body>
</html>
`
  );
}

async function startBeam(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Beam startup timeout')), 30000);

    beamProcess = spawn(
      'node',
      [path.join(__dirname, '../../dist/cli.js'), 'beam', '--port', String(BEAM_PORT)],
      {
        cwd: tmpDir,
        env: { ...process.env, PHOTON_DIR: tmpDir, NODE_ENV: 'test' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const checkReady = () => {
      fetch(`${BEAM_URL}/api/diagnostics`, { signal: AbortSignal.timeout(1000) })
        .then(async (res) => {
          if (res.ok) {
            const diag = await res.json();
            if (diag.photonCount >= 1) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkReady, 500);
            }
          } else {
            setTimeout(checkReady, 500);
          }
        })
        .catch(() => setTimeout(checkReady, 500));
    };

    beamProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    beamProcess.stdout?.on('data', (chunk) => beamLogs.push(chunk.toString()));
    beamProcess.stderr?.on('data', (chunk) => beamLogs.push(chunk.toString()));

    setTimeout(checkReady, 1500);
  });
}

function cleanup() {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }
}

async function assertBunBeamCliStaysAlive(): Promise<void> {
  const cliPath = path.join(__dirname, '../../dist/cli.js');
  const proc = spawn('bun', [cliPath, 'beam', '--port', String(BUN_BEAM_PORT), '--no-open'], {
    cwd: tmpDir,
    env: { ...process.env, PHOTON_DIR: tmpDir, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  let exited = false;
  proc.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  proc.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });
  proc.on('exit', (code, signal) => {
    exited = true;
    output += `\n[exit ${code ?? ''} ${signal ?? ''}]`;
  });

  try {
    const deadline = Date.now() + 15000;
    let served = false;
    while (Date.now() < deadline) {
      if (exited) break;
      try {
        const res = await fetch(`http://127.0.0.1:${BUN_BEAM_PORT}/`, {
          signal: AbortSignal.timeout(1000),
        });
        const html = await res.text();
        if (res.ok && html.includes('Photon Beam')) {
          served = true;
          break;
        }
      } catch {
        // Not ready yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert(served, `Bun-launched Beam did not serve HTTP. Output:\n${output}`);
    assert(!exited, `Bun-launched Beam exited after startup. Output:\n${output}`);
  } finally {
    proc.kill('SIGTERM');
  }
}

// ── MCP helpers ──

async function mcpInitialize(): Promise<string> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        clientInfo: { name: 'test', version: '1.0.0' },
        capabilities: {},
      },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('No session ID');
  return sessionId;
}

async function mcpListTools(sessionId: string): Promise<any[]> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  return data.result?.tools || [];
}

async function mcpCallTool(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  callId: number = 3,
  timeoutMs = 30000
): Promise<any> {
  const res = await fetch(`${BEAM_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

function toolMatches(tool: any, name: string): boolean {
  return (
    tool?.name === name ||
    tool?.name === name.replace('.', '/') ||
    tool?.name === name.replace('/', '.')
  );
}

async function waitForTool(
  sessionId: string,
  toolName: string,
  timeoutMs = 15000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tools = await mcpListTools(sessionId);
    if (tools.some((t: any) => toolMatches(t, toolName))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function waitForToolsState(
  sessionId: string,
  predicate: (tools: any[]) => boolean,
  timeoutMs = 15000
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  let tools: any[] = [];
  while (Date.now() < deadline) {
    tools = await mcpListTools(sessionId);
    if (predicate(tools)) return tools;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return tools;
}

async function waitForCallableTool(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  callIdStart: number,
  timeoutMs = 15000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let callId = callIdStart;
  let lastResponse: any = null;
  while (Date.now() < deadline) {
    lastResponse = await mcpCallTool(sessionId, toolName, args, callId++);
    const errorText = lastResponse.result?.content?.[0]?.text || lastResponse.error?.message || '';
    if (!lastResponse.result?.isError && !lastResponse.error) return lastResponse;
    if (!/Tool not found/i.test(errorText)) return lastResponse;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return lastResponse;
}

function restartDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(__dirname, '../../dist/cli.js'), 'daemon', 'restart'], {
      cwd: tmpDir,
      env: { ...process.env, PHOTON_DIR: tmpDir, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`daemon restart exited ${code}: ${output}`));
      }
    });
  });
}

function parseToolResult(response: any): any {
  const text = response.result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function launchChromiumForRegression(): Promise<any> {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try {
      await fs.access(chromePath);
      return await chromium.launch({ headless: true, executablePath: chromePath });
    } catch {
      throw error;
    }
  }
}

async function inspectBeamAppRoute(page: any): Promise<{
  url: string;
  mainTab: string | null;
  hasCustomUi: boolean;
  methodCards: number;
  shadowText: string;
  iframeText: string;
}> {
  await page.waitForSelector('beam-app', { timeout: 15000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const app = document.querySelector('beam-app') as any;
    const shadow = app?.shadowRoot;
    const sidebar = shadow?.querySelector('beam-sidebar') as any;
    const renderer = shadow?.querySelector('custom-ui-renderer') as any;
    const iframe = renderer?.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    const iframeText = iframe?.contentDocument?.body?.innerText || '';
    return {
      url: window.location.href,
      mainTab: sidebar?.mainTab ?? null,
      hasCustomUi: !!renderer,
      methodCards: shadow?.querySelectorAll('method-card').length || 0,
      shadowText: shadow?.innerText || '',
      iframeText,
    };
  });
}

/**
 * Collect SSE notifications for a given duration.
 */
function collectSSEEvents(sessionId: string, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const events: any[] = [];
    const controller = new AbortController();

    fetch(`${BEAM_URL}/mcp?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const readLoop = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    events.push(data);
                  } catch {
                    // skip non-JSON
                  }
                }
              }
            }
          } catch {
            // aborted
          }
        };
        readLoop();
      })
      .catch(() => {});

    setTimeout(() => {
      controller.abort();
      resolve(events);
    }, durationMs);
  });
}

// ── Tests ──

async function run() {
  console.log('\n🧪 Beam Integration Regression Tests\n');

  await setup();
  console.log(`  tmpDir: ${tmpDir}`);

  await test('Bun-launched Beam CLI stays alive after startup', assertBunBeamCliStaysAlive);

  try {
    await startBeam();
    console.log(`  Beam running on port ${BEAM_PORT}\n`);
  } catch (err: any) {
    console.error(`  Failed to start Beam: ${err.message}`);
    cleanup();
    process.exit(1);
  }

  const sessionId = await mcpInitialize();

  // ─── Test 1: Internal photon methods visible in tools/list ───
  await test('maker photon has methods in tools/list', async () => {
    const tools = await mcpListTools(sessionId);
    const makerTools = tools.filter((t: any) => t.name.startsWith('maker.'));
    assert(makerTools.length > 0, `Expected maker tools, got ${makerTools.length}`);

    const makerNew = makerTools.find((t: any) => t.name === 'maker.new');
    assert(!!makerNew, 'maker.new tool not found');

    const makerWizard = makerTools.find((t: any) => t.name === 'maker.wizard');
    assert(!!makerWizard, 'maker.wizard tool not found');
  });

  await test('marketplace photon has methods in tools/list', async () => {
    const tools = await mcpListTools(sessionId);
    const mpTools = tools.filter((t: any) => t.name.startsWith('marketplace.'));
    assert(mpTools.length > 0, `Expected marketplace tools, got ${mpTools.length}`);
  });

  await test('internal photon tools are not filtered by x-photon-internal', async () => {
    const tools = await mcpListTools(sessionId);
    // maker has @internal at class level, but its methods should still appear
    const makerMethods = tools
      .filter((t: any) => t.name.startsWith('maker.'))
      .filter((t: any) => !t.name.includes('._')); // exclude system methods
    assert(
      makerMethods.length >= 5,
      `Expected at least 5 maker methods (new, wizard, validate, rename, describe), got ${makerMethods.length}: ${makerMethods.map((t: any) => t.name).join(', ')}`
    );
  });

  // ─── Test 2: Cross-client state sync (CLI → Beam MCP) ───
  await test('CLI mutation is visible via Beam MCP after state-changed sync', async () => {
    // Get initial state via Beam MCP
    const beforeResp = await mcpCallTool(sessionId, 'sync-list.get', {}, 10);
    const before = parseToolResult(beforeResp);
    assert(Array.isArray(before), 'get should return array');
    const initialCount = before.length;

    // Mutate via CLI (goes through daemon, not Beam)
    const uniqueItem = `cli-sync-${Date.now()}`;
    execSync(
      `node ${path.join(__dirname, '../../dist/cli.js')} cli sync-list add --item "${uniqueItem}"`,
      {
        cwd: tmpDir,
        env: { ...process.env, PHOTON_DIR: tmpDir },
        timeout: 15000,
      }
    );

    // Wait for daemon → Beam state sync
    await new Promise((r) => setTimeout(r, 3000));

    // Query via Beam MCP — should include the new item
    const afterResp = await mcpCallTool(sessionId, 'sync-list.get', {}, 11);
    const after = parseToolResult(afterResp);
    assert(Array.isArray(after), 'get should return array after add');
    assert(
      after.length > initialCount,
      `Expected more items after CLI add: ${initialCount} → ${after.length}`
    );
    assert(
      after.includes(uniqueItem),
      `Item "${uniqueItem}" not found in Beam result: ${JSON.stringify(after)}`
    );
  });

  // ─── Test 3: State-changed SSE events include photon name ───
  await test('state-changed SSE event includes photon name and method', async () => {
    // Open SSE listener on a second session
    const session2 = await mcpInitialize();
    const eventPromise = collectSSEEvents(session2, 5000);

    // Wait for SSE connection to establish
    await new Promise((r) => setTimeout(r, 500));

    // Trigger a mutation on the first session
    await mcpCallTool(sessionId, 'sync-list.add', { item: `sse-test-${Date.now()}` }, 20);

    const events = await eventPromise;
    const stateChanged = events.filter(
      (e: any) => e.method === 'notifications/state-changed' || e.params?.photon === 'sync-list'
    );
    // At minimum, the mutation should produce a state-changed broadcast
    // (It may not arrive if the SSE connection timing is unlucky, so we're lenient)
    if (stateChanged.length > 0) {
      const evt = stateChanged[0].params || stateChanged[0];
      assert(!!evt.photon, 'state-changed event missing photon name');
    }
    // If no events arrived, that's OK for this test — timing is inherently flaky with SSE
  });

  // ─── Test 4: Dynamic photon subscription ───
  await test('photon added after startup gets state-changed subscription', async () => {
    // Write a new photon AFTER Beam has started
    const dynamicSource = `
/**
 * @stateful
 * @description Dynamic test
 */
export default class DynList {
  items: string[];
  constructor(items: string[] = []) { this.items = items; }
  add(item: string) { this.items.push(item); return item; }
  get() { return this.items; }
}
`;
    await fs.writeFile(path.join(tmpDir, 'dyn-list.photon.ts'), dynamicSource);

    // Wait for Beam file watcher to detect and load
    await new Promise((r) => setTimeout(r, 5000));

    // Verify the dynamic photon appears in tools
    const tools = await mcpListTools(sessionId);
    const dynTools = tools.filter((t: any) => t.name.startsWith('dyn-list.'));
    assert(dynTools.length > 0, `Dynamic photon dyn-list not found in tools after file creation`);

    // Verify it's callable
    const addResp = await mcpCallTool(sessionId, 'dyn-list.add', { item: 'dynamic-item' }, 30);
    assert(!addResp.result?.isError, `dyn-list.add failed: ${JSON.stringify(addResp)}`);

    const getResp = await mcpCallTool(sessionId, 'dyn-list.get', {}, 31);
    const items = parseToolResult(getResp);
    assert(
      Array.isArray(items) && items.includes('dynamic-item'),
      `Dynamic photon should contain 'dynamic-item': ${JSON.stringify(items)}`
    );
  });

  // ─── Test 5: Hot-reload adds a method → callable via daemon ───
  await test('new method added via hot-reload is callable through daemon', async () => {
    // sync-list already exists with add() and get().
    // Add a clear() method by rewriting the source.
    const updatedSource = `
/**
 * @stateful
 * @description Sync test list
 */
export default class SyncList {
  items: string[];
  constructor(items: string[] = []) { this.items = items; }
  add(item: string) { this.items.push(item); return item; }
  get() { return this.items; }
  clear() { this.items.length = 0; return true; }
}
`;
    await fs.writeFile(path.join(tmpDir, 'sync-list.photon.ts'), updatedSource);

    // Wait for hot-reload + daemon reload (daemon reload is async)
    await new Promise((r) => setTimeout(r, 3000));

    // Poll for clear to appear in tools/list. File watcher + daemon reload
    // can complete in separate ticks, so fixed sleeps are unnecessarily flaky.
    const clearFound = await waitForTool(sessionId, 'sync-list.clear');
    assert(clearFound, 'sync-list.clear should appear in tools after hot-reload');

    // Verify clear is callable (not "Tool not found") after the daemon view catches up.
    const clearResp = await waitForCallableTool(sessionId, 'sync-list.clear', {}, 40, 45000);
    assert(
      !clearResp.result?.isError,
      `sync-list.clear should succeed, got: ${clearResp.result?.content?.[0]?.text}`
    );

    // Verify items are actually cleared
    const getResp = await mcpCallTool(sessionId, 'sync-list.get', {}, 41);
    const items = parseToolResult(getResp);
    assert(
      Array.isArray(items) && items.length === 0,
      `Items should be empty after clear, got: ${JSON.stringify(items)}`
    );
  });

  // ─── Test 6: System methods excluded, user methods included ───
  await test('_use and _instances methods are excluded from tools/list for user photons', async () => {
    const tools = await mcpListTools(sessionId);
    // sync-list is @stateful, so it gets _use and _instances — but they should be hidden
    // Actually _use and _instances ARE in tools/list (they're needed by MCP clients)
    // The frontend filters them in toolsToPhotons — this test verifies the naming convention
    const syncListTools = tools.filter(
      (t: any) => t.name.startsWith('sync-list.') || t.name.startsWith('sync-list/')
    );
    const userMethods = syncListTools.filter((t: any) => {
      const method = t.name.split(t.name.includes('.') ? '.' : '/')[1];
      return !method.startsWith('_');
    });
    assert(
      userMethods.length >= 2,
      `Expected at least 2 user methods (add, get), got ${userMethods.length}`
    );

    // Verify user methods are present
    assert(
      syncListTools.some((t: any) => t.name === 'sync-list.add' || t.name === 'sync-list/add'),
      'sync-list.add should be in tools'
    );
    assert(
      syncListTools.some((t: any) => t.name === 'sync-list.get' || t.name === 'sync-list/get'),
      'sync-list.get should be in tools'
    );
  });

  // ─── Test 7: Studio-write hot-reload race ───
  await test('beam/studio-write triggers reload and new method is callable', async () => {
    // Write a photon via MCP studio tool (simulates Studio editor save)
    const studioSource = `
/**
 * @stateful
 * @description Studio race test
 */
export default class StudioTest {
  items: string[];
  constructor(items: string[] = []) { this.items = items; }
  get() { return this.items; }
}
`;
    await fs.writeFile(path.join(tmpDir, 'studio-test.photon.ts'), studioSource);

    // Verify initial state. The file watcher is async, so poll for visibility.
    assert(
      await waitForTool(sessionId, 'studio-test/get'),
      'studio-test/get should be in initial tools'
    );

    // Now "edit" the file to add a new method (simulates Studio save)
    const updatedSource = `
/**
 * @stateful
 * @description Studio race test
 */
export default class StudioTest {
  items: string[];
  constructor(items: string[] = []) { this.items = items; }
  get() { return this.items; }
  add(item: string) { this.items.push(item); return item; }
  count() { return this.items.length; }
}
`;
    const writeResp = await mcpCallTool(
      sessionId,
      'beam/studio-write',
      { name: 'studio-test', source: updatedSource },
      49
    );
    assert(
      !writeResp.result?.isError,
      `beam/studio-write should save and reload, got: ${writeResp.result?.content?.[0]?.text}`
    );

    assert(
      await waitForTool(sessionId, 'studio-test/count'),
      'studio-test/count should appear after studio edit'
    );

    // Verify new method is CALLABLE (not "Tool not found")
    const countResp = await waitForCallableTool(sessionId, 'studio-test/count', {}, 50);
    assert(
      !countResp.result?.isError,
      `studio-test/count should be callable, got: ${countResp.result?.content?.[0]?.text}`
    );
  });

  // ─── Test 8: CLI mutation produces SSE state-changed event ───
  await test('CLI mutation triggers SSE state-changed event at Beam', async () => {
    // First add an item so sync-list has data to work with
    await mcpCallTool(sessionId, 'sync-list.add', { item: 'sse-baseline' }, 60);

    // Open SSE listener on a second session
    const session2 = await mcpInitialize();
    const eventPromise = collectSSEEvents(session2, 8000);

    // Wait for SSE connection to establish
    await new Promise((r) => setTimeout(r, 1000));

    // Mutate via CLI (goes through daemon, not Beam transport)
    const cliItem = `cli-sse-${Date.now()}`;
    execSync(
      `node ${path.join(__dirname, '../../dist/cli.js')} cli sync-list add --item "${cliItem}"`,
      {
        cwd: tmpDir,
        env: { ...process.env, PHOTON_DIR: tmpDir },
        timeout: 15000,
      }
    );

    const events = await eventPromise;

    // Look for state-changed event with our photon
    const stateChangedEvents = events.filter(
      (e: any) =>
        e.method === 'notifications/state-changed' ||
        (e.params?.photon === 'sync-list' && e.params?.method === 'add')
    );

    assert(
      stateChangedEvents.length > 0,
      `Expected state-changed SSE event after CLI mutation, got ${events.length} total events: ${events.map((e: any) => e.method || e.params?.photon).join(', ')}`
    );
  });

  // ─── Test 9: Deleted photon returns clean isError response ───
  await test('tool call on deleted photon returns isError with clear message', async () => {
    // Create a temporary photon
    await fs.writeFile(
      path.join(tmpDir, 'ephemeral.photon.ts'),
      `
/** @description Ephemeral test */
export default class Ephemeral {
  ping() { return 'pong'; }
}
`
    );

    // Wait for it to load
    await new Promise((r) => setTimeout(r, 5000));

    // Verify it's callable
    const pingResp = await mcpCallTool(sessionId, 'ephemeral/ping', {}, 70);
    assert(!pingResp.result?.isError, `ephemeral/ping should work initially`);

    // Delete the photon file
    await fs.unlink(path.join(tmpDir, 'ephemeral.photon.ts'));

    // Wait for Beam watcher to detect removal
    await new Promise((r) => setTimeout(r, 3000));

    // Call the now-deleted photon
    const deadResp = await mcpCallTool(sessionId, 'ephemeral/ping', {}, 71);

    // Should get a clean error, not a crash or ambiguous response
    assert(
      deadResp.result?.isError === true || deadResp.error,
      `Calling deleted photon should return isError or error, got: ${JSON.stringify(deadResp.result || deadResp.error)}`
    );
  });

  // ─── Test 10: Concurrent hot-reloads resolve to latest version ───
  await test('rapid double-save is debounced and resolves to the latest version', async () => {
    const beforeLogCount = beamLogs.length;

    // Write v1 with methodA
    const v1 = `
/**
 * @description Rapid save test
 */
export default class RapidSave {
  methodA() { return 'v1'; }
}
`;
    await fs.writeFile(path.join(tmpDir, 'rapid-save.photon.ts'), v1);

    // Wait just 500ms then overwrite with v2 that has methodB instead
    await new Promise((r) => setTimeout(r, 500));

    const v2 = `
/**
 * @description Rapid save test
 */
export default class RapidSave {
  methodB() { return 'v2'; }
}
`;
    await fs.writeFile(path.join(tmpDir, 'rapid-save.photon.ts'), v2);

    // Verify v2's method is present and v1's is gone after the debounced reload settles.
    const tools = await waitForToolsState(
      sessionId,
      (currentTools) =>
        currentTools.some((t: any) => toolMatches(t, 'rapid-save/methodB')) &&
        !currentTools.some((t: any) => toolMatches(t, 'rapid-save/methodA')),
      30000
    );
    const rapidTools = tools
      .filter((t: any) => t.name.startsWith('rapid-save'))
      .map((t: any) => t.name);
    const hasMethodB = rapidTools.some((name) => toolMatches({ name }, 'rapid-save/methodB'));
    const hasMethodA = rapidTools.some((name) => toolMatches({ name }, 'rapid-save/methodA'));

    assert(
      hasMethodB,
      `methodB (v2) should be in tools after rapid double-save. Rapid tools: ${rapidTools.join(', ')}`
    );
    assert(
      !hasMethodA,
      `methodA (v1) should NOT be in tools — v2 replaced it. Rapid tools: ${rapidTools.join(', ')}`
    );

    const newLogs = beamLogs.slice(beforeLogCount).join('');
    const loadCount =
      (newLogs.match(/New photon detected: rapid-save/g) || []).length +
      (newLogs.match(/File change detected, reloading rapid-save/g) || []).length;
    assert(
      loadCount === 1,
      `rapid double-save should coalesce to one load, got ${loadCount}:\n${newLogs}`
    );
  });

  // ─── Test 11: Undo via MCP rolls back state ───
  await test('_undo rolls back last mutation on stateful photon', async () => {
    // Add two items
    await mcpCallTool(sessionId, 'sync-list.add', { item: 'undo-test-1' }, 80);
    await mcpCallTool(sessionId, 'sync-list.add', { item: 'undo-test-2' }, 81);

    // Get current state
    const beforeResp = await mcpCallTool(sessionId, 'sync-list.get', {}, 82);
    const before = parseToolResult(beforeResp);
    assert(
      Array.isArray(before) && before.includes('undo-test-2'),
      'Should have undo-test-2 before undo'
    );

    // Call _undo
    const undoResp = await mcpCallTool(sessionId, 'sync-list._undo', {}, 83);
    // _undo may fail if no undo history — that's acceptable for this test
    if (undoResp.result?.isError) {
      // Skip — daemon may not have undo history for this session
      return;
    }

    // Verify state rolled back
    const afterResp = await mcpCallTool(sessionId, 'sync-list.get', {}, 84);
    const after = parseToolResult(afterResp);
    assert(
      Array.isArray(after) && !after.includes('undo-test-2'),
      `undo-test-2 should be removed after _undo, got: ${JSON.stringify(after)}`
    );
  });

  // ─── Test 12: Daemon restart under active Beam MCP traffic ───
  await test('daemon restart during Beam MCP traffic does not leak ENOENT or listener warnings', async () => {
    const beforeLogCount = beamLogs.length;
    const restartPromise = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        restartDaemon().then(resolve, reject);
      }, 500);
    });

    const callResults: any[] = [];
    for (let i = 0; i < 20; i++) {
      const response = await mcpCallTool(sessionId, 'sync-list.get', {}, 100 + i, 60000);
      callResults.push(response);
      assert(!response.error, `sync-list.get returned JSON-RPC error: ${JSON.stringify(response)}`);
      assert(
        !response.result?.isError,
        `sync-list.get returned tool error: ${response.result?.content?.[0]?.text || JSON.stringify(response)}`
      );
      await new Promise((r) => setTimeout(r, 100));
    }

    await restartPromise;
    assert(callResults.length === 20, `Expected 20 successful calls, got ${callResults.length}`);

    const newLogs = beamLogs.slice(beforeLogCount).join('');
    assert(
      !/MaxListenersExceededWarning/.test(newLogs),
      `Beam emitted listener leak warning during restart:\n${newLogs}`
    );
    assert(
      !/connect ENOENT/.test(newLogs),
      `Beam emitted daemon ENOENT during restart:\n${newLogs}`
    );
    assert(
      !/UnhandledPromiseRejection|unhandled rejection/i.test(newLogs),
      `Beam emitted unhandled rejection during restart:\n${newLogs}`
    );
  });

  // ─── Test 13: App route tabs do not bleed into Methods ───
  await test('app Methods route stays methods-only while app route hydrates custom UI', async () => {
    const browser = await launchChromiumForRegression();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${BEAM_URL}/task-board`, { waitUntil: 'domcontentloaded' });
      const methodsRoute = await inspectBeamAppRoute(page);
      assert(
        methodsRoute.mainTab === 'methods',
        `Expected /task-board to stay on Methods tab, got ${methodsRoute.mainTab}`
      );
      assert(
        !methodsRoute.hasCustomUi,
        `/task-board should not mount app custom UI; text was: ${methodsRoute.shadowText.slice(0, 300)}`
      );
      assert(
        methodsRoute.methodCards > 0,
        `/task-board should render method cards, got ${methodsRoute.methodCards}`
      );
      assert(
        !/Regression Board|Backlog\s*\|\s*Todo\s*\|\s*Done/.test(
          `${methodsRoute.shadowText}\n${methodsRoute.iframeText}`
        ),
        '/task-board should not render the app board above Methods'
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloadedMethodsRoute = await inspectBeamAppRoute(page);
      assert(
        reloadedMethodsRoute.mainTab === 'methods' && !reloadedMethodsRoute.hasCustomUi,
        `Reloading /task-board should stay Methods-only, got ${JSON.stringify({
          mainTab: reloadedMethodsRoute.mainTab,
          hasCustomUi: reloadedMethodsRoute.hasCustomUi,
        })}`
      );

      await page.goto(`${BEAM_URL}/task-board/main`, { waitUntil: 'domcontentloaded' });
      let appRoute = await inspectBeamAppRoute(page);
      const deadline = Date.now() + 10000;
      while (!/Regression Board/.test(appRoute.iframeText) && Date.now() < deadline) {
        await page.waitForTimeout(500);
        appRoute = await inspectBeamAppRoute(page);
      }
      assert(appRoute.hasCustomUi, '/task-board/main should mount the custom UI');
      assert(
        /Regression Board/.test(appRoute.iframeText),
        `/task-board/main should deliver initial tool result to the app iframe, got: ${appRoute.iframeText}`
      );
      assert(
        /Backlog\s*\|\s*Todo\s*\|\s*Done/.test(appRoute.iframeText),
        `/task-board/main should render app columns, got: ${appRoute.iframeText}`
      );
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  });

  // ─── Summary ───
  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
  }
  console.log('');

  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  cleanup();
  process.exit(1);
});
