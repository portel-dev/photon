/**
 * MCP App Renderer - Displays MCP Apps Extension UIs in iframes
 *
 * This component renders MCP Apps from external MCPs (those configured in
 * ~/.photon/config.json mcpServers section that have ui:// resources).
 *
 * Uses the official AppBridge + PostMessageTransport from @modelcontextprotocol/ext-apps
 * for spec-compliant communication with MCP App iframes.
 *
 * @see https://modelcontextprotocol.github.io/ext-apps/api/
 */
import { LitElement, html, css, PropertyValueMap, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { mcpClient } from '../services/mcp-client.js';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

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
  private _bridge: AppBridge | null = null;
  private _transport: PostMessageTransport | null = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    // Fire-and-forget teardown
    this.teardown().catch(() => {});
  }

  protected willUpdate(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    // Send theme change to the app via AppBridge — no iframe recreation needed
    if (changedProperties.has('theme') && this._bridge) {
      const themeTokens = getThemeTokens(this.theme);
      this._bridge.setHostContext({
        theme: this.theme,
        styles: { variables: themeTokens },
      });
    }
  }

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('mcpName') || changedProperties.has('appUri')) {
      this._loadContent();
    }
  }

  private async _loadContent() {
    if (!this.mcpName || !this.appUri) return;

    this._loading = true;
    this._error = '';
    this._srcDoc = '';

    // Tear down previous bridge
    if (this._bridge) {
      await this.teardown().catch(() => {});
      this._bridge = null;
      this._transport = null;
    }

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

  /**
   * Set up AppBridge when iframe loads
   */
  private _handleIframeLoad(e: Event) {
    const iframe = e.target as HTMLIFrameElement;
    iframe.classList.add('ready');

    if (!iframe.contentWindow) return;

    // Create AppBridge with null client — MCP client lives on backend, not browser
    const themeTokens = getThemeTokens(this.theme);
    this._bridge = new AppBridge(
      null,
      { name: 'Photon Beam', version: '1.0.0' },
      { serverTools: {}, logging: {} },
      {
        hostContext: {
          theme: this.theme,
          styles: { variables: themeTokens },
        },
      }
    );

    // Handle tool calls from the app — forward to our SSE-based mcpClient
    this._bridge.oncalltool = async (params) => {
      const toolName = `${this.mcpName}/${params.name}`;
      const mcpResult = await mcpClient.callTool(toolName, params.arguments || {});
      return {
        content: mcpResult.content || [],
        structuredContent: mcpResult.structuredContent,
        isError: mcpResult.isError ?? false,
      };
    };

    // Handle resource reads from the app
    this._bridge.onreadresource = async (params) => {
      const resource = await mcpClient.readResource(params.uri);
      return {
        contents: resource ? [resource] : [],
      };
    };

    // Auto-invoke linked tool when the app signals it's initialized
    this._bridge.oninitialized = () => {
      if (this.linkedTool) {
        this._autoInvokeLinkedTool();
      }
    };

    // Create PostMessageTransport pointing at iframe's contentWindow
    this._transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);

    // Connect bridge to transport
    this._bridge.connect(this._transport).catch((err) => {
      console.error('AppBridge connect failed:', err);
    });
  }

  /**
   * Send ui/resource-teardown to the app and close bridge
   */
  async teardown(): Promise<void> {
    if (!this._bridge) return;
    try {
      await this._bridge.teardownResource({}, { timeout: 3000 });
    } catch {
      // Teardown is best-effort
    }
    await this._transport?.close().catch(() => {});
    this._bridge = null;
    this._transport = null;
  }

  /**
   * Send a tool result to the MCP App (e.g., after invoking a tool)
   */
  sendToolResult(toolName: string, result: any) {
    if (!this._bridge) return;
    this._bridge.sendToolResult({
      content: result.content || [],
      structuredContent: result.structuredContent,
      isError: result.isError ?? false,
    });
  }

  /**
   * Auto-invoke the linked tool to provide initial data to the MCP App
   * This is needed for apps that expect an initial tool result on load
   */
  private async _autoInvokeLinkedTool() {
    if (!this.linkedTool || !this._bridge) return;

    try {
      const fullToolName = `${this.mcpName}/${this.linkedTool}`;
      const result = await mcpClient.callTool(fullToolName, {});

      // Send result to app via AppBridge
      this._bridge.sendToolResult({
        content: result.content,
        structuredContent: result.structuredContent,
        isError: result.isError,
      });
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

    return html`
      <iframe
        srcdoc=${this._srcDoc}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
        @load=${this._handleIframeLoad}
      ></iframe>
    `;
  }
}
