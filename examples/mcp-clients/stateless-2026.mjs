const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node examples/mcp-clients/stateless-2026.mjs <mcp-url>');
  process.exit(2);
}

const protocolVersion = '2026-07-28';
let requestSequence = 0;

function requestMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': protocolVersion,
    'io.modelcontextprotocol/clientInfo': {
      name: 'photon-docs-stateless-client',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'Mcp-Protocol-Version': protocolVersion,
      'Mcp-Method': method,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `docs-${++requestSequence}`,
      method,
      params: { ...params, _meta: requestMeta() },
    }),
  });

  const raw = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('text/event-stream')
    ? raw
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .at(-1)
    : raw;
  const message = payload ? JSON.parse(payload) : undefined;
  if (!response.ok || message?.error) {
    throw new Error(
      `MCP request failed (${response.status}): ${JSON.stringify(message?.error ?? raw)}`
    );
  }
  return message.result;
}

const discovery = await rpc('server/discover');
const toolList = await rpc('tools/list');
console.log(
  JSON.stringify({
    protocol: protocolVersion,
    lifecycle: 'stateless',
    supportedVersions: discovery.supportedVersions,
    tools: toolList.tools.map((tool) => tool.name),
  })
);
