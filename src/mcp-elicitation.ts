/**
 * MCP Elicitation Support
 * 
 * Maps Photon's yield-based asks to MCP's elicitation protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// JSONSchema type - using Record<string, any> for schema objects
type JSONSchema = Record<string, any>;

/**
 * Elicitation request following MCP spec
 */
export interface ElicitationRequest {
  message: string;
  requestedSchema: JSONSchema;
}

/**
 * Elicitation response following MCP spec
 */
export interface ElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: any;
}

/**
 * Registers MCP elicitation handlers on a server
 */
export function registerElicitationHandlers(server: Server) {
  // Note: The elicitation flow is client-initiated in MCP
  // The server doesn't directly call elicitation/create
  // Instead, when a tool execution needs user input (via yield),
  // it must be handled at the transport level or through a callback mechanism
  
  // For now, this is a placeholder for future elicitation protocol support
  // The actual implementation needs to integrate with the SDK's capabilities
}

/**
 * Helper to convert a Photon ask yield to an MCP elicitation request
 */
export function createElicitationRequest(
  message: string,
  schema: JSONSchema
): ElicitationRequest {
  return {
    message,
    requestedSchema: schema
  };
}

/**
 * Helper to validate elicitation response
 */
export function validateElicitationResponse(
  response: ElicitationResponse,
  schema: JSONSchema
): boolean {
  if (response.action !== 'accept') {
    return true; // decline/cancel don't need validation
  }
  
  // TODO: Implement JSON schema validation
  return true;
}
