import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MCPClientSDK } from '../src/auto-ui/frontend/services/mcp-client-sdk.js';

const repo = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'photon-beam-sdk-'));
const port = 35000 + Math.floor(Math.random() * 10000);
const endpoint = `http://127.0.0.1:${port}/mcp`;
let processHandle: ChildProcess | undefined;
let output = '';

await writeFile(
  join(root, 'greeting.photon.ts'),
  `
export default class Greeting {
  /** @description Greets a caller */
  greet(name = 'world') { return { message: 'hello ' + name }; }
}
`
);

async function waitForBeam(): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/diagnostics`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).photonCount >= 1) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Beam did not start. Output:\n${output}`);
}

async function postLegacy(method: string, params: Record<string, unknown>, version?: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(version ? { 'Mcp-Protocol-Version': version, 'Mcp-Method': method } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  const text = await response.text();
  try {
    return { response, body: JSON.parse(text) };
  } catch {
    const dataLine = text
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.replace(/^data:\s*/, '');
    return { response, body: JSON.parse(dataLine || text) };
  }
}

try {
  processHandle = spawn(
    'node',
    [join(repo, 'dist', 'cli.js'), 'beam', '--no-open', '--port', String(port)],
    {
      cwd: root,
      env: { ...process.env, PHOTON_DIR: root, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  processHandle.stdout?.on('data', (chunk) => (output += chunk.toString()));
  processHandle.stderr?.on('data', (chunk) => (output += chunk.toString()));
  await waitForBeam();

  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  const client = new Client(
    { name: 'photon-beam-sdk-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' }, capabilities: { tools: {} } }
  );
  try {
    await client.connect(transport);
    assert.equal(transport.protocolVersion, '2026-07-28');
    assert.equal(transport.sessionId, undefined, 'modern Beam transport remains stateless');

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'greeting.greet'));
    const result = await client.callTool({
      name: 'greeting.greet',
      arguments: { name: 'SDK' },
    });
    assert.equal(
      (result.content as Array<{ text?: string }>)[0]?.text,
      '{\n  "message": "hello SDK"\n}'
    );
  } finally {
    await client.close().catch(() => undefined);
  }

  // Beam's browser wrapper stays on the official client too, while restoring
  // Photon-specific x-* metadata that the official decoder keeps in `_meta`.
  const beamClient = new MCPClientSDK(endpoint);
  try {
    await beamClient.connect();
    assert.equal(beamClient.negotiatedProtocolVersion, '2026-07-28');
    const beamTools = await beamClient.listTools();
    const greeting = beamTools.find(
      (tool) => (tool as { name?: string }).name === 'greeting.greet'
    ) as Record<string, unknown> | undefined;
    assert.ok(greeting?.['x-photon-path']?.toString().endsWith('greeting.photon.ts'));
    assert.equal(beamClient.sessionId, undefined);
  } finally {
    await beamClient.disconnect().catch(() => undefined);
  }

  // The SDK's supported stateless legacy fallback remains available to older
  // MCP clients, but it does not create a durable session either.
  const legacyInit = await postLegacy('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'legacy-test', version: '1.0.0' },
    capabilities: {},
  });
  assert.equal(legacyInit.response.status, 200);
  assert.equal(legacyInit.body.result?.protocolVersion, '2025-11-25');
  assert.equal(legacyInit.response.headers.get('mcp-session-id'), null);

  const legacyTools = await postLegacy('tools/list', {}, '2025-11-25');
  assert.equal(legacyTools.response.status, 200);
  assert.ok(
    legacyTools.body.result?.tools?.some((tool: { name: string }) => tool.name === 'greeting.greet')
  );

  console.log('Official SDK v2 Beam path passed modern stateless and legacy stateless probes.');
} finally {
  processHandle?.kill('SIGTERM');
  await rm(root, { recursive: true, force: true });
}
