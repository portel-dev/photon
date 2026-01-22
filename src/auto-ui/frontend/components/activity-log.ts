import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface ActivityItem {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
}

@customElement('activity-log')
export class ActivityLog extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        margin-top: var(--space-xl);
        padding-top: var(--space-lg);
        border-top: 1px solid var(--border-glass);
      }

      .log-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-md);
        padding: 0 var(--space-xs);
      }

      h3 {
        margin: 0;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-secondary); /* Brighter */
        font-weight: 600;
      }

      .clear-btn {
        background: none;
        border: none;
        color: var(--t-muted);
        font-size: 0.8rem;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      
      .clear-btn:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }

      .log-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }

      .log-item {
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-left-width: 3px;
        border-left-style: solid;
        font-family: var(--font-mono);
        font-size: 0.85rem;
        display: flex;
        gap: var(--space-md);
      }

      .meta {
        color: var(--t-muted);
        flex-shrink: 0;
        width: 80px;
      }

      .content {
        color: var(--t-primary);
        flex: 1;
        word-break: break-all;
      }

      .type-info { border-left-color: var(--accent-secondary); }
      .type-success { border-left-color: #4ade80; }
      .type-error { border-left-color: #f87171; }
      .type-warning { border-left-color: #fbbf24; }
    `
  ];

  @property({ type: Array })
  items: ActivityItem[] = [];

  render() {
    if (this.items.length === 0) return html``;

    return html`
      <div class="log-header">
        <h3>Activity Log</h3>
        <button class="clear-btn" @click=${this._clear}>Clear</button>
      </div>
      
      <div class="log-list">
        ${this.items.map(item => html`
          <div class="log-item type-${item.type}">
            <span class="meta">${new Date(item.timestamp).toLocaleTimeString()}</span>
            <span class="content">${item.message}</span>
          </div>
        `)}
      </div>
    `;
  }

  private _clear() {
    this.dispatchEvent(new CustomEvent('clear'));
  }
}
