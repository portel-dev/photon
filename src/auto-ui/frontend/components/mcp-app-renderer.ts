/**
 * MCP App Renderer - Unified UI Bridge Architecture
 *
 * This component renders MCP Apps from external MCPs (those configured in
 * ~/.photon/config.json mcpServers section that have ui:// resources).
 *
 * Uses the official AppBridge + PostMessageTransport from @modelcontextprotocol/ext-apps
 * for spec-compliant communication with MCP App iframes. Beam is just another MCP Apps host.
 *
 * Custom Photon notifications (JSON-RPC):
 * - photon/notifications/progress: Progress updates from photon methods
 * - photon/notifications/status: Status updates
 * - photon/notifications/stream: Streaming data chunks
 * - photon/notifications/emit: Custom events
 *
 * @see https://modelcontextprotocol.github.io/ext-apps/api/
 */
import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { mcpClient } from '../services/mcp-client.js';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

/**
 * Filter theme tokens to only include keys valid per the MCP Apps Extension spec.
 * AppBridge validates styles.variables via Zod and rejects unrecognized keys.
 */
const VALID_STYLE_KEYS = new Set([
  // Background colors
  '--color-background-primary',
  '--color-background-secondary',
  '--color-background-tertiary',
  '--color-background-inverse',
  '--color-background-ghost',
  '--color-background-info',
  '--color-background-danger',
  '--color-background-success',
  '--color-background-warning',
  '--color-background-disabled',
  // Text colors
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-inverse',
  '--color-text-ghost',
  '--color-text-info',
  '--color-text-danger',
  '--color-text-success',
  '--color-text-warning',
  '--color-text-disabled',
  // Border colors
  '--color-border-primary',
  '--color-border-secondary',
  '--color-border-tertiary',
  '--color-border-inverse',
  '--color-border-ghost',
  '--color-border-info',
  '--color-border-danger',
  '--color-border-success',
  '--color-border-warning',
  '--color-border-disabled',
  // Ring colors
  '--color-ring-primary',
  '--color-ring-secondary',
  '--color-ring-inverse',
  '--color-ring-info',
  '--color-ring-danger',
  '--color-ring-success',
  '--color-ring-warning',
  // Typography
  '--font-sans',
  '--font-mono',
  '--font-weight-normal',
  '--font-weight-medium',
  '--font-weight-semibold',
  '--font-weight-bold',
  '--font-text-xs-size',
  '--font-text-sm-size',
  '--font-text-md-size',
  '--font-text-lg-size',
  '--font-heading-xs-size',
  '--font-heading-sm-size',
  '--font-heading-md-size',
  '--font-heading-lg-size',
  '--font-heading-xl-size',
  '--font-heading-2xl-size',
  '--font-heading-3xl-size',
  '--font-text-xs-line-height',
  '--font-text-sm-line-height',
  '--font-text-md-line-height',
  '--font-text-lg-line-height',
  '--font-heading-xs-line-height',
  '--font-heading-sm-line-height',
  '--font-heading-md-line-height',
  '--font-heading-lg-line-height',
  '--font-heading-xl-line-height',
  '--font-heading-2xl-line-height',
  '--font-heading-3xl-line-height',
  // Border radius
  '--border-radius-xs',
  '--border-radius-sm',
  '--border-radius-md',
  '--border-radius-lg',
  '--border-radius-xl',
  '--border-radius-full',
  // Border width
  '--border-width-regular',
  // Shadows
  '--shadow-hairline',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
]);

function filterSpecVariables(tokens: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (VALID_STYLE_KEYS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

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
        font-size: var(--text-3xl);
        opacity: 0.5;
      }

      .error-message {
        color: var(--color-error);
        font-size: var(--text-md);
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

      .app-container {
        width: 100%;
        height: 100%;
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
      const themeTokens = filterSpecVariables(getThemeTokens(this.theme));
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

      let htmlContent = await res.text();

      // For photon-based external MCPs with a linked tool, inject the platform bridge script
      // This enables window.callTool, window.onResult, etc. that photon UIs expect
      if (this.linkedTool) {
        // Extract the photon name from the MCP name (e.g., "git-box-mcp" -> "git-box")
        const photonName = this.mcpName.replace(/-mcp$/, '');

        // Fetch the platform bridge script
        const bridgeRes = await fetch(
          `/api/platform-bridge?photon=${encodeURIComponent(photonName)}&method=${encodeURIComponent(this.linkedTool)}&theme=${encodeURIComponent(this.theme)}&externalMcp=${encodeURIComponent(this.mcpName)}`,
          { signal: AbortSignal.timeout(10000) }
        );

        if (bridgeRes.ok) {
          const bridgeScript = await bridgeRes.text();
          // Inject bridge into HTML
          if (htmlContent.includes('</head>')) {
            htmlContent = htmlContent.replace('</head>', `${bridgeScript}</head>`);
          } else {
            htmlContent = `<html><head>${bridgeScript}</head><body>${htmlContent}</body></html>`;
          }
        }
      }

      this._srcDoc = htmlContent;
    } catch (e: any) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  private _iframeRef: HTMLIFrameElement | null = null;
  private _messageHandler: ((e: MessageEvent) => void) | null = null;

  /**
   * Set up message handlers when iframe loads
   */
  private _handleIframeLoad(e: Event) {
    const iframe = e.target as HTMLIFrameElement;
    iframe.classList.add('ready');
    this._iframeRef = iframe;

    if (!iframe.contentWindow) return;

    // Remove previous message handler if any
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
    }

    // Set up message handler for platform bridge communication (JSON-RPC tools/call)
    this._messageHandler = async (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      // Handle ui/initialize REQUEST from MCP Apps protocol
      // This is sent by the bridge script when the iframe loads
      if (msg.jsonrpc === '2.0' && msg.method === 'ui/initialize' && msg.id != null) {
        const themeTokens = filterSpecVariables(getThemeTokens(this.theme));
        iframe.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              hostContext: {
                theme: this.theme,
                styles: { variables: themeTokens },
                containerDimensions: { maxHeight: this.clientHeight || undefined },
              },
            },
          },
          '*'
        );
        return;
      }

      // Handle ui/notifications/size-changed from MCP Apps protocol
      // The host element's height is controlled by the parent (beam-app sets calc(100vh - ...))
      // so we don't override it here — just acknowledge the notification
      if (msg.jsonrpc === '2.0' && msg.method === 'ui/notifications/size-changed') {
        return;
      }

      // Handle JSON-RPC tools/call from platform bridge
      if (msg.jsonrpc === '2.0' && msg.method === 'tools/call' && msg.id != null) {
        const { name, arguments: args } = msg.params || {};
        const toolName = `${this.mcpName}/${name}`;

        try {
          const result = await mcpClient.callTool(toolName, args || {});

          // Send result back to iframe
          iframe.contentWindow?.postMessage(
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

          // Also send as photon:result for UIs that use onResult callback
          iframe.contentWindow?.postMessage(
            {
              type: 'photon:result',
              data: this._extractResultData(result),
            },
            '*'
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          iframe.contentWindow?.postMessage(
            {
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32000, message: errorMessage },
            },
            '*'
          );
        }
      }
    };
    window.addEventListener('message', this._messageHandler);

    // Create AppBridge for MCP Apps protocol (some external MCPs may use it)
    const themeTokens = filterSpecVariables(getThemeTokens(this.theme));
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

    // Handle tool calls from MCP Apps protocol
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

    // Auto-invoke linked tool when the app signals it's initialized (MCP Apps protocol)
    this._bridge.oninitialized = () => {
      if (this.linkedTool) {
        this._autoInvokeLinkedTool();
      }
    };

    // Create PostMessageTransport pointing at iframe's contentWindow
    this._transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);

    // Connect bridge to transport (fire-and-forget, photon UIs don't respond to handshake)
    this._bridge.connect(this._transport).catch(() => {
      // Ignore connect errors - photon UIs don't implement full MCP Apps protocol
    });

    // For photon-based external MCPs with platform bridge injected,
    // auto-invoke the linked tool after a short delay to let the iframe initialize
    if (this.linkedTool) {
      setTimeout(() => {
        this._autoInvokeLinkedTool();
      }, 200);
    }
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
   * Extract data from MCP tool result for photon UI consumption.
   * Prefers structuredContent, falls back to parsing text content.
   */
  private _extractResultData(result: any): any {
    // Prefer structuredContent if available
    if (result.structuredContent) {
      return result.structuredContent;
    }

    // Otherwise extract from content array
    if (Array.isArray(result.content)) {
      // Find text content and try to parse as JSON
      const textItem = result.content.find((item: any) => item.type === 'text');
      if (textItem?.text) {
        try {
          return JSON.parse(textItem.text);
        } catch {
          // If not JSON, return the raw text
          return textItem.text;
        }
      }
    }

    return result.content;
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

      // Extract data for photon UI consumption
      const data = this._extractResultData(result);

      // Send result to iframe via postMessage (photon UIs use onResult callback)
      this._iframeRef.contentWindow.postMessage(
        {
          type: 'photon:result',
          data,
        },
        '*'
      );

      // Also send via AppBridge for MCP Apps Extension compliant apps
      if (this._bridge) {
        this._bridge.sendToolResult({
          content: result.content,
          structuredContent: result.structuredContent,
          isError: result.isError,
        });
      }
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
      <div class="app-container">
        <iframe
          srcdoc=${this._srcDoc}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
          @load=${this._handleIframeLoad}
        ></iframe>
      </div>
    `;
  }
}
