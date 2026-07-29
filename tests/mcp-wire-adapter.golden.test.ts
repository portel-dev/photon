import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import {
  canonicalizeMCPResponse,
  selectMCPWireAdapter,
  type CanonicalMCPResponse,
  type MCPWireAdapter,
} from '../dist/mcp/protocol/response-adapter.js';

const SERVER_INFO = { name: 'beam-mcp', version: '1.2.3' };
const CAPABILITY_OPTIONS = {
  photonVersion: SERVER_INFO.version,
  aguiEventTypes: ['RUN_STARTED', 'RUN_FINISHED'],
};

function jsonWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function success(id: string, value: Record<string, unknown>): CanonicalMCPResponse {
  return canonicalizeMCPResponse({ jsonrpc: '2.0', id, result: value });
}

function buildGolden(adapter: MCPWireAdapter): Record<string, unknown> {
  const capabilities = adapter.capabilities(CAPABILITY_OPTIONS);
  const discovery = adapter.discovery({
    protocolVersion: adapter.era === 'modern-2026' ? '2026-07-28' : '2025-11-25',
    supportedVersions: ['2025-03-26', '2025-11-25', '2026-07-28'],
    serverInfo: SERVER_INFO,
    capabilities,
    configurationSchema: {
      demo: { type: 'object', properties: { token: { type: 'string' } } },
    },
    requestMetadata: {
      [adapter.era === 'modern-2026' ? 'dev.portel.photon/appSessionId' : 'photon/appSessionId']:
        'app-123',
    },
    ttlMs: 30_000,
    cacheScope: 'private',
    taskMode: adapter.era === 'modern-2026' ? 'extension' : 'legacy-core',
    photonVersion: SERVER_INFO.version,
  });

  const scenarios = {
    discovery: adapter.response(success('discover-1', discovery)),
    list: adapter.response(
      success('list-1', {
        tools: [
          {
            name: 'demo.echo',
            description: 'Echo input',
            inputSchema: { type: 'object' },
          },
        ],
      })
    ),
    toolSuccess: adapter.response(
      success('tool-success-1', {
        content: [{ type: 'text', text: '{"echo":"hello"}' }],
        isError: false,
        structuredContent: { echo: 'hello' },
      })
    ),
    toolError: adapter.response(
      success('tool-error-1', {
        content: [{ type: 'text', text: 'Error: unavailable' }],
        isError: true,
      })
    ),
    resourceRead: adapter.response(
      success('resource-1', {
        contents: [
          {
            uri: 'photon://demo/item/1',
            mimeType: 'application/json',
            text: '{"id":1}',
          },
        ],
      })
    ),
    resourceNotFound: adapter.response({
      kind: 'protocol-error',
      id: 'resource-missing-1',
      error: { code: -32602, message: 'Resource not found' },
    }),
    subscriptionAcknowledgement: adapter.notification('notifications/subscriptions/acknowledged', {
      notifications: { toolsListChanged: true },
      _meta: { 'io.modelcontextprotocol/subscriptionId': 'subscription-1' },
    }),
    subscriptionTermination: adapter.response(
      success('subscription-1', {
        _meta: { 'io.modelcontextprotocol/subscriptionId': 'subscription-1' },
      })
    ),
    inputRequired: adapter.response(
      success('input-1', {
        resultType: 'input_required',
        inputRequests: {
          approval: {
            method: 'elicitation/create',
            params: { message: 'Approve?' },
          },
        },
        requestState: 'state-1',
      })
    ),
    task: adapter.response(
      success('task-1', {
        resultType: 'task',
        taskId: 'task-123',
        status: 'working',
        createdAt: '2026-07-27T00:00:00.000Z',
        lastUpdatedAt: '2026-07-27T00:00:00.000Z',
        ttlMs: 60_000,
        pollIntervalMs: 1_000,
      })
    ),
    extensionResult: adapter.response(
      success('extension-1', {
        resultType: 'com.example/custom',
        value: 'preserved',
      })
    ),
  };

  return jsonWire({
    headers: adapter.headers({ 'Content-Type': 'application/json' }, 'session-123'),
    scenarios,
  });
}

function loadGolden(era: '2025' | '2026'): Record<string, unknown> {
  const fixturePath = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'mcp-wire',
    era,
    'responses.json'
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
}

for (const [era, version] of [
  ['2025', '2025-11-25'],
  ['2026', '2026-07-28'],
] as const) {
  const adapter = selectMCPWireAdapter(version, SERVER_INFO);
  assert.deepEqual(buildGolden(adapter), loadGolden(era), `${era} wire fixture`);
}

const legacyAdapter = selectMCPWireAdapter('2025-11-25', SERVER_INFO);
const modernAdapter = selectMCPWireAdapter('2026-07-28', SERVER_INFO);
assert.equal(legacyAdapter.includesStructuredContent({ value: 1 }), true);
assert.equal(legacyAdapter.includesStructuredContent(['value']), false);
assert.equal(modernAdapter.includesStructuredContent(['value']), true);
assert.equal(modernAdapter.includesStructuredContent(null), true);
for (const [code, expected] of [
  [-32700, 400],
  [-32600, 400],
  [-32602, 400],
  [-32601, 404],
  [-32603, 500],
] as const) {
  const canonical = canonicalizeMCPResponse({
    jsonrpc: '2.0',
    id: 'status',
    error: { code, message: 'safe' },
  });
  assert.equal(modernAdapter.httpStatus(canonical), expected);
  assert.equal(legacyAdapter.httpStatus(canonical), 200);
}

console.log('MCP wire adapter golden fixtures: 2 passed');
