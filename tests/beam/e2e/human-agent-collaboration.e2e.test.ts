/** The shipped Todo task dashboard, operated by a browser and an MCP client. */
import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

const repo = path.resolve(import.meta.dirname, '../../..');
const token = 'collaboration-test-token';
let root: string;
let url: string;
let beam: ChildProcess | undefined;
let env: NodeJS.ProcessEnv;
let logs = '';
let requestId = 0;

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function request(method: string, params: Record<string, unknown>, authorization = token) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Protocol-Version': '2026-07-28',
      'Mcp-Method': method,
      ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++requestId,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'task-board-agent', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

async function agentCall(method: string, args: Record<string, unknown> = {}) {
  const response = await request('tools/call', { name: `todo.${method}`, arguments: args });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.error).toBeUndefined();
  expect(body.result.isError).not.toBe(true);
  return (
    body.result.structuredContent?.items ??
    body.result.structuredContent ??
    JSON.parse(body.result.content[0].text)
  );
}

async function openMethod(page: Page, method: string) {
  await page.goto(`${url}/todo/${method}`);
  await expect(page.locator('invoke-form')).toBeVisible({ timeout: 30_000 });
}

async function humanAdd(page: Page, text: string) {
  await openMethod(page, 'add');
  await page.locator('invoke-form input[type="text"]').fill(text);
  await page.locator('invoke-form input[type="text"]').press('Enter');
  await expect.poll(() => agentCall('list')).toContainEqual({ text, done: false });
}

async function openList(page: Page) {
  await openMethod(page, 'list');
  // The normal method action starts the read view; subsequent agent changes
  // must become visible through the normal read-only revalidation/renderer path.
  const run = page.locator('.form-chrome .btn-primary');
  if (await run.isVisible()) await run.click();
}

function taskItem(page: Page, text: string) {
  return page.locator('result-viewer .checklist-item').filter({ hasText: text });
}

test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-collaboration-'));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(home, '.data'), { recursive: true });
  await fs.copyFile(
    path.join(repo, 'examples/todo.photon.ts'),
    path.join(workspace, 'todo.photon.ts')
  );
  await fs.cp(path.join(repo, 'examples/todo'), path.join(workspace, 'todo'), { recursive: true });
  const port = await availablePort();
  url = `http://127.0.0.1:${port}`;
  env = {
    ...process.env,
    PHOTON_DIR: workspace,
    PHOTON_HOME: home,
    NODE_ENV: 'test',
    PHOTON_MCP_AUTH_MODE: 'bearer',
    PHOTON_MCP_BEARER: token,
  };
  await startBeam();
}, 60_000);

async function startBeam() {
  beam = spawn(
    process.execPath,
    [path.join(repo, 'dist/cli.js'), 'beam', '--port', new URL(url).port, '--no-open'],
    { cwd: env.PHOTON_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  beam.stdout?.on('data', (chunk) => {
    logs += chunk;
  });
  beam.stderr?.on('data', (chunk) => {
    logs += chunk;
  });
  await expect
    .poll(
      async () => {
        if (beam?.exitCode !== null) throw new Error(`Beam exited: ${logs}`);
        try {
          const response = await request('tools/list', {});
          const body = await response.json();
          return body.result?.tools?.some((tool: { name: string }) => tool.name === 'todo.add');
        } catch {
          return false;
        }
      },
      { timeout: 45_000, message: 'Todo tools become available' }
    )
    .toBe(true);
}

async function stopRuntime() {
  if (beam && beam.exitCode === null) {
    const closed = once(beam, 'close');
    beam.kill('SIGTERM');
    await closed;
  }
  if (env) {
    const stop = spawn(process.execPath, [path.join(repo, 'dist/cli.js'), 'daemon', 'stop'], {
      env,
      stdio: 'ignore',
    });
    await once(stop, 'close');
  }
}

test.afterAll(async () => {
  await stopRuntime();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('a human and agent share the task board through mutation, disconnect, and recovery', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await context.addInitScript((value) => localStorage.setItem('photon_auth_token', value), token);
  await humanAdd(page, 'Human prepares the release');
  await expect(page.getByRole('option').filter({ hasText: 'todo' })).toBeVisible();
  await openList(page);
  await expect(taskItem(page, 'Human prepares the release')).toBeVisible();
  await agentCall('add', { text: 'Agent reviews the release' });
  await expect(taskItem(page, 'Agent reviews the release')).toBeVisible({ timeout: 15_000 });
  await taskItem(page, 'Agent reviews the release').locator('.checklist-cb').click();
  await expect
    .poll(() => agentCall('list'))
    .toContainEqual({ text: 'Agent reviews the release', done: true });

  await context.setOffline(true);
  await agentCall('add', { text: 'Agent works while browser is offline' });
  await context.setOffline(false);
  await expect(taskItem(page, 'Agent works while browser is offline')).toBeVisible({
    timeout: 30_000,
  });
  await Promise.all([
    agentCall('add', { text: 'Concurrent task A' }),
    agentCall('add', { text: 'Concurrent task B' }),
  ]);
  await expect(taskItem(page, 'Concurrent task A')).toBeVisible({ timeout: 15_000 });
  await expect(taskItem(page, 'Concurrent task B')).toBeVisible();
  // Reload proves the view is reconstructed from authoritative state.
  await page.reload();
  await expect(taskItem(page, 'Agent reviews the release')).toBeVisible();
  await expect(taskItem(page, 'Agent reviews the release')).toHaveClass(/done/);
  await expect
    .poll(() => agentCall('list'))
    .toContainEqual({ text: 'Agent reviews the release', done: true });

  // Cancelling a destructive action must not dispatch it or change shared state.
  let removeCalls = 0;
  page.on('request', (outgoing) => {
    if (outgoing.postData()?.includes('todo/remove')) removeCalls++;
  });
  await openMethod(page, 'remove');
  await page.locator('invoke-form input[type="text"]').fill('Human prepares the release');
  await page.locator('invoke-form input[type="text"]').press('Enter');
  const confirmation = page.locator('elicitation-modal');
  await expect(
    confirmation.getByText('This action may change or remove data.', { exact: false })
  ).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(removeCalls).toBe(0);
  expect(await agentCall('list')).toContainEqual({
    text: 'Human prepares the release',
    done: false,
  });

  const denied = await request(
    'tools/call',
    { name: 'todo.add', arguments: { text: 'Unauthorized change' } },
    ''
  );
  expect(denied.status).toBe(401);
  await denied.text();
  expect(await agentCall('list')).not.toContainEqual({ text: 'Unauthorized change', done: false });

  const beforeRestart = await agentCall('list');
  expect(beforeRestart).toHaveLength(5);
  const invalid = await request('tools/call', {
    name: 'todo.check',
    arguments: { text: 'Human prepares the release', done: 'yes' },
  });
  const invalidBody = await invalid.json();
  expect(invalidBody.error || invalidBody.result?.isError).toBeTruthy();
  expect(await agentCall('list')).toEqual(beforeRestart);

  await context.setOffline(true);
  await stopRuntime();
  await startBeam();
  await context.setOffline(false);
  await openList(page);
  await expect(taskItem(page, 'Agent reviews the release')).toHaveClass(/done/);
  await expect(taskItem(page, 'Concurrent task A')).toBeVisible();
  expect(await agentCall('list')).toEqual(beforeRestart);
});
