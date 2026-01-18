/**
 * PhotonHost - Host-side manager for custom UI iframes
 *
 * Manages communication between the Photon runtime and custom UI components
 * rendered in iframes. Handles:
 * - Sending emit/progress events to the UI
 * - Routing elicitation requests and collecting responses
 * - Tool invocations from the UI
 *
 * Usage:
 *   const host = new PhotonHost(iframe, { photon: 'demo', method: 'search' });
 *   host.sendEmit({ emit: 'progress', value: 0.5, message: 'Loading...' });
 *   const response = await host.askElicitation({ ask: 'text', message: 'Name?' });
 */

// Browser globals for host-side code (runs in playground/ChatGPT host)
 
declare const window: {
  addEventListener(type: string, listener: (event: { data: any; source: any }) => void): void;
  removeEventListener(type: string, listener: (event: { data: any; source: any }) => void): void;
};

interface HTMLIFrameElement {
  contentWindow: { postMessage(message: any, targetOrigin: string): void } | null;
}

import type {
  HostToUIMessage,
  UIToHostMessage,
  EmitEvent,
  AskEvent,
  PhotonContext,
} from './photon-bridge.js';
import { getThemeTokens } from './design-system/tokens.js';
import {
  createMcpAppsInitialize,
  createThemeChangeMessages,
  type PlatformContext,
} from './platform-compat.js';

export interface PhotonHostOptions {
  photon: string;
  method: string;
  toolInput: Record<string, any>;
  theme?: 'light' | 'dark';
  locale?: string;
  displayMode?: 'inline' | 'fullscreen' | 'modal';
  hostName?: string;
  hostVersion?: string;
  onCallTool?: (toolName: string, args: Record<string, any>) => Promise<any>;
  onFollowUp?: (message: string) => void;
  onStateChange?: (state: any) => void;
}

/**
 * PhotonHost manages the host side of the photon bridge communication.
 * Create one instance per custom UI iframe.
 */
export class PhotonHost {
  private iframe: HTMLIFrameElement;
  private context: PhotonContext;
  private platformContext: PlatformContext;
  private toolInput: Record<string, any>;
  private pendingElicitations = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }
  >();
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private messageHandler: (event: any) => void;
  private options: PhotonHostOptions;

  constructor(iframe: HTMLIFrameElement, options: PhotonHostOptions) {
    this.iframe = iframe;
    this.options = options;
    this.toolInput = options.toolInput;

    const theme = options.theme || 'dark';

    this.context = {
      photon: options.photon,
      method: options.method,
      theme,
      locale: options.locale || 'en-US',
    };

    this.platformContext = {
      theme,
      locale: options.locale || 'en-US',
      displayMode: options.displayMode || 'inline',
      photon: options.photon,
      method: options.method,
      hostName: options.hostName || 'beam',
      hostVersion: options.hostVersion || '1.5.0',
    };

    // Create ready promise
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Set up message handler
    this.messageHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Wait for the iframe UI to be ready
   */
  async waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Initialize the bridge - call after iframe loads
   * Sends initialization messages for all supported platforms:
   * - MCP Apps Extension (JSON-RPC ui/initialize)
   * - Photon Bridge (photon:init)
   * - OpenAI Apps SDK compatible (openai:set_globals)
   */
  initialize(): void {
    const themeTokens = getThemeTokens(this.context.theme);

    // 1. Send Photon Bridge init (with theme tokens)
    this.send({
      type: 'photon:init',
      context: this.context,
      toolInput: this.toolInput,
      themeTokens,
    } as any);

    // 2. Send MCP Apps Extension ui/initialize (JSON-RPC)
    const mcpInit = createMcpAppsInitialize(this.platformContext, {
      width: 800,
      height: 600,
    });
    this.sendRaw(mcpInit);

    // 3. Send OpenAI Apps SDK set_globals event
    this.sendRaw({
      type: 'openai:set_globals',
      theme: this.context.theme,
      displayMode: this.platformContext.displayMode,
      locale: this.context.locale,
      toolInput: this.toolInput,
    });
  }

  /**
   * Send an emit event (progress, status, stream) to the UI
   */
  sendEmit(event: EmitEvent): void {
    this.send({ type: 'photon:emit', event });
  }

  /**
   * Send a progress event
   */
  sendProgress(value: number, message?: string): void {
    this.sendEmit({ emit: 'progress', value, message });
  }

  /**
   * Send a status message
   */
  sendStatus(message: string): void {
    this.sendEmit({ emit: 'status', message });
  }

  /**
   * Request user input via elicitation
   * Returns a promise that resolves with the user's response
   */
  async askElicitation(ask: AskEvent): Promise<any> {
    const id = Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
      this.pendingElicitations.set(id, { resolve, reject });

      this.send({
        type: 'photon:ask',
        id,
        event: ask,
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingElicitations.has(id)) {
          this.pendingElicitations.delete(id);
          reject(new Error('Elicitation timeout'));
        }
      }, 300000);
    });
  }

  /**
   * Send the final result to the UI
   */
  sendResult(data: any): void {
    this.send({ type: 'photon:result', data });
  }

  /**
   * Send an error to the UI
   */
  sendError(message: string, code?: string): void {
    this.send({ type: 'photon:error', error: { message, code } });
  }

  /**
   * Update context (theme, locale, etc.)
   * Sends updates to all supported platforms.
   */
  updateContext(context: Partial<PhotonContext>): void {
    Object.assign(this.context, context);
    Object.assign(this.platformContext, context);

    // Send Photon context update with theme tokens if theme changed
    if (context.theme) {
      const themeTokens = getThemeTokens(context.theme);
      this.send({
        type: 'photon:context',
        context,
        themeTokens,
      } as any);

      // Send to all platforms
      const messages = createThemeChangeMessages(context.theme);
      messages.forEach((msg) => this.sendRaw(msg));
    } else {
      this.send({ type: 'photon:context', context });
    }
  }

  /**
   * Update theme across all platforms
   */
  setTheme(theme: 'light' | 'dark'): void {
    this.updateContext({ theme });
  }

  /**
   * Clean up - remove message listener
   */
  destroy(): void {
    window.removeEventListener('message', this.messageHandler);
    this.pendingElicitations.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

  private send(message: HostToUIMessage): void {
    if (this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(message, '*');
    }
  }

  private sendRaw(message: any): void {
    if (this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(message, '*');
    }
  }

  private handleMessage(event: any): void {
    // Only handle messages from our iframe
    if (event.source !== this.iframe.contentWindow) return;

    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    // ─────────────────────────────────────────────────────────────────────────
    // Handle MCP Apps Extension JSON-RPC messages
    // ─────────────────────────────────────────────────────────────────────────
    if (msg.jsonrpc === '2.0') {
      if (msg.method === 'ui/ready') {
        this.isReady = true;
        this.readyResolve();
        this.initialize();
      } else if (msg.method === 'tools/call' && this.options.onCallTool) {
        this.options
          .onCallTool(msg.params.name, msg.params.arguments)
          .then((result) => {
            this.sendRaw({
              jsonrpc: '2.0',
              id: msg.id,
              result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
            });
          })
          .catch((error) => {
            this.sendRaw({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32000, message: error.message },
            });
          });
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Handle Photon Bridge messages
    // ─────────────────────────────────────────────────────────────────────────
    if (typeof msg.type !== 'string' || !msg.type.startsWith('photon:')) return;

    switch (msg.type) {
      case 'photon:ready':
        this.isReady = true;
        this.readyResolve();
        // Send init after ready
        this.initialize();
        break;

      case 'photon:ask-response':
        const pending = this.pendingElicitations.get(msg.id);
        if (pending) {
          this.pendingElicitations.delete(msg.id);
          pending.resolve(msg.value);
        }
        break;

      case 'photon:call-tool':
        if (this.options.onCallTool) {
          this.options
            .onCallTool(msg.toolName, msg.args)
            .then((result) => {
              this.send({
                type: 'photon:call-tool-response' as any,
                callId: msg.callId,
                result,
              });
            })
            .catch((error) => {
              this.send({
                type: 'photon:call-tool-response' as any,
                callId: msg.callId,
                error: error.message,
              });
            });
        }
        break;

      case 'photon:set-state':
        if (this.options.onStateChange) {
          this.options.onStateChange(msg.state);
        }
        break;

      case 'photon:follow-up':
        if (this.options.onFollowUp) {
          this.options.onFollowUp(msg.message);
        }
        break;
    }
  }
}

/**
 * Create an OutputHandler that forwards events to a PhotonHost
 */
export function createHostOutputHandler(host: PhotonHost) {
  return (yieldValue: any) => {
    if (yieldValue && typeof yieldValue === 'object' && 'emit' in yieldValue) {
      host.sendEmit(yieldValue);
    }
  };
}

/**
 * Create an InputProvider that uses PhotonHost for elicitations
 */
export function createHostInputProvider(host: PhotonHost) {
  return async (ask: any): Promise<any> => {
    return host.askElicitation(ask);
  };
}
