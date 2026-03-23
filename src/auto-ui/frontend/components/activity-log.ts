import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { check, xMark, warning, info } from '../icons.js';

interface ActivityItem {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
  count?: number; // For collapsed repeated messages
  photonName?: string; // For per-photon filtering
  durationMs?: number; // Tool execution duration
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
        color: var(--t-primary);
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
        background: var(--bg-glass);
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
        background: var(--bg-glass);
        color: var(--t-primary);
      }

      .filter-btn.active {
        border-color: var(--accent-secondary);
        color: var(--accent-secondary);
        background: var(--bg-glass);
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .log-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        list-style: none;
        margin: 0;
        padding: 0;
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
        overflow: visible;
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
        min-width: 0;
        word-break: break-word;
        overflow-wrap: break-word;
      }

      .duration {
        display: inline-block;
        font-size: var(--text-xs);
        color: var(--t-muted);
        background: var(--bg-glass);
        padding: 1px 6px;
        border-radius: var(--radius-full);
        margin-left: var(--space-sm);
        font-variant-numeric: tabular-nums;
      }

      .type-icon {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        width: 16px;
        height: 16px;
      }

      .type-icon svg {
        width: 16px;
        height: 16px;
      }

      .type-info {
        border-left-color: var(--accent-secondary);
      }
      .type-info .type-icon {
        color: var(--accent-secondary);
      }
      .type-success {
        border-left-color: var(--color-success);
      }
      .type-success .type-icon {
        color: var(--color-success);
      }
      .type-error {
        border-left-color: var(--color-error);
      }
      .type-error .type-icon {
        color: var(--color-error);
      }
      .type-warning {
        border-left-color: var(--color-warning);
      }
      .type-warning .type-icon {
        color: var(--color-warning);
      }

      .log-header h3 {
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        gap: var(--space-xs);
      }

      .collapse-chevron {
        display: inline-flex;
        transition: transform 0.2s ease;
      }

      .collapse-chevron.collapsed {
        transform: rotate(-90deg);
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
  @state() private _collapsed = false;

  private _lastFilter: string | undefined = undefined;

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    // Auto-enable filter when the photon context changes and has filterable entries
    if (changedProperties.has('filter') && this.filter !== this._lastFilter) {
      this._lastFilter = this.filter;
      if (this.filter && this.items.some((i) => i.photonName === this.filter)) {
        this._filterActive = true;
      }
    }
  }

  render() {
    const visible =
      this._filterActive && this.filter
        ? this.items.filter((i) => i.photonName === this.filter)
        : this.items;

    if (this.items.length === 0) return html``;

    const hasFilterableEntries =
      this.filter && this.items.some((i) => i.photonName === this.filter);

    const typeIcon = (type: string) => {
      switch (type) {
        case 'success':
          return check;
        case 'error':
          return xMark;
        case 'warning':
          return warning;
        default:
          return info;
      }
    };

    return html`
      <div class="log-header">
        <h3
          @click=${() => (this._collapsed = !this._collapsed)}
          role="button"
          tabindex="0"
          @keydown=${(e: KeyboardEvent) =>
            (e.key === 'Enter' || e.key === ' ') &&
            (e.preventDefault(), (this._collapsed = !this._collapsed))}
          aria-expanded="${!this._collapsed}"
        >
          <span class="collapse-chevron ${this._collapsed ? 'collapsed' : ''}">▾</span>
          Activity Log
        </h3>
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
          <button class="clear-btn" @click=${() => this._clear()}>Clear</button>
        </div>
      </div>

      ${this._collapsed
        ? ''
        : html`
            <ul class="log-list" role="log" aria-live="polite" aria-label="Activity log entries">
              ${visible.map(
                (item) => html`
                  <li class="log-item type-${item.type}">
                    <span class="type-icon" aria-hidden="true">${typeIcon(item.type)}</span>
                    <span class="meta">${new Date(item.timestamp).toLocaleTimeString()}</span>
                    <span class="content"
                      ><span class="visually-hidden">${item.type}: </span
                      >${item.message}${item.durationMs != null
                        ? html`<span class="duration">${item.durationMs}ms</span>`
                        : ''}${item.count && item.count > 1
                        ? html`<span class="count">(×${item.count})</span>`
                        : ''}</span
                    >
                  </li>
                `
              )}
            </ul>
          `}
    `;
  }

  private _clear() {
    this.dispatchEvent(new CustomEvent('clear'));
  }
}
