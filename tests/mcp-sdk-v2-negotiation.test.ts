import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { PhotonServer } from '../src/server.js';

const root = await mkdtemp(join(tmpdir(), 'photon-v2-negotiation-'));
const photonPath = join(root, 'v2-test.photon.ts');
await writeFile(
  photonPath,
  `
export default class V2Test {
  /** @description A read-only v2 probe */
  async hello(name = 'world') { return { greeting: 'hello ' + name }; }
}
`
);

const port = 32000 + Math.floor(Math.random() * 20000);
const server = new PhotonServer({ filePath: photonPath, transport: 'sse', port });

try {
  await server.start();
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  const client = new Client(
    { name: 'photon-v2-test-client', version: '1.0.0' },
    {
      versionNegotiation: { mode: 'auto' },
      capabilities: { tools: {} },
    }
  );

  await client.connect(transport);
  assert.equal(transport.protocolVersion, '2026-07-28');
  const tools = await client.listTools();
  const hello = tools.tools.find((tool) => tool.name === 'hello');
  assert.ok(hello, 'official v2 client should see Photon tools');

  const result = await client.callTool({ name: 'hello', arguments: { name: 'v2' } });
  assert.equal(
    (result.content as Array<{ type: string; text?: string }>)[0]?.text,
    '{\n  "greeting": "hello v2"\n}'
  );
  console.log('Official MCP TypeScript SDK v2 negotiated 2026-07-28 and completed a Photon call.');
} finally {
  await server.stop();
}
