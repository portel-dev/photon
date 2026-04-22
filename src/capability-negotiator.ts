/**
 * CapabilityNegotiator — client capability detection and negotiation
 *
 * Encapsulates the logic for detecting what an MCP client supports
 * (UI rendering, elicitation, etc.) based on the initialize handshake.
 *
 * The MCP SDK's Zod schema strips unknown fields like `extensions`
 * (protocol 2025-11-25+), so we also capture raw capabilities from
 * the JSON-RPC initialize message before Zod parsing occurs.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const MCP_UI_CAPABILITY = 'io.modelcontextprotocol/ui';

export class CapabilityNegotiator {
  /**
   * Raw client capabilities captured from the initialize request BEFORE Zod parsing.
   *
   * The MCP SDK uses Zod to validate incoming requests, which strips unknown fields
   * from ClientCapabilities. Notably, `extensions` (protocol 2025-11-25+) is not in
   * the SDK's Zod schema yet, so `getClientCapabilities()` returns an object without
   * it. Real clients like Claude Desktop and ChatGPT send UI capability under
   * `extensions`, not `experimental`. We intercept the raw JSON-RPC message to
   * capture the full capabilities before Zod strips them.
   *
   * Key: Server instance → Value: raw capabilities object from initialize request
   */
  private rawClientCapabilities = new WeakMap<Server, Record<string, any>>();

  /**
   * Store raw capabilities for a server instance.
   * Called from the transport message interceptor.
   */
  setRawCapabilities(server: Server, capabilities: Record<string, any>): void {
    this.rawClientCapabilities.set(server, capabilities);
  }

  /**
   * Check if client supports MCP Apps UI (structuredContent + _meta.ui)
   *
   * Looks for the "io.modelcontextprotocol/ui" capability in the client's
   * initialize handshake. Any MCP client that advertises this capability
   * gets rich UI responses — Claude Desktop, ChatGPT, MCPJam, etc.
   *
   * The capability may appear under `experimental` (older SDK types) or
   * `extensions` (protocol version 2025-11-25+). We check both so it
   * just works regardless of which field the client uses.
   *
   * Beam is special-cased because it's our own SSE transport where the
   * capability is implicit.
   */
  supportsUI(server: Server): boolean {
    // Check SDK-parsed capabilities (works for `experimental` which is in the Zod schema)
    const capabilities = server.getClientCapabilities() as Record<string, any>;
    if (capabilities?.experimental?.[MCP_UI_CAPABILITY]) {
      return true;
    }

    // Check raw capabilities captured before Zod parsing (needed for `extensions`
    // which the SDK's Zod schema strips — Claude Desktop and ChatGPT use this field)
    const raw = this.rawClientCapabilities.get(server);
    if (raw?.extensions?.[MCP_UI_CAPABILITY]) {
      return true;
    }

    // Beam is our own transport — UI support is implicit
    const clientInfo = server.getClientVersion();
    if (clientInfo?.name === 'beam') return true;

    return false;
  }

  /**
   * Check if client supports elicitation
   *
   * Elicitation is a client capability declared during initialization.
   * The server can use elicitInput() when the client supports it.
   */
  supportsElicitation(server: Server): boolean {
    const capabilities = server.getClientCapabilities();

    if (!capabilities) {
      return false;
    }

    // Check for elicitation capability (MCP 2025-06 spec)
    return !!capabilities.elicitation;
  }

  /**
   * Check if client supports sampling (server-driven LLM requests).
   *
   * Sampling is a client capability declared during initialization.
   * When present, the server can call `createMessage()` on the client
   * to ask its LLM to generate text — used by photons that call
   * `this.sample()` to delegate inference to the caller's model.
   */
  supportsSampling(server: Server): boolean {
    const capabilities = server.getClientCapabilities();
    if (!capabilities) return false;
    return !!capabilities.sampling;
  }

  /**
   * Intercept a transport to capture raw client capabilities before Zod strips them.
   *
   * The MCP SDK's Zod schema for ClientCapabilities doesn't include `extensions`
   * (protocol 2025-11-25+), so getClientCapabilities() returns an object without it.
   * We intercept the transport's onmessage to capture the raw `initialize` request
   * and store capabilities before Zod parsing occurs.
   *
   * @param onMessage Optional additional message interceptor (e.g. for channel permissions)
   */
  interceptTransportForRawCapabilities(
    transport: { onmessage?: (...args: any[]) => void },
    targetServer: Server,
    onMessage?: (message: any) => void
  ): void {
    const origOnMessage = transport.onmessage;
    transport.onmessage = (message: any, extra?: any) => {
      // Capture raw capabilities from initialize request
      if (message?.method === 'initialize' && message?.params) {
        if (message.params.capabilities) {
          this.rawClientCapabilities.set(targetServer, message.params.capabilities);
        }
      }
      // Call additional interceptor if provided
      onMessage?.(message);
      origOnMessage?.(message, extra);
    };
  }
}
