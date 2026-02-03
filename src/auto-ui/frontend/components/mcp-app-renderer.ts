/**
 * MCP App Renderer - Displays MCP Apps Extension UIs in iframes
 *
 * This component renders MCP Apps from external MCPs (those configured in
 * ~/.photon/config.json mcpServers section that have ui:// resources).
 *
 * MCP Apps are self-contained HTML applications that communicate with the
 * host using the MCP Apps Extension postMessage protocol.
 *
 * @see https://modelcontextprotocol.github.io/ext-apps/api/
 */
import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { mcpClient } from '../services/mcp-client.js';

@customElement('mcp-app-renderer')
export class McpAppRenderer extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 500px;
        background: var(--bg-panel, #0d0d0d);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: none;
        display: block;
        opacity: 0;
        transition: opacity 0.15s ease-in;
      }

      iframe.ready {
        opacity: 1;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--t-muted);
        background: var(--bg-panel);
      }

      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-md);
        height: 100%;
        background: var(--bg-glass);
        color: var(--t-primary);
        padding: var(--space-lg);
        text-align: center;
      }

      .error-icon {
        font-size: 3rem;
        opacity: 0.5;
      }

      .error-message {
        color: #f87171;
        font-size: 0.9rem;
        max-width: 400px;
      }

      .retry-btn {
        background: var(--accent-primary);
        color: white;
        border: none;
        padding: var(--space-sm) var(--space-lg);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-weight: 500;
        transition: opacity 0.2s;
      }

      .retry-btn:hover {
        opacity: 0.9;
      }
    `,
  ];

  /** External MCP name (from config.json mcpServers key) */
  @property({ type: String }) mcpName = '';

  /** MCP App resource URI (ui:// scheme) */
  @property({ type: String }) appUri = '';

  /** Current theme */
  @property({ type: String }) theme: Theme = 'dark';

  @state() private _srcDoc = '';
  @state() private _loading = true;
  @state() private _error = '';
  private _iframeRef: HTMLIFrameElement | null = null;
  private _messageHandler: ((e: MessageEvent) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    // Listen for messages from the MCP App iframe
    this._messageHandler = this._handleIframeMessage.bind(this);
    window.addEventListener('message', this._messageHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
    }
    // Fire-and-forget teardown
    this.teardown().catch(() => {});
  }

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('mcpName') || changedProperties.has('appUri')) {
      this._loadContent();
    }

    // Notify iframe of theme change
    if (changedProperties.has('theme') && this._iframeRef?.contentWindow) {
      const themeTokens = getThemeTokens(this.theme);
      this._iframeRef.contentWindow.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: {
            theme: this.theme,
            styles: { variables: themeTokens },
          },
        },
        '*'
      );
    }
  }

  private async _loadContent() {
    if (!this.mcpName || !this.appUri) return;

    this._loading = true;
    this._error = '';
    this._srcDoc = '';

    try {
      // Fetch MCP App HTML from the backend endpoint
      const url = `/api/mcp-app?mcp=${encodeURIComponent(this.mcpName)}&uri=${encodeURIComponent(this.appUri)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Failed to load MCP App: ${res.statusText} - ${errorBody}`);
      }

      this._srcDoc = await res.text();
    } catch (e: any) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  private _handleIframeLoad(e: Event) {
    const iframe = e.target as HTMLIFrameElement;
    this._iframeRef = iframe;
    iframe.classList.add('ready');

    // Send ui/initialize message to the MCP App
    const themeTokens = getThemeTokens(this.theme);
    iframe.contentWindow?.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/initialize',
        params: {
          hostContext: {
            name: 'Photon Beam',
            version: '1.0.0',
            theme: this.theme,
            styles: { variables: themeTokens },
          },
          hostCapabilities: {
            toolCalling: true,
            resourceReading: true,
            elicitation: false,
          },
          containerDimensions: {
            mode: 'responsive',
            width: iframe.clientWidth,
            height: iframe.clientHeight,
          },
          theme: themeTokens,
        },
      },
      '*'
    );
  }

  /**
   * Handle messages from the MCP App iframe
   * Implements MCP Apps Extension protocol
   */
  private async _handleIframeMessage(e: MessageEvent) {
    // Check if the message comes from our iframe
    const iframe = this.shadowRoot?.querySelector('iframe');
    if (!iframe || e.source !== iframe.contentWindow) {
      return;
    }

    // Update iframe ref if it changed (can happen with srcdoc)
    if (this._iframeRef !== iframe) {
      this._iframeRef = iframe;
    }

    const msg = e.data;
    if (!msg?.jsonrpc || msg.jsonrpc !== '2.0') return;

    // Handle app's ui/initialize request (app announcing itself)
    if (msg.method === 'ui/initialize' && msg.id !== undefined) {
      this._iframeRef.contentWindow?.postMessage(
        {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: {
              name: 'Photon Beam',
              version: '1.0.0',
            },
            hostCapabilities: {
              toolCalling: true,
              resourceReading: true,
              elicitation: false,
            },
            hostContext: {
              theme: this.theme,
            },
          },
        },
        '*'
      );
      return;
    }

    // Handle tool call requests from the MCP App
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};
      try {
        // Call the tool through the MCP client
        // The tool name should include the MCP server prefix
        const fullToolName = name.includes('/') ? name : `${this.mcpName}/${name}`;
        const result = await mcpClient.callTool(fullToolName, args || {});

        // Send result back to iframe
        this._iframeRef.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: result.content,
              structuredContent: result.structuredContent,
              isError: result.isError,
            },
          },
          '*'
        );

        // Also send as notification for ontoolresult handler
        this._iframeRef.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: {
              toolName: name,
              result: result.structuredContent || result.content,
            },
          },
          '*'
        );
      } catch (error: any) {
        this._iframeRef.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32000,
              message: error.message || 'Tool call failed',
            },
          },
          '*'
        );
      }
    }

    // Handle resource read requests
    if (msg.method === 'resources/read') {
      const { uri } = msg.params || {};
      try {
        const resource = await mcpClient.readResource(uri);
        this._iframeRef.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            id: msg.id,
            result: resource,
          },
          '*'
        );
      } catch (error: any) {
        this._iframeRef.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32000,
              message: error.message || 'Resource read failed',
            },
          },
          '*'
        );
      }
    }
  }

  /**
   * Send ui/resource-teardown to iframe and wait for response
   */
  async teardown(): Promise<void> {
    if (!this._iframeRef?.contentWindow) return;

    const callId = `teardown_${Date.now()}`;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg?.jsonrpc === '2.0' && msg?.id === callId && !msg.method) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve();
        }
      };
      window.addEventListener('message', handler);

      this._iframeRef!.contentWindow!.postMessage(
        { jsonrpc: '2.0', id: callId, method: 'ui/resource-teardown', params: {} },
        '*'
      );
    });
  }

  /**
   * Send a tool result to the MCP App (e.g., after invoking a tool)
   */
  sendToolResult(toolName: string, result: any) {
    if (!this._iframeRef?.contentWindow) return;

    this._iframeRef.contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: {
          toolName,
          result,
        },
      },
      '*'
    );
  }

  render() {
    if (this._error) {
      return html`
        <div class="error-container">
          <div class="error-icon">⚠️</div>
          <div class="error-message">${this._error}</div>
          <button class="retry-btn" @click=${this._loadContent}>Retry</button>
        </div>
      `;
    }

    if (this._loading) {
      return html`<div class="loading">Loading MCP App...</div>`;
    }

    return html`
      <iframe
        srcdoc=${this._srcDoc}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
        @load=${this._handleIframeLoad}
      ></iframe>
    `;
  }
}
