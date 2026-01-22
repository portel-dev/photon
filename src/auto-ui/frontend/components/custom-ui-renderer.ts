import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

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
    `
    ];

    @property({ type: String }) photon = '';
    @property({ type: String }) method = '';

    // One of these will be set
    @property({ type: String }) templatePath = '';
    @property({ type: String }) uiId = '';

    @state() private _srcDoc = '';
    @state() private _loading = true;
    @state() private _error = '';

    protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
        if (changedProperties.has('photon') || changedProperties.has('method') ||
            changedProperties.has('templatePath') || changedProperties.has('uiId')) {
            this._loadContent();
        }
    }

    private async _loadContent() {
        if (!this.photon) return;

        this._loading = true;
        this._error = '';
        this._srcDoc = '';

        try {
            // 1. Fetch Template
            let url = '';
            if (this.templatePath) {
                url = `/api/template?photon=${encodeURIComponent(this.photon)}&path=${encodeURIComponent(this.templatePath)}`;
            } else if (this.uiId) {
                url = `/api/ui?photon=${encodeURIComponent(this.photon)}&id=${encodeURIComponent(this.uiId)}`;
            } else {
                throw new Error('No template source specified');
            }

            const templateRes = await fetch(url);
            if (!templateRes.ok) throw new Error(`Failed to load template: ${templateRes.statusText}`);
            const templateHtml = await templateRes.text();

            // 2. Fetch Bridge Script
            const bridgeRes = await fetch(`/api/platform-bridge?photon=${encodeURIComponent(this.photon)}&method=${encodeURIComponent(this.method)}&theme=dark`);
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
        } catch (e: any) {
            this._error = e.message;
        } finally {
            this._loading = false;
        }
    }

    render() {
        if (this._error) {
            return html`
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <div class="error-message">${this._error}</div>
                <button class="retry-btn" @click=${this._loadContent}>
                    Retry
                </button>
            </div>
          `;
        }

        if (this._loading) {
            return html`<div class="loading">Loading interface...</div>`;
        }

        return html`
        <iframe 
            srcdoc=${this._srcDoc}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        ></iframe>
      `;
    }
}
