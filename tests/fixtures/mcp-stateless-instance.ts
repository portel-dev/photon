import http from 'node:http';

const sharedDir = process.argv[2];
const instanceId = process.argv[3];
if (!sharedDir || !instanceId) throw new Error('shared directory and instance id are required');
process.env.PHOTON_DIR = sharedDir;

const { broadcastNotification, handleStreamableHTTP, stopSessionCleanup } =
  await import('../../dist/auto-ui/streamable-http-transport.js');

let echoExecutions = 0;
let mutateExecutions = 0;

const methods = [
  {
    name: 'ask',
    description: 'Ask for a name',
    params: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    hasGeneratorAsks: true,
  },
  {
    name: 'echo',
    description: 'Idempotent instance echo',
    params: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    readOnlyHint: true,
    idempotentHint: true,
  },
  {
    name: 'mutate',
    description: 'Non-idempotent mutation',
    params: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
  },
  {
    name: 'background',
    description: 'Durable background task',
    params: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    isAsync: true,
  },
  {
    name: 'notify',
    description: 'Broadcast a list invalidation',
    params: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
  },
  {
    name: 'metrics',
    description: 'Report process memory for load verification',
    params: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    readOnlyHint: true,
    idempotentHint: true,
  },
];

const context: any = {
  photons: [
    {
      id: 'resilience-id',
      name: 'resilience',
      path: `${sharedDir}/resilience.photon.ts`,
      configured: true,
      methods,
    },
  ],
  photonMCPs: new Map([
    [
      'resilience',
      {
        instance: Object.fromEntries(methods.map((method) => [method.name, () => undefined])),
      },
    ],
  ]),
  externalMCPs: [],
  externalMCPClients: new Map(),
  externalMCPSDKClients: new Map(),
  reconnectExternalMCP: async () => false,
  loadUIAsset: async () => null,
  configurePhoton: async () => ({ success: false }),
  reloadPhoton: async () => ({ success: false }),
  removePhoton: async () => ({ success: false }),
  updateMetadata: () => undefined,
  generatePhotonHelp: () => '',
  loader: {
    executeTool: async (
      _mcp: unknown,
      toolName: string,
      args: Record<string, unknown>,
      options: {
        inputProvider: (ask: Record<string, unknown>) => Promise<unknown>;
        signal?: AbortSignal;
      }
    ) => {
      if (toolName === 'ask') {
        const name = await options.inputProvider({
          ask: 'text',
          id: 'profile',
          message: 'What is your name?',
        });
        return { name, completedBy: instanceId };
      }
      if (toolName === 'echo') {
        echoExecutions += 1;
        return { instanceId, echoExecutions, value: args.value };
      }
      if (toolName === 'mutate') {
        mutateExecutions += 1;
        return { instanceId, mutateExecutions };
      }
      if (toolName === 'background') {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { instanceId, completed: true };
      }
      if (toolName === 'notify') {
        broadcastNotification('notifications/tools/list_changed');
        return { instanceId, notified: true };
      }
      if (toolName === 'metrics') {
        const memory = process.memoryUsage();
        return { instanceId, rss: memory.rss, heapUsed: memory.heapUsed };
      }
      throw new Error(`unknown tool ${toolName}`);
    },
  },
  broadcast: () => undefined,
  workingDir: sharedDir,
  verifyBearerToken: async (token: string) => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return {
        ok: true,
        claims: {
          sub: payload.sub,
          iss: payload.iss,
          aud: payload.aud,
          scope: payload.scope,
        },
      };
    } catch {
      return { ok: false, reason: 'invalid test token' };
    }
  },
};

const server = http.createServer(async (request, response) => {
  if (!(await handleStreamableHTTP(request, response, context))) {
    response.writeHead(404);
    response.end();
  }
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('failed to bind');
process.stdout.write(`${JSON.stringify({ port: address.port, instanceId })}\n`);

const shutdown = () => {
  stopSessionCleanup();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
