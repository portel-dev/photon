/**
 * MCP WebSocket Server Transport
 *
 * Implements the MCP Transport interface for WebSocket connections.
 * Allows Beam to expose MCP server over WebSocket for real-time bidirectional communication.
 */

import type { WebSocket } from 'ws';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * Transport send options
 */
interface TransportSendOptions {
  relatedRequestId?: string | number;
  resumptionToken?: string;
  onresumptiontoken?: (token: string) => void;
}

/**
 * MCP Transport interface (matches @modelcontextprotocol/sdk)
 */
export interface Transport {
  start(): Promise<void>;
  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;
}

/**
 * WebSocket Server Transport for MCP
 *
 * Wraps a WebSocket connection to implement the MCP Transport interface.
 * Each connected client gets its own transport instance.
 */
export class WebSocketServerTransport implements Transport {
  private ws: WebSocket;
  private _sessionId: string;
  private _started = false;
  private messageQueue: string[] = [];

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(ws: WebSocket, sessionId?: string) {
    this.ws = ws;
    this._sessionId = sessionId || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Set up WebSocket event handlers
    this.ws.on('message', (data: Buffer | string) => {
      try {
        const message = JSON.parse(data.toString()) as JSONRPCMessage;

        if (this._started && this.onmessage) {
          this.onmessage(message);
        } else {
          // Queue messages received before start()
          this.messageQueue.push(data.toString());
        }
      } catch (error) {
        if (this.onerror) {
          this.onerror(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });

    this.ws.on('close', () => {
      if (this.onclose) {
        this.onclose();
      }
    });

    this.ws.on('error', (error: Error) => {
      if (this.onerror) {
        this.onerror(error);
      }
    });
  }

  get sessionId(): string {
    return this._sessionId;
  }

  async start(): Promise<void> {
    this._started = true;

    // Process any queued messages
    for (const data of this.messageQueue) {
      try {
        const message = JSON.parse(data) as JSONRPCMessage;
        if (this.onmessage) {
          this.onmessage(message);
        }
      } catch (error) {
        if (this.onerror) {
          this.onerror(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
    this.messageQueue = [];
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.ws.readyState !== this.ws.OPEN) {
      throw new Error('WebSocket is not open');
    }

    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }

    if (this.onclose) {
      this.onclose();
    }
  }
}

/**
 * Check if a message is a valid JSON-RPC 2.0 message
 */
export function isJSONRPCMessage(data: unknown): data is JSONRPCMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;
  return msg.jsonrpc === '2.0';
}

/**
 * Check if a message is an MCP request (has method and id)
 */
export function isMCPRequest(msg: JSONRPCMessage): boolean {
  return 'method' in msg && 'id' in msg;
}

/**
 * Check if a message is an MCP notification (has method but no id)
 */
export function isMCPNotification(msg: JSONRPCMessage): boolean {
  return 'method' in msg && !('id' in msg);
}

/**
 * Check if a message is an MCP response (has result or error, and id)
 */
export function isMCPResponse(msg: JSONRPCMessage): boolean {
  return ('result' in msg || 'error' in msg) && 'id' in msg;
}
