import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { beamTypographyTokens } from '../styles/beam-tokens.js';
import { mcpClient } from '../services/mcp-client.js';

/**
 * Override design-system surface tokens with Beam's own background colors
 * so iframe content seamlessly blends with the Beam chrome.
 * Beam uses blue-tinted darks (hsl 220,15%) while design tokens use neutral grays.
 */
function getBeamThemeTokens(themeMode: 'light' | 'dark'): Record<string, string> {
  const tokens = getThemeTokens(themeMode);
  if (themeMode === 'dark') {
    tokens['--color-surface'] = 'hsl(220, 15%, 10%)'; // --bg-app
    tokens['--color-surface-container'] = 'hsl(220, 15%, 12%)'; // --bg-panel
    tokens['--color-surface-container-high'] = 'hsl(220, 15%, 14%)';
    tokens['--color-surface-container-highest'] = 'hsl(220, 15%, 16%)';
    tokens['--bg'] = 'hsl(220, 15%, 10%)';
  } else {
    tokens['--color-surface'] = '#eae4dd'; // light --bg-app
    tokens['--color-surface-container'] = '#f8f5f1'; // light --bg-panel
    tokens['--color-surface-container-high'] = '#f0ebe5';
    tokens['--color-surface-container-highest'] = '#e8e2db';
    tokens['--bg'] = '#eae4dd';
  }
  return tokens;
}

@customElement('custom-ui-renderer')
export class CustomUiRenderer extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 500px;
        background: transparent;
        border-radius: var(--radius-md);
        overflow: visible;
      }

      .iframe-host {
        width: 100%;
        height: 100%;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: none;
        display: block;
        /* Force own compositing layer — fixes Safari not painting
           iframe content in shadow DOM until a resize event */
        will-change: transform;
      }

      /* Loading and error overlays sit on top of .iframe-host.
         .iframe-host is NEVER hidden — the iframe always has real
         dimensions so it can lay out content correctly. */
      .loading,
      .error-container {
        position: absolute;
        inset: 0;
        z-index: 1;
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

  // Bump to force re-fetch of template + bridge (e.g., after tools-changed)
  @property({ type: Number }) revision = 0;

  @state() private _srcDoc = '';
  @state() private _loading = true;
  @state() private _error = '';
  private _iframeRef: HTMLIFrameElement | null = null;
  private _contentResizeObserver: ResizeObserver | null = null;
  private _blobUrl: string | null = null; // tracked for cleanup
  private _loadTimer: ReturnType<typeof setTimeout> | null = null;
  private _loadGeneration = 0; // tracks which load is current

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (
      changedProperties.has('photon') ||
      changedProperties.has('method') ||
      changedProperties.has('templatePath') ||
      changedProperties.has('uiId') ||
      changedProperties.has('uiUri') ||
      changedProperties.has('revision')
    ) {
      // Debounce: properties may arrive in separate Lit update cycles
      if (this._loadTimer) clearTimeout(this._loadTimer);
      this._loadTimer = setTimeout(() => {
        void this._loadContent();
      }, 0);
    }

    // When _srcDoc is ready, mount the iframe using a blob URL.
    // No need for updateComplete — .iframe-host is always in the DOM.
    if (changedProperties.has('_srcDoc') && this._srcDoc) {
      this._mountIframe();
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
        const themeTokens = getBeamThemeTokens(this.theme);
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

  /**
   * Create iframe imperatively using a blob URL instead of srcdoc.
   * Safari has a known bug where srcdoc in shadow DOM races with the
   * initial about:blank navigation (whatwg/html#763). Using blob URL
   * with src= bypasses this entirely — it's a normal URL navigation.
   */
  private _mountIframe() {
    const container = this.shadowRoot?.querySelector('.iframe-host');
    if (!container) return;

    // Clean up previous iframe and blob URL
    const old = container.querySelector('iframe');
    if (old) old.remove();
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }

    // Create blob URL from HTML content
    const blob = new Blob([this._srcDoc], { type: 'text/html' });
    this._blobUrl = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-same-origin allow-popups allow-modals'
    );
    iframe.setAttribute('allowtransparency', 'true');
    iframe.addEventListener('load', (e) => this._handleIframeLoad(e));
    iframe.src = this._blobUrl;
    container.appendChild(iframe);
  }

  private async _loadContent() {
    if (!this.photon && !this.uiUri) return;

    const generation = ++this._loadGeneration;
    this._loading = true;
    this._error = '';
    this._srcDoc = '';

    try {
      // 1. Fetch Template via MCP resources/read (ui:// scheme) or HTTP
      let templateHtml: string;
      let isPhotonTemplate = false; // .photon.html = declarative mode

      // Determine the ui:// URI
      let uri = this.uiUri;
      if (!uri && this.uiId) {
        uri = `ui://${this.photon}/${this.uiId}`;
      }

      if (uri) {
        // Use MCP resources/read for ui:// URIs, with HTTP fallback
        const result = await this._fetchTemplate(uri);
        templateHtml = result.html;
        isPhotonTemplate = result.isPhotonTemplate;
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

      if (isPhotonTemplate) {
        // ── .photon.html: Declarative mode ──
        // Auto-wrap as fragment, apply base CSS, enable data-method binding.
        // The bridge detects <meta name="photon-template"> to activate binding.
        const photonBaseCSS = `<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-family-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    background: var(--color-surface);
    color: var(--color-on-surface);
    font-size: var(--font-size-sm, 14px);
    line-height: 1.5;
    padding: var(--space-4, 16px);
  }
  a { color: var(--color-primary); }
  input, textarea, select {
    background: var(--color-surface-container);
    color: var(--color-on-surface);
    border: 1px solid var(--color-outline-variant);
    border-radius: var(--radius-sm, 4px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    font-family: inherit;
    font-size: inherit;
  }
  button {
    background: var(--color-primary);
    color: var(--color-on-primary);
    border: none;
    border-radius: var(--radius-sm, 4px);
    padding: var(--space-2, 8px) var(--space-4, 16px);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
</style>`;
        const templateMeta = '<meta name="photon-template" content="true">';
        finalHtml = `<html><head>${templateMeta}${injected}${photonBaseCSS}</head><body>${finalHtml}</body></html>`;
      } else if (finalHtml.includes('</head>')) {
        // ── .html with full structure: inject bridge only ──
        finalHtml = finalHtml.replace('</head>', `${injected}</head>`);
      } else {
        // ── .html fragment (no <head>): wrap minimally, no base CSS ──
        finalHtml = `<html><head>${injected}</head><body>${finalHtml}</body></html>`;
      }

      // Abort if a newer _loadContent() was triggered while we were fetching
      if (generation !== this._loadGeneration) return;

      this._srcDoc = finalHtml;
      // Note: Custom UIs should send 'photon:viewing' message with actual board name
      // to enable on-demand channel subscriptions
    } catch (e: any) {
      if (generation !== this._loadGeneration) return;
      this._error = e.message;
    } finally {
      if (generation === this._loadGeneration) {
        this._loading = false;
      }
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

  /**
   * Fetch a UI template from MCP (preferred) or HTTP, detecting .photon.html mode.
   */
  private async _fetchTemplate(uri: string): Promise<{ html: string; isPhotonTemplate: boolean }> {
    // Try MCP resources/read first
    const mcpClient = (window as any).__photonMCPClient;
    if (mcpClient) {
      try {
        const resource = await mcpClient.readResource(uri);
        if (resource?.text) {
          // MCP response — check mimeType parameter or URI for .photon.html / .photon.md
          const isMd =
            uri.endsWith('.photon.md') ||
            resource.uri?.endsWith('.photon.md') ||
            resource.mimeType?.includes('text/markdown');
          const isPT =
            isMd ||
            resource.mimeType?.includes('photon-template=true') ||
            uri.endsWith('.photon.html') ||
            resource.uri?.endsWith('.photon.html');
          const html = isMd ? this._markdownToHtml(resource.text) : resource.text;
          return { html, isPhotonTemplate: !!isPT };
        }
      } catch (e) {
        console.warn('MCP resources/read failed, falling back to HTTP:', e);
      }
    }

    // Fallback to HTTP /api/ui (which detects .photon.html and sets header)
    const match = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid ui:// URI: ${uri}`);

    const [, photonName, uiId] = match;
    const url = `/api/ui?photon=${encodeURIComponent(photonName)}&id=${encodeURIComponent(uiId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Failed to load UI: ${res.statusText}`);
    const html = await res.text();
    const isPhotonMarkdown = res.headers.get('X-Photon-Markdown') === 'true';
    const isPhotonTemplate = res.headers.get('X-Photon-Template') === 'true';
    const finalHtml = isPhotonMarkdown ? this._markdownToHtml(html) : html;
    return { html: finalHtml, isPhotonTemplate };
  }

  /** Convert .photon.md content to HTML using marked (already loaded via CDN) */
  private _markdownToHtml(markdown: string): string {
    const marked = (window as any).marked;
    if (!marked) {
      return `<pre style="white-space:pre-wrap">${markdown}</pre>`;
    }
    // Parse markdown to HTML — HTML tags in markdown pass through untouched,
    // so <div data-method="..."> works as-is.
    let html = marked.parse(markdown, { breaks: false, gfm: true }) as string;

    // Auto-enhance: add fluid layout styles for .photon.md content.
    // Standalone data-method divs (not inside grids/cards) get float behavior
    // so surrounding text flows around them naturally.
    html += `<style>
      body { line-height: 1.7; max-width: 100%; }
      h1, h2, h3 { margin: 1em 0 0.5em; }
      p { margin: 0.5em 0; }
      hr { border: none; border-top: 1px solid var(--color-outline-variant, #333); margin: 1.5em 0; }
      code { background: var(--color-surface-container, #2a2a2a); padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
      pre { background: var(--color-surface-container, #2a2a2a); padding: 12px; border-radius: 6px; overflow-x: auto; }
      pre code { background: none; padding: 0; }
      .card, [style*="border-radius"][style*="padding"] {
        background: var(--color-surface-container, #1e1e1e);
        border: 1px solid var(--color-outline-variant, #333);
      }
      [data-method] { min-height: 40px; margin: 8px 0; }
      img { max-width: 100%; border-radius: 6px; }
    </style>`;

    return html;
  }

  render() {
    // .iframe-host is ALWAYS visible with real dimensions so the iframe can
    // lay out content correctly. Loading/error are absolutely-positioned
    // overlays on top (see CSS). This prevents the Safari zero-dimension bug
    // where an iframe in a display:none container renders blank.
    return html`
      <div class="iframe-host"></div>
      ${this._error
        ? html`<div class="error-container">
            <div class="error-icon">⚠️</div>
            <div class="error-message">${this._error}</div>
            <button
              class="retry-btn"
              @click=${() => {
                void this._loadContent();
              }}
            >
              Retry
            </button>
          </div>`
        : this._loading
          ? html`<div class="loading">
              <div class="loading-spinner"></div>
              <span>Loading interface…</span>
            </div>`
          : ''}
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

  private _handleIframeLoad(e: Event) {
    const iframe = e.target as HTMLIFrameElement;
    this._iframeRef = iframe;

    // Send initial theme to iframe after load (with tokens for immediate styling)
    const themeTokens = getBeamThemeTokens(this.theme);
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

    // Force Safari to repaint the iframe in the next frame
    requestAnimationFrame(() => {
      if (this._iframeRef) {
        this._iframeRef.style.transform = 'translateZ(0)';
      }
    });

    // Grow iframe when content exceeds the container height (e.g. long forms).
    // We never shrink below the natural CSS height (100% of the container).
    // Exceptions — let the iframe scroll internally instead of growing:
    //   1. The iframe body opts into overflow:hidden (full-height app layout)
    //   2. The host has an explicit height constraint (app-fill mode set by
    //      beam-app's appFillStyle), meaning a parent has overflow:hidden
    //      and growing the iframe would just get clipped with no scrollbar.
    this._contentResizeObserver?.disconnect();
    const body = iframe.contentDocument?.body;
    if (body) {
      const bodyOverflow = iframe.contentDocument?.defaultView
        ? getComputedStyle(iframe.contentDocument.body).overflow
        : '';
      const isFullHeightApp = bodyOverflow === 'hidden';
      const hostHasExplicitHeight = this.style.height && this.style.height !== 'auto';
      if (!isFullHeightApp && !hostHasExplicitHeight) {
        this._contentResizeObserver = new ResizeObserver(() => {
          const scrollH = iframe.contentDocument?.body.scrollHeight ?? 0;
          const containerH = this.offsetHeight || 500;
          if (scrollH > containerH) {
            iframe.style.height = scrollH + 'px';
          } else {
            iframe.style.height = ''; // let CSS height: 100% take over
          }
        });
        this._contentResizeObserver.observe(body);
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Fire-and-forget teardown on unmount
    this.teardown().catch(() => {});
    // Clean up blob URL
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
    this._contentResizeObserver?.disconnect();
    this._contentResizeObserver = null;
  }
}
