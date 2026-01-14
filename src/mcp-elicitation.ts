/**
 * MCP Elicitation Support
 *
 * Maps Photon's yield-based asks to MCP's elicitation protocol.
 *
 * As of MCP SDK 1.25, elicitation is handled via:
 * - Server.elicitInput() - Server requests user input from client
 * - Client declares { elicitation: {} } capability during initialization
 *
 * The actual integration is in server.ts:
 * - createMCPInputProvider() creates an input provider that uses elicitInput()
 * - This is passed to loader.executeTool() for generator-based tools
 *
 * @see https://forgecode.dev/blog/mcp-spec-updates/
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Check if a client supports MCP elicitation
 *
 * @param server - MCP server instance
 * @returns true if client declared elicitation capability
 */
export function clientSupportsElicitation(server: Server): boolean {
  const capabilities = server.getClientCapabilities();
  return !!(capabilities as any)?.elicitation;
}

/**
 * Elicitation action type from MCP spec
 */
export type ElicitAction = 'accept' | 'decline' | 'cancel';

/**
 * Re-export types for convenience
 */
export type { ElicitResult, ElicitRequestFormParams, ElicitRequestURLParams } from '@modelcontextprotocol/sdk/types.js';
