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
    `,
  ];

  @property({ type: Array })
  items: OverflowMenuItem[] = [];

  @state()
  private _open = false;

  private _portal: HTMLDivElement | null = null;
  private _boundClose = this._handleOutsideClick.bind(this);

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._boundClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._boundClose);
    this._removePortal();
  }

  private _handleOutsideClick(e: MouseEvent) {
    if (this._open) {
      const path = e.composedPath();
      const trigger = this.shadowRoot?.querySelector('.trigger');
      if (trigger && path.includes(trigger)) return;
      if (this._portal && path.includes(this._portal)) return;
      this._close();
    }
  }

  render() {
    return html`
      <button class="trigger" @click=${this._toggle} title="More actions" aria-label="More actions">
        ⋯
      </button>
    `;
  }

  private _toggle(e: Event) {
    e.stopPropagation();
    if (this._open) {
      this._close();
    } else {
      this._openMenu();
    }
  }

  private _openMenu() {
    const trigger = this.shadowRoot?.querySelector('.trigger') as HTMLElement;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    this._open = true;

    // Create portal on document.body to escape all overflow/containment
    this._removePortal();
    const portal = document.createElement('div');
    // Initially hidden for measurement
    portal.style.cssText = `
      position: fixed;
      top: 0;
      left: -9999px;
      z-index: 99999;
      min-width: 220px;
      background: #1a1a2e;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      font-family: 'Inter', sans-serif;
      padding: 4px 0;
    `;

    this.items.forEach((item) => {
      if (item.dividerBefore) {
        const divider = document.createElement('div');
        divider.style.cssText =
          'height: 1px; background: var(--border-glass, rgba(255,255,255,0.08)); margin: 4px 0;';
        portal.appendChild(divider);
      }

      const btn = document.createElement('button');
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        color: ${item.danger ? '#f87171' : 'var(--t-primary, #e2e8f0)'};
        font-size: 0.85rem;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        transition: background 0.15s ease;
        font-family: inherit;
        ${item.toggle ? 'justify-content: space-between;' : ''}
      `;
      btn.onmouseenter = () => {
        btn.style.background = item.danger
          ? 'hsla(0, 80%, 60%, 0.1)'
          : 'var(--bg-glass, rgba(255,255,255,0.05))';
      };
      btn.onmouseleave = () => {
        btn.style.background = 'none';
      };

      if (item.toggle) {
        const labelSpan = document.createElement('span');
        labelSpan.style.cssText = 'display:flex;align-items:center;gap:8px;';
        if (item.icon) {
          const iconSpan = document.createElement('span');
          iconSpan.style.cssText = 'font-size:0.95rem;width:20px;text-align:center;';
          iconSpan.textContent = item.icon;
          labelSpan.appendChild(iconSpan);
        }
        const textSpan = document.createElement('span');
        textSpan.textContent = item.label;
        labelSpan.appendChild(textSpan);
        btn.appendChild(labelSpan);

        const toggle = document.createElement('span');
        toggle.style.cssText = `
          width: 32px; height: 18px;
          background: ${item.toggleActive ? 'var(--accent-primary, #7c3aed)' : 'var(--bg-glass, rgba(255,255,255,0.05))'};
          border-radius: 9px; position: relative; flex-shrink: 0;
        `;
        const knob = document.createElement('span');
        knob.style.cssText = `
          position: absolute; top: 2px; left: 2px;
          width: 14px; height: 14px; background: white;
          border-radius: 50%; transition: transform 0.2s ease;
          ${item.toggleActive ? 'transform: translateX(14px);' : ''}
        `;
        toggle.appendChild(knob);
        btn.appendChild(toggle);
      } else {
        if (item.icon) {
          const iconSpan = document.createElement('span');
          iconSpan.style.cssText = 'font-size:0.95rem;width:20px;text-align:center;flex-shrink:0;';
          iconSpan.textContent = item.icon;
          btn.appendChild(iconSpan);
        }
        const textSpan = document.createElement('span');
        textSpan.textContent = item.label;
        btn.appendChild(textSpan);
      }

      btn.onclick = (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        if (!item.toggle) this._close();
        this.dispatchEvent(
          new CustomEvent('menu-select', {
            detail: { id: item.id, item },
            bubbles: true,
            composed: true,
          })
        );
      };

      portal.appendChild(btn);
    });

    document.body.appendChild(portal);

    // Measure actual size, then position within viewport
    const portalRect = portal.getBoundingClientRect();
    const menuW = portalRect.width;
    const menuH = portalRect.height;

    // Align right edge of menu with right edge of trigger
    let left = rect.right - menuW;
    let top = rect.bottom + 4;

    // Clamp horizontally
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;

    // Flip above trigger if not enough space below
    if (top + menuH > window.innerHeight - 8) {
      top = rect.top - menuH - 4;
    }

    portal.style.left = `${left}px`;
    portal.style.top = `${top}px`;

    this._portal = portal;
  }

  private _close() {
    this._open = false;
    this._removePortal();
  }

  private _removePortal() {
    if (this._portal) {
      this._portal.remove();
      this._portal = null;
    }
  }

  close() {
    this._close();
  }
}
