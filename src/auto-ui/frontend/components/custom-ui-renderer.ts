import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { beamTypographyTokens } from '../styles/beam-tokens.js';
import { mcpClient } from '../services/mcp-client.js';

@customElement('custom-ui-renderer')
export class CustomUiRenderer extends LitElement {
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
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        height: 100%;
        color: var(--t-muted);
        font-size: 13px;
        background: var(--bg-panel);
      }

      .loading-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--border-glass);
        border-top-color: var(--t-muted);
        border-radius: 50%;
        animation: spin 0.75s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
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

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        :host {
          min-height: 400px;
          border-radius: var(--radius-sm);
        }

        .retry-btn {
          min-height: 44px;
          width: 100%;
        }

        .error-container {
          padding: var(--space-md);
        }

        .error-message {
          max-width: 100%;
        }
      }

      @media (max-width: 480px) {
        :host {
          min-height: 300px;
        }

        .error-icon {
          font-size: 2.5rem;
        }

        .error-message {
          font-size: 0.85rem;
        }
      }
    `,
  ];

  @property({ type: String }) photon = '';
  @property({ type: String }) method = '';
  @property({ type: String }) theme: Theme = 'dark';
  @property({ type: Object }) csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };

  // One of these will be set (in order of preference)
  @property({ type: String }) uiUri = ''; // MCP Apps: ui://photon/id
  @property({ type: String }) templatePath = '';
  @property({ type: String }) uiId = '';

  // Initial tool result to deliver to the iframe on load.
  // Fixes timing race: SSE tool-result fires before iframe exists.
  @property({ type: Object }) initialResult: any = null;

  @state() private _srcDoc = '';
  @state() private _loading = true;
  @state() private _error = '';
  private _iframeRef: HTMLIFrameElement | null = null;

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (
      changedProperties.has('photon') ||
      changedProperties.has('method') ||
      changedProperties.has('templatePath') ||
      changedProperties.has('uiId') ||
      changedProperties.has('uiUri')
    ) {
      this._loadContent();
    }

    // Deliver result to iframe when initialResult changes after iframe is already loaded
    if (
      changedProperties.has('initialResult') &&
      this.initialResult &&
      this._iframeRef?.contentWindow
    ) {
      this._iframeRef.contentWindow.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: { result: this.initialResult },
        },
        '*'
      );
    }

    // Notify iframe of theme change without reloading
    if (changedProperties.has('theme')) {
      if (this._iframeRef?.contentWindow) {
        const themeTokens = getThemeTokens(this.theme);
        // Standard MCP Apps notification
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
        // Photon bridge notification (backward compat) — include Beam typography tokens
        this._iframeRef.contentWindow.postMessage(
          {
            type: 'photon:theme-change',
            theme: this.theme,
            themeTokens: { ...themeTokens, ...beamTypographyTokens },
          },
          '*'
        );
      }
    }
  }

  private async _loadContent() {
    if (!this.photon && !this.uiUri) return;

    this._loading = true;
    this._error = '';
    this._srcDoc = '';

    try {
      // 1. Fetch Template via MCP resources/read (ui:// scheme)
      let templateHtml: string;

      // Determine the ui:// URI
      let uri = this.uiUri;
      if (!uri && this.uiId) {
        uri = `ui://${this.photon}/${this.uiId}`;
      }

      if (uri) {
        // Use MCP resources/read for ui:// URIs
        templateHtml = await this._fetchViaMCP(uri);
      } else if (this.templatePath) {
        // Fall back to HTTP for templatePath (legacy)
        const url = `/api/template?photon=${encodeURIComponent(this.photon)}&path=${encodeURIComponent(this.templatePath)}`;
        const templateRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!templateRes.ok) throw new Error(`Failed to load template: ${templateRes.statusText}`);
        templateHtml = await templateRes.text();
      } else {
        throw new Error('No template source specified');
      }

      // 2. Fetch Bridge Script (still via HTTP - it's dynamically generated)
      const bridgeRes = await fetch(
        `/api/platform-bridge?photon=${encodeURIComponent(this.photon)}&method=${encodeURIComponent(this.method)}&theme=${encodeURIComponent(this.theme)}`,
        {
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!bridgeRes.ok) throw new Error('Failed to load platform bridge');
      const bridgeScript = await bridgeRes.text();

      // 3. Build CSP meta tag if CSP metadata is provided
      let cspTag = '';
      if (this.csp) {
        const directives: string[] = [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
        ];
        if (this.csp.connectDomains?.length) {
          directives.push(`connect-src 'self' ${this.csp.connectDomains.join(' ')}`);
        }
        if (this.csp.resourceDomains?.length) {
          directives.push(`img-src 'self' ${this.csp.resourceDomains.join(' ')}`);
          directives.push(`media-src 'self' ${this.csp.resourceDomains.join(' ')}`);
          directives.push(`font-src 'self' ${this.csp.resourceDomains.join(' ')}`);
        }
        if (this.csp.frameDomains?.length) {
          directives.push(`frame-src 'self' ${this.csp.frameDomains.join(' ')}`);
        }
        if (this.csp.baseUriDomains?.length) {
          directives.push(`base-uri ${this.csp.baseUriDomains.join(' ')}`);
        }
        cspTag = `<meta http-equiv="Content-Security-Policy" content="${directives.join('; ')}">`;
      }

      // 4. Inject Bridge (and CSP if present)
      const injected = cspTag + bridgeScript;
      let finalHtml = templateHtml;
      if (finalHtml.includes('</head>')) {
        finalHtml = finalHtml.replace('</head>', `${injected}</head>`);
      } else {
        finalHtml = `<html><head>${injected}</head><body>${finalHtml}</body></html>`;
      }

      this._srcDoc = finalHtml;
      // Note: Custom UIs should send 'photon:viewing' message with actual board name
      // to enable on-demand channel subscriptions
    } catch (e: any) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Fetch UI template via MCP resources/read with HTTP fallback
   */
  private async _fetchViaMCP(uri: string): Promise<string> {
    // Try MCP first
    if (mcpClient.isConnected()) {
      try {
        const resource = await mcpClient.readResource(uri);
        if (resource?.text) {
          return resource.text;
        }
      } catch (e) {
        console.warn('MCP resources/read failed, falling back to HTTP:', e);
      }
    }

    // Fallback to HTTP /api/ui endpoint
    const match = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid ui:// URI: ${uri}`);
    }

    const [, photonName, uiId] = match;
    const url = `/api/ui?photon=${encodeURIComponent(photonName)}&id=${encodeURIComponent(uiId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Failed to load UI: ${res.statusText}`);
    return res.text();
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
      return html`<div class="loading">
        <div class="loading-spinner"></div>
        <span>Loading interface…</span>
      </div>`;
    }

    return html`
      <iframe
        srcdoc=${this._srcDoc}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
        @load=${this._handleIframeLoad}
      ></iframe>
    `;
  }

  /**
   * Send ui/resource-teardown to iframe and wait for response (max 3s).
   * Returns a promise that resolves when teardown completes or times out.
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

  disconnectedCallback() {
    super.disconnectedCallback();
    // Fire-and-forget teardown on unmount
    this.teardown().catch(() => {});
  }

  private _handleIframeLoad(e: Event) {
    this._iframeRef = e.target as HTMLIFrameElement;
    // Send initial theme to iframe after load (with tokens for immediate styling)
    const themeTokens = getThemeTokens(this.theme);
    // Standard MCP Apps notification
    this._iframeRef?.contentWindow?.postMessage(
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
    // Photon bridge notification (backward compat) — include Beam typography tokens
    this._iframeRef?.contentWindow?.postMessage(
      {
        type: 'photon:theme-change',
        theme: this.theme,
        themeTokens: { ...themeTokens, ...beamTypographyTokens },
      },
      '*'
    );
    // Deliver cached tool result if the SSE notification fired before this iframe existed
    if (this.initialResult) {
      this._iframeRef?.contentWindow?.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: { result: this.initialResult },
        },
        '*'
      );
    }

    // Reveal iframe after theme is applied (next frame lets bridge script run)
    requestAnimationFrame(() => {
      this._iframeRef?.classList.add('ready');
    });
  }
}
