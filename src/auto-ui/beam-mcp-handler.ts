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

interface MethodInfo {
  name: string;
  description: string;
  icon?: string;
  params: any;
  returns: any;
  autorun?: boolean;
  outputFormat?: string;
  layoutHints?: Record<string, string>;
  buttonLabel?: string;
  linkedUi?: string;
}

interface UIAssetInfo {
  id: string;
  uri: string;
  path: string;
  resolvedPath?: string;
  mimeType?: string;
  linkedTool?: string;
}

interface PhotonAssets {
  ui: UIAssetInfo[];
  prompts: any[];
  resources: any[];
}

interface PhotonInfo {
  name: string;
  path: string;
  configured: boolean;
  methods?: MethodInfo[];
  isApp?: boolean;
  assets?: PhotonAssets;
}

interface PhotonMCPInstance {
  instance: any;
  schemas?: any[];
}

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

  // Handle tools/list - aggregate all photon methods
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: any[] = [];

    for (const photon of photons) {
      if (!photon.configured || !photon.methods) continue;

      for (const method of photon.methods) {
        // Tool name format: photon-name/method-name
        const toolName = `${photon.name}/${method.name}`;

        const tool: any = {
          name: toolName,
          description: method.description || `Execute ${method.name}`,
          inputSchema: method.params || { type: 'object', properties: {} },
        };

        // Add UI extensions
        if (method.icon) {
          tool['x-icon'] = method.icon;
        }
        if (method.autorun) {
          tool['x-autorun'] = true;
        }
        if (method.outputFormat) {
          tool['x-output-format'] = method.outputFormat;
        }
        if (method.layoutHints) {
          tool['x-layout-hints'] = method.layoutHints;
        }
        if (method.buttonLabel) {
          tool['x-button-label'] = method.buttonLabel;
        }

        tools.push(tool);
      }
    }

    return { tools };
  });

  // Handle tools/call - route to correct photon method
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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
        };
      }

      // Regular result
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
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
