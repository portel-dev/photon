import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

export interface OverflowMenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  toggle?: boolean;
  toggleActive?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
}

@customElement('overflow-menu')
export class OverflowMenu extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      .trigger {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .trigger:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .dropdown {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        min-width: 200px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 9999;
        overflow: visible;
        white-space: nowrap;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        color: var(--t-primary);
        font-size: 0.85rem;
        transition: background 0.15s ease;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }

      .menu-item:hover {
        background: var(--bg-glass);
      }

      .menu-item.danger {
        color: #f87171;
      }

      .menu-item.danger:hover {
        background: hsla(0, 80%, 60%, 0.1);
      }

      .menu-item.toggle {
        justify-content: space-between;
      }

      .menu-item:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .menu-item .icon {
        font-size: 0.95rem;
        width: 20px;
        text-align: center;
        flex-shrink: 0;
      }

      .divider {
        height: 1px;
        background: var(--border-glass);
        margin: 4px 0;
      }

      .toggle-switch {
        width: 32px;
        height: 18px;
        background: var(--bg-glass);
        border-radius: 9px;
        position: relative;
        transition: background 0.2s ease;
        flex-shrink: 0;
      }

      .toggle-switch.active {
        background: var(--accent-primary);
      }

      .toggle-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s ease;
      }

      .toggle-switch.active::after {
        transform: translateX(14px);
      }
    `,
  ];

  @property({ type: Array })
  items: OverflowMenuItem[] = [];

  @state()
  private _open = false;

  private _boundClose = this._handleOutsideClick.bind(this);

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._boundClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._boundClose);
  }

  private _handleOutsideClick(e: MouseEvent) {
    if (this._open && !this.contains(e.composedPath()[0] as Node)) {
      this._open = false;
    }
  }

  render() {
    return html`
      <button class="trigger" @click=${this._toggle} title="More actions" aria-label="More actions">
        ⋯
      </button>
      ${this._open
        ? html`
            <div class="dropdown" role="menu">
              ${this.items.map((item) => html`
                ${item.dividerBefore ? html`<div class="divider"></div>` : ''}
                <button
                  class="menu-item ${item.danger ? 'danger' : ''} ${item.toggle ? 'toggle' : ''}"
                  role="menuitem"
                  ?disabled=${item.disabled}
                  @click=${() => this._handleSelect(item)}
                >
                  ${item.toggle
                    ? html`
                        <span style="display:flex;align-items:center;gap:8px;">
                          ${item.icon ? html`<span class="icon">${item.icon}</span>` : ''}
                          <span>${item.label}</span>
                        </span>
                        <span class="toggle-switch ${item.toggleActive ? 'active' : ''}"></span>
                      `
                    : html`
                        ${item.icon ? html`<span class="icon">${item.icon}</span>` : ''}
                        <span>${item.label}</span>
                      `}
                </button>
              `)}
            </div>
          `
        : ''}
    `;
  }

  private _toggle(e: Event) {
    e.stopPropagation();
    this._open = !this._open;
  }

  private _handleSelect(item: OverflowMenuItem) {
    if (item.disabled) return;
    // Don't close for toggle items — let the parent re-render with new state
    if (!item.toggle) {
      this._open = false;
    }
    this.dispatchEvent(
      new CustomEvent('menu-select', {
        detail: { id: item.id, item },
        bubbles: true,
        composed: true,
      })
    );
  }

  close() {
    this._open = false;
  }
}
