import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

interface MarketplaceItem {
    name: string;
    description: string;
    author: string;
    tags: string[];
    marketplace: string;
    version: string;
}

@customElement('marketplace-view')
export class MarketplaceView extends LitElement {
    static styles = [
        theme,
        css`
      :host {
        display: block;
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .toolbar {
        display: flex;
        gap: var(--space-md);
        margin-bottom: var(--space-lg);
      }

      .search-box {
        flex: 1;
        position: relative;
      }

      .search-box input {
        width: 100%;
        padding: var(--space-sm) var(--space-lg);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        border-radius: var(--radius-md);
        font-size: 1rem;
        transition: all 0.2s;
      }

      .search-box input:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-md);
        overflow-y: auto;
        padding-bottom: var(--space-xl);
      }

      .card {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        border-color: var(--accent-secondary);
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--space-sm);
      }

      .card-title {
        font-weight: 600;
        font-size: 1.1rem;
        color: var(--t-primary);
      }

      .card-author {
        font-size: 0.8rem;
        color: var(--t-muted);
      }

      .card-desc {
        flex: 1;
        font-size: 0.9rem;
        color: var(--t-muted);
        line-height: 1.4;
        margin-bottom: var(--space-md);
      }

      .tags {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-bottom: var(--space-md);
      }

      .tag {
        font-size: 0.7rem;
        padding: 2px 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 10px;
        color: var(--t-muted);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
      }

      .btn-install {
        background: var(--accent-primary);
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-weight: 500;
        transition: opacity 0.2s;
      }

      .btn-install:hover {
        opacity: 0.9;
      }
      
      .btn-install:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--t-muted);
      }
    `
    ];

    @state()
    private _items: MarketplaceItem[] = [];

    @state()
    private _loading = false;

    @state()
    private _installing: string | null = null;

    async connectedCallback() {
        super.connectedCallback();
        this._fetchItems();
    }

    render() {
        return html`
      <div class="toolbar">
        <div class="search-box">
          <input 
            type="text" 
            placeholder="Search photons..." 
            @input=${this._handleSearch}
          >
        </div>
      </div>

      ${this._loading
                ? html`<div style="text-align: center; color: var(--t-muted); padding: 40px;">Loading marketplace...</div>`
                : html`
            <div class="grid">
              ${this._items.map(item => this._renderItem(item))}
            </div>
          `
            }
    `;
    }

    private _renderItem(item: MarketplaceItem) {
        const isInstalling = this._installing === item.name;

        return html`
      <div class="card glass">
        <div class="card-header">
          <div>
            <div class="card-title">${item.name}</div>
            <div class="card-author">by ${item.author}</div>
          </div>
          <div class="tag" style="background: var(--accent-secondary); color: black;">${item.version}</div>
        </div>
        
        <div class="card-desc">${item.description}</div>

        <div class="tags">
          ${item.tags.map(tag => html`<span class="tag">${tag}</span>`)}
        </div>

        <div class="actions">
          <button 
            class="btn-install" 
            ?disabled=${isInstalling}
            @click=${() => this._install(item)}
          >
            ${isInstalling ? 'Installing...' : 'Install'}
          </button>
        </div>
      </div>
    `;
    }

    private async _fetchItems(query = '') {
        this._loading = true;
        try {
            const endpoint = query
                ? `/api/marketplace/search?q=${encodeURIComponent(query)}`
                : '/api/marketplace/list';

            const res = await fetch(endpoint);
            const data = await res.json();
            this._items = data.photons || [];
        } catch (e) {
            console.error('Failed to fetch marketplace', e);
        } finally {
            this._loading = false;
        }
    }

    // Debounce search
    private _searchTimeout: any;
    private _handleSearch(e: Event) {
        const query = (e.target as HTMLInputElement).value;
        clearTimeout(this._searchTimeout);
        this._searchTimeout = setTimeout(() => {
            this._fetchItems(query);
        }, 300);
    }

    private async _install(item: MarketplaceItem) {
        this._installing = item.name;
        try {
            const res = await fetch('/api/marketplace/add', {
                method: 'POST',
                body: JSON.stringify({ name: item.name })
            });

            if (res.ok) {
                this.dispatchEvent(new CustomEvent('install', {
                    detail: { name: item.name },
                    bubbles: true,
                    composed: true
                }));
                showToast(`Successfully installed ${item.name}`, 'success');
            } else {
                const err = await res.json();
                showToast(`Failed to install: ${err.error}`, 'error', 5000);
            }
        } catch (e) {
            showToast('Installation failed', 'error', 5000);
        } finally {
            this._installing = null;
        }
    }
}
