/**
 * Beam MCP Handler
 *
 * Handles MCP protocol messages for aggregated Photon instances.
 * Implements tools/list, tools/call, resources/list, and resources/read
 * for all loaded photons.
 *
 * MCP Apps Extension Support (SEP-1865):
 * - Exposes UI assets as MCP resources with ui:// scheme
 * - URI format: ui://<photon-name>/<asset-id>
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../mcp-websocket-transport.js';
import { WebSocketServerTransport } from '../mcp-websocket-transport.js';
import type { WebSocket } from 'ws';
import { PHOTON_VERSION } from '../version.js';
import type {
  MethodInfo,
  PhotonInfo,
  PhotonMCPInstance,
  PhotonAssets,
  UIAssetInfo,
} from './types.js';
import {
  buildToolMetadataExtensions,
  buildResponseUIMetadata,
} from './types.js';
import {
  getDaemonTools,
  handleDaemonTool,
  isDaemonTool,
  cleanupDaemonSession,
} from './daemon-tools.js';

/**
 * Function to load UI asset content (provided by beam.ts)
 */
export type UIAssetLoader = (photonName: string, uiId: string) => Promise<string | null>;

/**
 * Create an MCP server session for a WebSocket connection
 */
export function createBeamMCPSession(
  ws: WebSocket,
  photons: PhotonInfo[],
  photonMCPs: Map<string, PhotonMCPInstance>,
  onProgress?: (photon: string, method: string, progress: any) => void,
  loadUIAsset?: UIAssetLoader
): { server: Server; transport: Transport } {
  const transport = new WebSocketServerTransport(ws);

  const server = new Server(
    {
      name: 'beam-mcp',
      version: PHOTON_VERSION,
    },
    {
      capabilities: {
        tools: {
          listChanged: true,
        },
        resources: {
          listChanged: true,
        },
      },
    }
  );

  // Generate a unique session ID for this MCP connection
  const sessionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Helper to send notifications to this client
  const sendNotification = (method: string, params: unknown) => {
    try {
      server.notification({ method, params } as any);
    } catch (error) {
      // Ignore notification errors (client may have disconnected)
    }
  };

  // Clean up subscriptions when transport closes
  transport.onclose = () => {
    cleanupDaemonSession(sessionId);
  };

  // Handle tools/list - aggregate all photon methods + daemon tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: any[] = [];

    // Add photon method tools
    for (const photon of photons) {
      if (!photon.configured || !photon.methods) continue;

      for (const method of photon.methods) {
        // Tool name format: photon-name/method-name
        const toolName = `${photon.name}/${method.name}`;

        const tool = {
          name: toolName,
          description: method.description || `Execute ${method.name}`,
          inputSchema: method.params || { type: 'object', properties: {} },
          // Add UI extensions (x-icon, x-autorun, x-output-format, etc.)
          ...buildToolMetadataExtensions(method),
        };

        tools.push(tool);
      }
    }

    // Add daemon tools (pub/sub, locks, scheduled jobs)
    for (const daemonTool of getDaemonTools()) {
      tools.push(daemonTool);
    }

    return { tools };
  });

  // Handle tools/call - route to correct photon method or daemon tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Check if this is a daemon tool (beam/daemon/*)
    if (isDaemonTool(name)) {
      return handleDaemonTool(name, args || {}, sessionId, sendNotification);
    }

    // Parse tool name: photon-name/method-name
    const slashIndex = name.indexOf('/');
    if (slashIndex === -1) {
      return {
        content: [{ type: 'text', text: `Invalid tool name format: ${name}. Expected: photon-name/method-name` }],
        isError: true,
      };
    }

    const photonName = name.slice(0, slashIndex);
    const methodName = name.slice(slashIndex + 1);

    // Find photon info for UI metadata
    const photonInfo = photons.find(p => p.name === photonName);
    const methodInfo = photonInfo?.methods?.find(m => m.name === methodName);

    // Build UI metadata for response (MCP Apps Extension)
    const uiMetadata = buildResponseUIMetadata(photonName, methodInfo);

    const mcp = photonMCPs.get(photonName);
    if (!mcp || !mcp.instance) {
      return {
        content: [{ type: 'text', text: `Photon not found: ${photonName}` }],
        isError: true,
      };
    }

    const instance = mcp.instance;
    const method = instance[methodName];

    if (typeof method !== 'function') {
      return {
        content: [{ type: 'text', text: `Method not found: ${methodName} in ${photonName}` }],
        isError: true,
      };
    }

    try {
      // Check if method is a generator (for streaming/progress)
      const result = await method.call(instance, args || {});

      // Handle generator results (yield/progress)
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const chunks: any[] = [];

        for await (const chunk of result) {
          if (chunk.emit === 'progress' && onProgress) {
            onProgress(photonName, methodName, chunk);
          } else if (chunk.emit === 'result') {
            chunks.push(chunk.data);
          } else {
            chunks.push(chunk);
          }
        }

        const finalResult = chunks.length === 1 ? chunks[0] : chunks;
        return {
          content: [{ type: 'text', text: JSON.stringify(finalResult, null, 2) }],
          isError: false,
          ...uiMetadata,
        };
      }

      // Regular result - include UI metadata for MCP Apps
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
        ...uiMetadata,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // MCP Apps Extension: resources/list - expose UI assets with ui:// scheme
  // ═══════════════════════════════════════════════════════════════════════════════
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: any[] = [];

    for (const photon of photons) {
      if (!photon.configured || !photon.assets?.ui) continue;

      for (const uiAsset of photon.assets.ui) {
        const uri = (uiAsset as any).uri || `ui://${photon.name}/${uiAsset.id}`;

        resources.push({
          uri,
          name: uiAsset.id,
          mimeType: uiAsset.mimeType || 'text/html',
          description: uiAsset.linkedTool
            ? `UI template for ${photon.name}/${uiAsset.linkedTool}`
            : `UI template: ${uiAsset.id}`,
        });
      }
    }

    return { resources };
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // MCP Apps Extension: resources/read - serve UI template content
  // ═══════════════════════════════════════════════════════════════════════════════
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Parse ui:// URI: ui://<photon-name>/<ui-id>
    const uiMatch = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (!uiMatch) {
      throw new Error(`Invalid resource URI: ${uri}. Expected format: ui://<photon>/<id>`);
    }

    const [, photonName, uiId] = uiMatch;

    // Load UI content via the provided loader
    if (!loadUIAsset) {
      throw new Error('UI asset loading not configured');
    }

    const content = await loadUIAsset(photonName, uiId);
    if (!content) {
      throw new Error(`UI asset not found: ${uri}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'text/html',
          text: content,
        },
      ],
    };
  });

  return { server, transport };
}

/**
 * Notify all MCP sessions that tools list has changed
 */
export async function notifyToolsListChanged(sessions: Map<string, Server>): Promise<void> {
  for (const [, server] of sessions) {
    try {
      await server.notification({
        method: 'notifications/tools/list_changed',
      });
    } catch {
      // Session may be closed
    }
  }
}
