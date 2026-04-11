import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { beamTypographyTokens } from '../styles/beam-tokens.js';

/**
 * Canvas Renderer — two-stream AI-generated UI
 *
 * Hosts a sandboxed iframe with the Photon bridge + renderers pre-loaded.
 * Receives two streams via postMessage:
 *   - canvas/ui: HTML layout with data-slot placeholders
 *   - canvas/data: JSON data targeting named slots
 *
 * The bridge's _canvasReconciler merges them: when both a slot element
 * and its data are available, it calls photon.render(el, data, format).
 */

function getBeamThemeTokens(themeMode: 'light' | 'dark'): Record<string, string> {
  const tokens = getThemeTokens(themeMode);
  if (themeMode === 'dark') {
    tokens['--color-surface'] = '#0B1018';
    tokens['--color-surface-container'] = '#131B28';
    tokens['--color-surface-container-high'] = '#1A2433';
    tokens['--color-surface-container-highest'] = '#212D3E';
    tokens['--bg'] = '#0B1018';
  } else {
    tokens['--color-surface'] = '#EEF1F5';
    tokens['--color-surface-container'] = '#FFFFFF';
    tokens['--color-surface-container-high'] = '#E4EAF1';
    tokens['--color-surface-container-highest'] = '#D8E0EA';
    tokens['--bg'] = '#EEF1F5';
  }
  return tokens;
}

@customElement('canvas-renderer')
export class CanvasRenderer extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 400px;
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
        will-change: transform;
      }

      .loading {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: var(--t-muted);
        font-size: 13px;
      }
    `,
  ];

  @property({ type: String }) photon = '';
  @property({ type: String }) method = '';
  @property({ type: String }) theme: 'light' | 'dark' = 'dark';

  @state() private _loading = true;

  private _iframeRef: HTMLIFrameElement | null = null;
  private _blobUrl: string | null = null;
  private _iframeReady = false;
  private _messageBuffer: any[] = [];

  connectedCallback() {
    super.connectedCallback();
    void this._buildAndMount();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }

  /**
   * Push a canvas/ui message to the iframe (HTML layout with data-slot placeholders)
   */
  pushUI(htmlContent: string): void {
    this._postOrBuffer({
      jsonrpc: '2.0',
      method: 'canvas/ui',
      params: { html: htmlContent },
    });
  }

  /**
   * Push a canvas/data message to the iframe (JSON data targeting a named slot)
   */
  pushData(slot: string, data: any): void {
    this._postOrBuffer({
      jsonrpc: '2.0',
      method: 'canvas/data',
      params: { slot, data },
    });
  }

  private _postOrBuffer(message: any): void {
    if (this._iframeReady && this._iframeRef?.contentWindow) {
      this._iframeRef.contentWindow.postMessage(message, '*');
    } else {
      this._messageBuffer.push(message);
    }
  }

  private _flushBuffer(): void {
    if (!this._iframeRef?.contentWindow) return;
    for (const msg of this._messageBuffer) {
      this._iframeRef.contentWindow.postMessage(msg, '*');
    }
    this._messageBuffer = [];
  }

  private async _buildAndMount(): Promise<void> {
    this._loading = true;

    try {
      // Fetch the bridge script (dynamically generated with theme + metadata)
      const bridgeRes = await fetch(
        `/api/platform-bridge?photon=${encodeURIComponent(this.photon)}&method=${encodeURIComponent(this.method)}&theme=${encodeURIComponent(this.theme)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!bridgeRes.ok) throw new Error('Failed to load platform bridge');
      const bridgeScript = await bridgeRes.text();

      // Build minimal HTML shell with bridge + renderers eagerly loaded
      const baseCSS = `<style>
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
  [data-slot] {
    min-height: 40px;
    transition: opacity 0.2s ease;
  }
  [data-slot].photon-loading {
    opacity: 0.4;
  }
  [data-slot][data-rendered] {
    opacity: 1;
  }
</style>`;

      // Eagerly load renderers — canvas always needs them
      const renderersScript = `<script src="/api/photon-renderers.js"><\/script>`;

      const shellHtml = `<html>
<head>
  <meta name="photon-canvas" content="true">
  ${bridgeScript}
  ${baseCSS}
  ${renderersScript}
</head>
<body></body>
</html>`;

      // Mount via blob URL (Safari-safe, same as custom-ui-renderer)
      const blob = new Blob([shellHtml], { type: 'text/html' });
      this._blobUrl = URL.createObjectURL(blob);

      await this.updateComplete;

      const container = this.shadowRoot?.querySelector('.iframe-host');
      if (!container) return;

      // Clean up previous iframe
      const old = container.querySelector('iframe');
      if (old) old.remove();

      const iframe = document.createElement('iframe');
      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-forms allow-same-origin allow-popups allow-modals'
      );
      iframe.setAttribute('allowtransparency', 'true');
      iframe.addEventListener('load', () => this._handleIframeLoad(iframe));
      iframe.src = this._blobUrl;
      container.appendChild(iframe);
    } catch (e: any) {
      console.error('[canvas-renderer] Failed to build:', e);
      this._loading = false;
    }
  }

  private _handleIframeLoad(iframe: HTMLIFrameElement): void {
    this._iframeRef = iframe;
    this._loading = false;

    // Send initial theme tokens
    const themeTokens = getBeamThemeTokens(this.theme);
    iframe.contentWindow?.postMessage(
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
    iframe.contentWindow?.postMessage(
      {
        type: 'photon:theme-change',
        theme: this.theme,
        themeTokens: { ...themeTokens, ...beamTypographyTokens },
      },
      '*'
    );

    // Mark ready and flush buffered messages
    this._iframeReady = true;
    this._flushBuffer();

    // Auto-resize iframe to match content height
    this._startAutoResize(iframe);
  }

  private _resizeObserver: any = null;

  private _startAutoResize(iframe: HTMLIFrameElement): void {
    const resize = () => {
      try {
        const height = iframe.contentDocument?.body?.scrollHeight;
        if (height && height > 0) {
          iframe.style.height = `${height + 16}px`;
          this.style.minHeight = `${height + 16}px`;
        }
      } catch (_) {
        // cross-origin — skip
      }
    };

    // Observe body mutations to auto-resize when content changes
    try {
      const body = iframe.contentDocument?.body;
      if (body) {
        this._resizeObserver = new MutationObserver(resize);
        this._resizeObserver.observe(body, { childList: true, subtree: true, attributes: true });
      }
    } catch (_) {
      // cross-origin — skip
    }

    // Also resize on interval for chart renders that happen async
    const interval = setInterval(resize, 500);
    setTimeout(() => clearInterval(interval), 10000);
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('theme') && this._iframeRef?.contentWindow) {
      const themeTokens = getBeamThemeTokens(this.theme);
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

  render() {
    return html`
      <div class="iframe-host"></div>
      ${this._loading ? html`<div class="loading"><span>Preparing canvas…</span></div>` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'canvas-renderer': CanvasRenderer;
  }
}
