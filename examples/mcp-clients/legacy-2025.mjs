import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node examples/mcp-clients/legacy-2025.mjs <mcp-url>');
  process.exit(2);
}

const client = new Client(
  { name: 'photon-docs-legacy-client', version: '1.0.0' },
  { capabilities: {} }
);
const transport = new StreamableHTTPClientTransport(new URL(endpoint));

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(
    JSON.stringify({
      protocol: 'MCP 2025 sessionful',
      transport: 'streamable-http',
      tools: tools.map((tool) => tool.name),
    })
  );
} finally {
  await client.close().catch(() => {});
}
