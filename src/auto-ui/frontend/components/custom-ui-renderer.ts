import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
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
        background: white; /* Custom UIs usually expect a white bg */
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: none;
        display: block;
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

  // One of these will be set (in order of preference)
  @property({ type: String }) uiUri = ''; // MCP Apps: ui://photon/id
  @property({ type: String }) templatePath = '';
  @property({ type: String }) uiId = '';

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

    // Notify iframe of theme change without reloading
    if (changedProperties.has('theme')) {
      if (this._iframeRef?.contentWindow) {
        const themeTokens = getThemeTokens(this.theme);
        this._iframeRef.contentWindow.postMessage(
          {
            type: 'photon:theme-change',
            theme: this.theme,
            themeTokens: themeTokens,
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

      // 3. Inject Bridge
      // We inject it right before </head>, or at the top if no head
      let finalHtml = templateHtml;
      if (finalHtml.includes('</head>')) {
        finalHtml = finalHtml.replace('</head>', `${bridgeScript}</head>`);
      } else {
        finalHtml = `<html><head>${bridgeScript}</head><body>${finalHtml}</body></html>`;
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
      return html`<div class="loading">Loading interface...</div>`;
    }

    return html`
      <iframe
        srcdoc=${this._srcDoc}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
        @load=${this._handleIframeLoad}
      ></iframe>
    `;
  }

  private _handleIframeLoad(e: Event) {
    this._iframeRef = e.target as HTMLIFrameElement;
    // Send initial theme to iframe after load (with tokens for immediate styling)
    const themeTokens = getThemeTokens(this.theme);
    this._iframeRef?.contentWindow?.postMessage(
      {
        type: 'photon:theme-change',
        theme: this.theme,
        themeTokens: themeTokens,
      },
      '*'
    );
  }
}
