/**
 * External MCP management — connect, load, reconnect external MCP servers.
 *
 * Extracted from beam.ts. All shared state is passed explicitly via
 * ExternalMCPState rather than module-level globals.
 */

import { createHash } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SDKMCPClientFactory, type MCPConfig } from '@portel/photon-core';
import { logger } from '../../shared/logger.js';
import { requestExternalElicitation } from '../streamable-http-transport.js';
import { prettifyToolName } from './class-metadata.js';
import { withTimeout } from '../../async/index.js';
import type { ExternalMCPInfo, MCPServerConfig, MethodInfo } from '../types.js';
import type { PhotonConfig } from './types.js';

/** Mutable containers that external MCP functions read/write */
export interface ExternalMCPState {
  externalMCPs: ExternalMCPInfo[];
  externalMCPClients: Map<string, any>;
  externalMCPSDKClients: Map<string, Client>;
}

/**
 * Generate a unique ID for an external MCP based on its name.
 */
export function generateExternalMCPId(name: string): string {
  return createHash('sha256').update(`external:${name}`).digest('hex').slice(0, 12);
}

/**
 * Create an HTTP transport for a URL-based MCP.
 * Tries Streamable HTTP first; falls back to legacy SSE.
 */
async function connectHTTPClient(url: string, mcpName: string): Promise<Client> {
  const sdkClient = new Client(
    { name: 'beam-mcp-client', version: '1.0.0' },
    {
      capabilities: {
        elicitation: {},
        experimental: {
          ui: {},
        },
      },
    }
  );

  sdkClient.setRequestHandler(ElicitRequestSchema, async (request) => {
    const params = request.params as any;
    const result = await requestExternalElicitation(mcpName, {
      mode: params.mode as 'form' | 'url',
      message: params.message,
      requestedSchema: params.requestedSchema,
      url: params.url,
    });
    return result;
  });

  try {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const connectPromise = sdkClient.connect(transport);
    await withTimeout(connectPromise, 10000, 'Connection timeout (10s)');
    logger.debug(`Connected to ${url} via Streamable HTTP`);
    return sdkClient;
  } catch (streamableError) {
    logger.debug(`Streamable HTTP failed for ${url}, trying legacy SSE: ${streamableError}`);
  }

  // Fallback: legacy SSE transport
  const sseClient = new Client(
    { name: 'beam-mcp-client', version: '1.0.0' },
    {
      capabilities: {
        elicitation: {},
        experimental: {
          ui: {},
        },
      },
    }
  );

  sseClient.setRequestHandler(ElicitRequestSchema, async (request) => {
    const params = request.params as any;
    const result = await requestExternalElicitation(mcpName, {
      mode: params.mode as 'form' | 'url',
      message: params.message,
      requestedSchema: params.requestedSchema,
      url: params.url,
    });
    return result;
  });

  const sseTransport = new SSEClientTransport(new URL(url));
  const connectPromise = sseClient.connect(sseTransport);
  await withTimeout(connectPromise, 10000, 'Connection timeout (10s)');
  logger.debug(`Connected to ${url} via legacy SSE`);
  return sseClient;
}

/** Extract tools → MethodInfo[] from an SDK client */
function toolsToMethods(tools: any[]): MethodInfo[] {
  return tools.map((tool: any) => ({
    name: tool.name,
    description: tool.description || '',
    params: tool.inputSchema || { type: 'object', properties: {} },
    returns: { type: 'object' },
    icon: tool['x-icon'],
    linkedUi: tool._meta?.ui?.resourceUri,
    visibility: tool._meta?.ui?.visibility,
  }));
}

/** Detect MCP App resources from an SDK client */
async function detectMCPApps(
  sdkClient: Client,
  methods: MethodInfo[],
  mcpInfo: ExternalMCPInfo,
  name: string
): Promise<void> {
  try {
    const resourcesResult = await sdkClient.listResources();
    const resources = resourcesResult.resources || [];

    const allUiResources = resources.filter(
      (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
    );

    mcpInfo.resourceCount = resources.length - allUiResources.length;

    const toolLinkedUris = new Set(methods.map((m: any) => m.linkedUi).filter(Boolean));
    const standaloneResources = allUiResources.filter((r: any) => !toolLinkedUris.has(r.uri));

    if (standaloneResources.length > 0) {
      mcpInfo.hasApp = true;
      mcpInfo.appResourceUri = standaloneResources[0].uri;
      mcpInfo.appResourceUris = standaloneResources.map((r: any) => r.uri);
      const uriList = mcpInfo.appResourceUris.join(', ');
      logger.info(`🎨 MCP App detected: ${name} (${uriList})`);
    }
  } catch {
    logger.debug(`Resources not supported by ${name}`);
  }
}

/**
 * Load external MCPs from config.json mcpServers section.
 *
 * Populates state.externalMCPClients and state.externalMCPSDKClients as
 * side effects. Returns the ExternalMCPInfo[] array to be pushed into
 * state.externalMCPs by the caller.
 */
export async function loadExternalMCPs(
  config: PhotonConfig,
  state: ExternalMCPState
): Promise<ExternalMCPInfo[]> {
  const mcpServers = config.mcpServers || {};
  const results: ExternalMCPInfo[] = [];

  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const mcpId = generateExternalMCPId(name);

    const mcpInfo: ExternalMCPInfo = {
      type: 'external-mcp',
      id: mcpId,
      name,
      connected: false,
      methods: [],
      label: prettifyToolName(name),
      icon: '🔌',
      config: serverConfig,
    };

    try {
      let methods: MethodInfo[] = [];

      if (serverConfig.url) {
        // HTTP transport — SDK client only
        const sdkClient = await connectHTTPClient(serverConfig.url, name);
        state.externalMCPSDKClients.set(name, sdkClient);

        const toolsResult = await sdkClient.listTools();
        methods = toolsToMethods(toolsResult.tools || []);

        await detectMCPApps(sdkClient, methods, mcpInfo, name);

        mcpInfo.connected = true;
        mcpInfo.methods = methods;
      } else if (serverConfig.command) {
        // Stdio transport
        const mcpConfig: MCPConfig = { mcpServers: { [name]: serverConfig } };
        const factory = new SDKMCPClientFactory(mcpConfig, false);
        const client = factory.create(name);
        state.externalMCPClients.set(name, client);

        try {
          const sdkTransport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
            cwd: serverConfig.cwd,
            env: serverConfig.env,
            stderr: 'ignore',
          });
          const sdkClient = new Client(
            { name: 'beam-mcp-client', version: '1.0.0' },
            {
              capabilities: {
                elicitation: {},
                experimental: { ui: {} },
              },
            }
          );

          sdkClient.setRequestHandler(ElicitRequestSchema, async (request) => {
            const params = request.params as any;
            const result = await requestExternalElicitation(name, {
              mode: params.mode as 'form' | 'url',
              message: params.message,
              requestedSchema: params.requestedSchema,
              url: params.url,
            });
            return result;
          });

          const connectPromise = sdkClient.connect(sdkTransport);
          await withTimeout(connectPromise, 10000, 'Connection timeout (10s)');

          state.externalMCPSDKClients.set(name, sdkClient);

          const toolsResult = await sdkClient.listTools();
          methods = toolsToMethods(toolsResult.tools || []);

          await detectMCPApps(sdkClient, methods, mcpInfo, name);

          mcpInfo.connected = true;
          mcpInfo.methods = methods;
        } catch (sdkError) {
          throw sdkError;
        }
      } else {
        // No command or URL — wrapper client (legacy fallback)
        const mcpConfig: MCPConfig = { mcpServers: { [name]: serverConfig } };
        const factory = new SDKMCPClientFactory(mcpConfig, false);
        const client = factory.create(name);
        state.externalMCPClients.set(name, client);

        const tools = await client.list();
        methods = (tools || []).map((tool: any) => ({
          name: tool.name,
          description: tool.description || '',
          params: tool.inputSchema || { type: 'object', properties: {} },
          returns: { type: 'object' },
          icon: tool['x-icon'],
        }));

        mcpInfo.connected = true;
        mcpInfo.methods = methods;
      }

      logger.info(`🔌 Connected to external MCP: ${name} (${methods.length} tools)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      mcpInfo.errorMessage = errorMsg.slice(0, 200);

      const shortMsg = errorMsg.includes('Cannot find module')
        ? `Module not found (run npm build in the MCP directory)`
        : errorMsg.includes('ENOENT')
          ? `Command not found: ${serverConfig.command}`
          : errorMsg.includes('Connection timeout')
            ? `Connection timed out (server may not be running)`
            : errorMsg.includes('Connection closed')
              ? `Server exited immediately (check configuration)`
              : errorMsg.slice(0, 120);

      logger.warn(`⚠️  External MCP "${name}" — ${shortMsg}`);
    }

    results.push(mcpInfo);
  }

  return results;
}

/**
 * Reconnect a failed external MCP.
 *
 * Uses re-find-after-await pattern for safe access to state.externalMCPs.
 */
export async function reconnectExternalMCP(
  name: string,
  state: ExternalMCPState
): Promise<{ success: boolean; error?: string }> {
  const mcpIndex = state.externalMCPs.findIndex((m) => m.name === name);
  if (mcpIndex === -1) {
    return { success: false, error: `External MCP not found: ${name}` };
  }

  const mcpConfig = state.externalMCPs[mcpIndex].config;

  try {
    let methods: MethodInfo[] = [];
    let resourceCount: number | undefined;
    let hasApp: boolean | undefined;
    let appResourceUri: string | undefined;
    let appResourceUris: string[] | undefined;

    if (mcpConfig.url) {
      const sdkClient = await connectHTTPClient(mcpConfig.url, name);
      state.externalMCPSDKClients.set(name, sdkClient);

      const toolsResult = await sdkClient.listTools();
      methods = toolsToMethods(toolsResult.tools || []);

      try {
        const resourcesResult = await sdkClient.listResources();
        const resources = resourcesResult.resources || [];

        const allUiResources = resources.filter(
          (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
        );

        resourceCount = resources.length - allUiResources.length;

        const toolLinkedUris = new Set(methods.map((m: any) => m.linkedUi).filter(Boolean));
        const standaloneResources = allUiResources.filter((r: any) => !toolLinkedUris.has(r.uri));

        if (standaloneResources.length > 0) {
          hasApp = true;
          appResourceUri = standaloneResources[0].uri;
          appResourceUris = standaloneResources.map((r: any) => r.uri);
        }
      } catch {
        // Resources not supported
      }
    } else {
      // Stdio / wrapper transport
      const stdioConfig: MCPConfig = { mcpServers: { [name]: mcpConfig } };
      const factory = new SDKMCPClientFactory(stdioConfig, false);
      const client = factory.create(name);

      const tools = (await withTimeout(client.list(), 10000, 'Connection timeout (10s)')) as any[];

      methods = (tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        params: tool.inputSchema || { type: 'object', properties: {} },
        returns: { type: 'object' },
        icon: tool['x-icon'],
      }));

      state.externalMCPClients.set(name, client);
    }

    // Re-find after awaits — externalMCPs may have been modified during connection
    const currentIndex = state.externalMCPs.findIndex((m) => m.name === name);
    if (currentIndex === -1) {
      return { success: false, error: `External MCP '${name}' was removed during reconnection` };
    }
    const mcp = state.externalMCPs[currentIndex];

    mcp.connected = true;
    mcp.methods = methods;
    mcp.errorMessage = undefined;
    if (resourceCount !== undefined) mcp.resourceCount = resourceCount;
    if (hasApp !== undefined) {
      mcp.hasApp = hasApp;
      mcp.appResourceUri = appResourceUri;
      mcp.appResourceUris = appResourceUris;
    }

    logger.info(`🔌 Reconnected to external MCP: ${name} (${methods.length} tools)`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const failedMcp = state.externalMCPs.find((m) => m.name === name);
    if (failedMcp) failedMcp.errorMessage = errorMsg.slice(0, 200);
    logger.warn(`⚠️ Failed to reconnect to external MCP: ${name} - ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
