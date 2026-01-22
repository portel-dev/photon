import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';

interface PhotonItem {
  name: string;
  description: string;
  isApp?: boolean;
  appEntry?: any;
  methods?: any[];
}

@customElement('beam-sidebar')
export class BeamSidebar extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        height: 100%;
        color: var(--t-primary);
        overflow-y: auto;
      }

      .header {
        padding: var(--space-md);
        border-bottom: 1px solid var(--border-glass);
      }

      .header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .logo {
        font-size: 1.2rem;
        font-weight: 600;
        margin: 0;
      }

      .theme-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: 20px;
        padding: 4px;
        cursor: pointer;
      }

      .theme-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: all 0.2s;
      }

      .theme-btn.active {
        background: var(--accent-primary);
        color: white;
      }

      .theme-btn:not(.active) {
        color: var(--t-muted);
      }

      .theme-btn:hover:not(.active) {
        background: var(--bg-glass-strong);
      }

      .search-box {
        margin-top: var(--space-md);
        position: relative;
      }

      input {
        width: 100%;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        box-sizing: border-box;
      }

      input:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .section-header {
        padding: var(--space-sm) var(--space-md);
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-muted);
        margin-top: var(--space-sm);
      }

      .photon-list {
        list-style: none;
        padding: 0 var(--space-sm);
        margin: 0;
      }

      .photon-item {
        padding: var(--space-sm) var(--space-md);
        margin-bottom: var(--space-xs);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .photon-item:hover {
        background: hsla(220, 10%, 80%, 0.1);
      }

      .photon-item.active {
        background: linear-gradient(90deg, var(--glow-primary), transparent);
        border-left: 2px solid var(--accent-primary);
      }

      .photon-icon {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        background: var(--bg-glass);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--accent-secondary);
        flex-shrink: 0;
      }

      .photon-icon.app-icon {
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        color: white;
        border-radius: 8px;
      }

      .photon-info {
        min-width: 0;
        flex: 1;
      }

      .photon-name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .photon-desc {
        font-size: 0.8em;
        color: var(--t-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .method-count {
        font-size: 0.65rem;
        padding: 2px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        border-radius: 10px;
        font-weight: 500;
        flex-shrink: 0;
      }

      .marketplace-btn {
        width: 100%;
        margin-top: var(--space-md);
        padding: var(--space-sm);
        background: linear-gradient(135deg, var(--bg-glass), hsla(220, 10%, 20%, 0.5));
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        cursor: pointer;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-sm);
        font-weight: 500;
        transition: all 0.2s ease;
      }

      .marketplace-btn:hover {
        background: hsla(220, 10%, 25%, 0.8);
        border-color: var(--accent-secondary);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        transform: translateY(-1px);
      }

      .empty-section {
        padding: var(--space-sm) var(--space-md);
        color: var(--t-muted);
        font-size: 0.85rem;
        font-style: italic;
      }
    `
  ];

  @property({ type: Array })
  photons: PhotonItem[] = [];

  @property({ type: String })
  selectedPhoton: string | null = null;

  @property({ type: String })
  theme: Theme = 'dark';

  private get _apps() {
    return this.photons.filter(p => p.isApp);
  }

  private get _tools() {
    return this.photons.filter(p => !p.isApp);
  }

  render() {
    return html`
      <div class="header">
        <div class="header-row">
          <h2 class="text-gradient logo">Photon Beam</h2>
          <div class="theme-toggle">
            <button
              class="theme-btn ${this.theme === 'light' ? 'active' : ''}"
              @click=${() => this._setTheme('light')}
              title="Light theme"
            >☀️</button>
            <button
              class="theme-btn ${this.theme === 'dark' ? 'active' : ''}"
              @click=${() => this._setTheme('dark')}
              title="Dark theme"
            >🌙</button>
          </div>
        </div>
        <div class="search-box">
          <input type="text" placeholder="Search photons..." @input=${this._handleSearch}>
        </div>
        <button
            class="marketplace-btn"
            @click=${() => this.dispatchEvent(new CustomEvent('marketplace'))}
        >
            <span>🛍️</span> Open Marketplace
        </button>
      </div>

      ${this._apps.length > 0 ? html`
        <div class="section-header">Apps</div>
        <ul class="photon-list">
          ${this._apps.map(photon => this._renderPhotonItem(photon, true))}
        </ul>
      ` : ''}

      <div class="section-header">Tools</div>
      <ul class="photon-list">
        ${this._tools.length > 0
          ? this._tools.map(photon => this._renderPhotonItem(photon, false))
          : html`<li class="empty-section">No tools available</li>`
        }
      </ul>
    `;
  }

  private _renderPhotonItem(photon: PhotonItem, isApp: boolean) {
    const methodCount = photon.methods?.length || 0;
    return html`
      <li
        class="photon-item ${this.selectedPhoton === photon.name ? 'active' : ''}"
        @click=${() => this._selectPhoton(photon)}
      >
        <div class="photon-icon ${isApp ? 'app-icon' : ''}">
          ${isApp ? '📱' : photon.name.substring(0, 2).toUpperCase()}
        </div>
        <div class="photon-info">
          <div class="photon-name">${photon.name}</div>
          <div class="photon-desc">${photon.description || (isApp ? 'Full application' : 'Photon tool')}</div>
        </div>
        ${methodCount > 0 ? html`<span class="method-count">${methodCount}</span>` : ''}
      </li>
    `;
  }

  private _setTheme(theme: Theme) {
    this.dispatchEvent(new CustomEvent('theme-change', {
      detail: { theme },
      bubbles: true,
      composed: true
    }));
  }

  private _handleSearch(e: Event) {
    const query = (e.target as HTMLInputElement).value;
    this.dispatchEvent(new CustomEvent('search', { detail: { query } }));
  }

  private _selectPhoton(photon: PhotonItem) {
    this.dispatchEvent(new CustomEvent('select', { detail: { photon } }));
  }
}
