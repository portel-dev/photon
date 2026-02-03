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
import { LitElement, html, css, PropertyValueMap, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
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

  /** Linked tool name to auto-invoke on load (provides initial data to app) */
  @property({ type: String }) linkedTool = '';

  /** Current theme */
  @property({ type: String }) theme: Theme = 'dark';

  @state() private _srcDoc = '';
  @state() private _loading = true;
  @state() private _error = '';
  private _iframeRef: HTMLIFrameElement | null = null;
  private _messageHandler: ((e: MessageEvent) => void) | null = null;
  private _hasAutoInvoked = false;

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

  protected willUpdate(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    // Update srcDoc with new color-scheme BEFORE render so keyed directive uses correct content
    if (changedProperties.has('theme') && this._srcDoc) {
      this._srcDoc = this._updateThemeInSrcDoc(this._srcDoc);
      this._hasAutoInvoked = false; // Allow re-invocation after reload
    }
  }

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('mcpName') || changedProperties.has('appUri')) {
      this._loadContent();
    }
  }

  /**
   * Update theme injection in existing srcDoc HTML
   * Strips old injection and re-injects with new theme
   */
  private _updateThemeInSrcDoc(html: string): string {
    // Strip existing theme injection
    let cleanHtml = html
      .replace(/<script id="__beam-theme-script">[\s\S]*?<\/script>/, '')
      .replace(/<style id="__beam-theme">[^<]*<\/style>/, '');

    // Re-inject with current theme
    return this._injectThemeStyles(cleanHtml);
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

      this._srcDoc = this._injectThemeStyles(await res.text());
    } catch (e: any) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Inject theme overrides into srcdoc:
   * 1. CSS color-scheme property
   * 2. matchMedia override so apps using window.matchMedia get the correct theme
   */
  private _injectThemeStyles(html: string): string {
    const colorScheme = this.theme === 'light' ? 'light' : 'dark';
    const isDark = this.theme !== 'light';

    // Override matchMedia to return host theme for prefers-color-scheme queries
    // Uses Object.defineProperty because MediaQueryList.matches is a read-only getter
    const themeScript = `<script id="__beam-theme-script">
(function() {
  const hostTheme = '${colorScheme}';
  const isDark = ${isDark};
  const origMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function(query) {
    const mql = origMatchMedia(query);
    if (query.includes('prefers-color-scheme')) {
      const wantsDark = query.includes('dark');
      const proxy = Object.create(mql);
      Object.defineProperty(proxy, 'matches', { value: wantsDark ? isDark : !isDark, configurable: true });
      Object.defineProperty(proxy, 'media', { value: query, configurable: true });
      proxy.addEventListener = mql.addEventListener.bind(mql);
      proxy.removeEventListener = mql.removeEventListener.bind(mql);
      if (mql.addListener) proxy.addListener = mql.addListener.bind(mql);
      if (mql.removeListener) proxy.removeListener = mql.removeListener.bind(mql);
      return proxy;
    }
    return mql;
  };
})();
</script>`;
    const styleTag = `<style id="__beam-theme">:root { color-scheme: ${colorScheme}; }</style>`;
    const injection = themeScript + styleTag;

    // Insert after <head> tag - regular scripts run synchronously before type="module" scripts
    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${injection}`);
    } else if (html.includes('<head ')) {
      return html.replace(/<head[^>]*>/, (match) => `${match}${injection}`);
    }
    // Fallback: insert after DOCTYPE or at start
    if (html.includes('<!DOCTYPE') || html.includes('<!doctype')) {
      return html.replace(/<!DOCTYPE[^>]*>/i, (match) => `${match}${injection}`);
    }
    return injection + html;
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

      // Auto-invoke the linked tool to provide initial data to the app
      // This is needed for MCP Apps that expect an initial tool result on load
      // Delay slightly to ensure the app has fully initialized
      if (this.linkedTool && !this._hasAutoInvoked) {
        this._hasAutoInvoked = true;
        setTimeout(() => this._autoInvokeLinkedTool(), 100);
      }
      return;
    }

    // Note: tools/call is handled by BeamApp._handleBridgeMessage (beam-app.ts)
    // which returns proper CallToolResult format for external MCPs

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

  /**
   * Auto-invoke the linked tool to provide initial data to the MCP App
   * This is needed for apps that expect an initial tool result on load
   */
  private async _autoInvokeLinkedTool() {
    if (!this.linkedTool || !this._iframeRef?.contentWindow) return;

    try {
      const fullToolName = `${this.mcpName}/${this.linkedTool}`;
      const result = await mcpClient.callTool(fullToolName, {});

      // Send result to app via ontoolresult notification
      // Per MCP Apps spec, params is CallToolResult directly (not wrapped)
      this._iframeRef.contentWindow.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {
            content: result.content,
            structuredContent: result.structuredContent,
            isError: result.isError,
          },
        },
        '*'
      );
    } catch (error) {
      console.error('Failed to auto-invoke linked tool:', error);
    }
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

    // Use keyed directive to force iframe recreation when theme changes
    // This ensures apps using matchMedia get the correct color-scheme on reload
    return keyed(
      this.theme,
      html`
        <iframe
          srcdoc=${this._srcDoc}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
          @load=${this._handleIframeLoad}
        ></iframe>
      `
    );
  }
}
