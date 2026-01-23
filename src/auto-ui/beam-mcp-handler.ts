/**
 * Beam MCP Handler
 *
 * Handles MCP protocol messages for aggregated Photon instances.
 * Implements tools/list and tools/call for all loaded photons.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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

interface PhotonInfo {
  name: string;
  path: string;
  configured: boolean;
  methods?: MethodInfo[];
  isApp?: boolean;
}

interface PhotonMCPInstance {
  instance: any;
  schemas?: any[];
}

/**
 * Create an MCP server session for a WebSocket connection
 */
export function createBeamMCPSession(
  ws: WebSocket,
  photons: PhotonInfo[],
  photonMCPs: Map<string, PhotonMCPInstance>,
  onProgress?: (photon: string, method: string, progress: any) => void
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
