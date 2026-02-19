import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface ActivityItem {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
  count?: number; // For collapsed repeated messages
  photonName?: string; // For per-photon filtering
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

      .log-header-actions {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      h3 {
        margin: 0;
        font-size: var(--text-sm);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-secondary); /* Brighter */
        font-weight: 600;
      }

      .clear-btn {
        background: none;
        border: none;
        color: var(--t-muted);
        font-size: var(--text-sm);
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--radius-xs);
      }

      .clear-btn:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }

      .filter-btn {
        background: none;
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        font-size: var(--text-sm);
        cursor: pointer;
        padding: 2px 8px;
        border-radius: var(--radius-full);
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .filter-btn:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }

      .filter-btn.active {
        border-color: var(--accent-secondary);
        color: var(--accent-secondary);
        background: hsla(210, 80%, 65%, 0.08);
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
        font-size: var(--text-md);
        display: flex;
        gap: var(--space-md);
      }

      .meta {
        color: var(--t-muted);
        flex-shrink: 0;
        min-width: 95px;
      }

      .count {
        color: var(--t-muted);
        font-size: var(--text-xs);
        opacity: 0.8;
        margin-left: var(--space-xs);
      }

      .content {
        color: var(--t-primary);
        flex: 1;
        word-break: break-all;
      }

      .type-info {
        border-left-color: var(--accent-secondary);
      }
      .type-success {
        border-left-color: var(--color-success);
      }
      .type-error {
        border-left-color: var(--color-error);
      }
      .type-warning {
        border-left-color: var(--color-warning);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .log-item {
          flex-direction: column;
          gap: var(--space-xs);
        }

        .meta {
          width: auto;
          font-size: 0.75rem;
        }

        .clear-btn {
          min-height: 44px;
          padding: var(--space-sm) var(--space-md);
        }
      }

      @media (max-width: 480px) {
        :host {
          margin-top: var(--space-lg);
          padding-top: var(--space-md);
        }

        .content {
          font-size: 0.8rem;
        }
      }
    `,
  ];

  @property({ type: Array })
  items: ActivityItem[] = [];

  /** When set, shows a filter toggle button to scope the log to this photon name. */
  @property({ type: String })
  filter: string | undefined;

  @state() private _filterActive = false;

  render() {
    const visible =
      this._filterActive && this.filter
        ? this.items.filter((i) => i.photonName === this.filter)
        : this.items;

    if (this.items.length === 0) return html``;

    const hasFilterableEntries =
      this.filter && this.items.some((i) => i.photonName === this.filter);

    return html`
      <div class="log-header">
        <h3>Activity Log</h3>
        <div class="log-header-actions">
          ${hasFilterableEntries
            ? html`<button
                class="filter-btn ${this._filterActive ? 'active' : ''}"
                @click=${() => (this._filterActive = !this._filterActive)}
                title="${this._filterActive ? 'Show all photons' : `Filter to ${this.filter}`}"
              >
                ${this.filter}
              </button>`
            : ''}
          <button class="clear-btn" @click=${this._clear}>Clear</button>
        </div>
      </div>

      <div class="log-list">
        ${visible.map(
          (item) => html`
            <div class="log-item type-${item.type}">
              <span class="meta">${new Date(item.timestamp).toLocaleTimeString()}</span>
              <span class="content"
                >${item.message}${item.count && item.count > 1
                  ? html`<span class="count">(×${item.count})</span>`
                  : ''}</span
              >
            </div>
          `
        )}
      </div>
    `;
  }

  private _clear() {
    this.dispatchEvent(new CustomEvent('clear'));
  }
}
