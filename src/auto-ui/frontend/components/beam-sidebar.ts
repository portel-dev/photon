import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface PhotonItem {
  name: string;
  description: string;
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

      .logo {
        font-size: 1.2rem;
        font-weight: 600;
        margin: 0;
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

      .photon-list {
        list-style: none;
        padding: var(--space-sm);
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
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: var(--bg-glass);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--accent-secondary);
      }
    `
  ];

  @property({ type: Array })
  photons: PhotonItem[] = [];

  @property({ type: String })
  selectedPhoton: string | null = null;

  render() {
    return html`
      <div class="header">
        <h2 class="text-gradient logo">Photon Beam</h2>
        <div class="search-box">
          <input type="text" placeholder="Search photons..." @input=${this._handleSearch}>
        </div>
        <button 
            style="width:100%; margin-top:10px; padding:8px; background:var(--bg-glass); border:1px solid var(--border-glass); color:var(--t-primary); cursor:pointer; border-radius:var(--radius-sm);"
            @click=${() => this.dispatchEvent(new CustomEvent('marketplace'))}
        >
            🛍️ Open Marketplace
        </button>
      </div>
      
      <ul class="photon-list">
        ${this.photons.map(photon => html`
          <li 
            class="photon-item ${this.selectedPhoton === photon.name ? 'active' : ''}"
            @click=${() => this._selectPhoton(photon)}
          >
            <div class="photon-icon">${photon.name.substring(0, 2).toUpperCase()}</div>
            <div class="photon-info">
              <div style="font-weight: 500;">${photon.name}</div>
              <div style="font-size: 0.8em; color: var(--t-muted);">${photon.description}</div>
            </div>
          </li>
        `)}
      </ul>
    `;
  }

  private _handleSearch(e: Event) {
    const query = (e.target as HTMLInputElement).value;
    this.dispatchEvent(new CustomEvent('search', { detail: { query } }));
  }

  private _selectPhoton(photon: PhotonItem) {
    this.dispatchEvent(new CustomEvent('select', { detail: { photon } }));
  }
}
