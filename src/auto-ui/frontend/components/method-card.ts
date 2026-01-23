import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface MethodInfo {
    name: string;
    description: string;
    params: Record<string, any>;
}

@customElement('method-card')
export class MethodCard extends LitElement {
    static styles = [
        theme,
        css`
      :host {
        display: block;
        height: 100%;
      }

      .card {
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        height: 100%;
        box-sizing: border-box;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 32px -4px rgba(0, 0, 0, 0.3);
        border-color: var(--accent-secondary);
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--space-sm);
      }

      .title {
        font-weight: 600;
        font-size: 1.1rem;
        margin: 0;
        color: var(--t-primary);
      }

      .description {
        font-size: 0.9rem;
        color: var(--t-muted);
        line-height: 1.5;
        margin-bottom: var(--space-md);
        flex: 1; /* Push button to bottom */
        /* Limit to 3 lines with ellipsis */
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .badge {
        font-size: 0.75rem;
        padding: 2px 8px;
        border-radius: 12px;
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-muted);
      }

      .run-btn {
        align-self: flex-start;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        border: none;
        padding: var(--space-sm) var(--space-lg);
        border-radius: var(--radius-sm);
        color: white;
        font-weight: 500;
        cursor: pointer;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.2s ease;
      }

      .card:hover .run-btn {
        opacity: 1;
        transform: translateY(0);
      }
    `
    ];

    @property({ type: Object })
    method!: MethodInfo;

    render() {
        return html`
      <div class="card glass-panel" @click=${this._handleClick}>
        <div>
          <div class="header">
            <h3 class="title">${this.method.name}</h3>
            ${Object.keys(this.method.params || {}).length > 0
                ? html`<span class="badge">Params</span>`
                : html`<span class="badge" style="background: hsla(150, 50%, 40%, 0.2); color: #4ade80;">Ready</span>`
            }
          </div>
          <p class="description">${this.method.description || 'No description provided.'}</p>
        </div>
        <button class="run-btn">Run Method</button>
      </div>
    `;
    }

    private _handleClick() {
        this.dispatchEvent(new CustomEvent('select', { detail: { method: this.method } }));
    }
}
