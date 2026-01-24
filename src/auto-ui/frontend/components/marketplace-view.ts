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

      .source-pill {
        font-size: 0.65rem;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .source-official {
        background: linear-gradient(135deg, hsl(210, 100%, 50%), hsl(240, 100%, 60%));
        color: white;
      }

      .source-community {
        background: linear-gradient(135deg, hsl(150, 60%, 45%), hsl(180, 60%, 45%));
        color: white;
      }

      .source-local {
        background: rgba(255,255,255,0.1);
        color: var(--t-muted);
        border: 1px solid var(--border-glass);
      }

      .card-meta {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
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

      /* Actions Toolbar */
      .actions-toolbar {
        display: flex;
        gap: var(--space-sm);
        margin-bottom: var(--space-lg);
        padding: var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        flex-wrap: wrap;
        align-items: center;
      }

      .toolbar-section {
        display: flex;
        gap: var(--space-sm);
        align-items: center;
      }

      .toolbar-section-title {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--t-muted);
        margin-right: var(--space-sm);
      }

      .toolbar-divider {
        width: 1px;
        height: 24px;
        background: var(--border-glass);
        margin: 0 var(--space-sm);
      }

      /* Unified button style for all toolbar buttons */
      .toolbar-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px;
        background: var(--bg-glass-strong);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .toolbar-btn:hover {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .toolbar-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .toolbar-btn .icon {
        font-size: 1rem;
        line-height: 1;
      }

      .toolbar-btn.primary {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .toolbar-btn.primary:hover {
        opacity: 0.9;
      }

      /* Legacy alias for backwards compatibility */
      .maker-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px;
        background: var(--bg-glass-strong);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .maker-btn:hover {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .maker-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .maker-btn .icon {
        font-size: 1rem;
        line-height: 1;
      }

      /* Add Marketplace Modal */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(4px);
      }

      .modal {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        width: 90%;
        max-width: 450px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-md);
        border-bottom: 1px solid var(--border-glass);
      }

      .modal-header h3 {
        margin: 0;
        font-size: 1.1rem;
      }

      .modal-close {
        background: none;
        border: none;
        color: var(--t-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
      }

      .modal-close:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
      }

      .modal-body {
        padding: var(--space-md);
      }

      .modal-body input {
        width: 100%;
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        border-radius: var(--radius-sm);
        font-size: 0.95rem;
        margin-bottom: var(--space-sm);
        box-sizing: border-box;
      }

      .modal-body input:focus {
        outline: none;
        border-color: var(--accent-primary);
      }

      .modal-hint {
        font-size: 0.8rem;
        color: var(--t-muted);
        line-height: 1.5;
      }

      .modal-hint code {
        background: var(--bg-glass);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.75rem;
      }

      .formats-table {
        width: 100%;
        font-size: 0.8rem;
        border-collapse: collapse;
        margin-top: var(--space-md);
      }

      .formats-table td {
        padding: 6px 0;
        vertical-align: middle;
      }

      .formats-table .type-label {
        color: var(--t-muted);
        font-size: 0.75rem;
        width: 80px;
        font-weight: 500;
      }

      .formats-table td code {
        background: var(--bg-glass);
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.75rem;
        color: var(--t-secondary);
      }

      .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-sm);
        padding: var(--space-md);
        border-top: 1px solid var(--border-glass);
      }
    `
    ];

    @state()
    private _items: MarketplaceItem[] = [];

    @state()
    private _loading = false;

    @state()
    private _installing: string | null = null;

    @state()
    private _showAddRepoModal = false;

    @state()
    private _repoInput = '';

    async connectedCallback() {
        super.connectedCallback();
        this._fetchItems();
    }

    render() {
        return html`
      <!-- Actions Toolbar -->
      <div class="actions-toolbar">
        <div class="toolbar-section">
          <span class="toolbar-section-title">Create</span>
          <button class="toolbar-btn" @click=${this._createNew} title="Create a new photon">
            <span class="icon">✨</span>
            <span>New Photon</span>
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-section">
          <span class="toolbar-section-title">Marketplaces</span>
          <button class="toolbar-btn primary" @click=${() => this._showAddRepoModal = true} title="Add a new marketplace">
            <span class="icon">+</span>
            <span>Add Marketplace</span>
          </button>
          <button class="toolbar-btn" @click=${this._syncPhotons} title="Sync marketplace cache">
            <span class="icon">🔄</span>
            <span>Sync</span>
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-section">
          <span class="toolbar-section-title">Tools</span>
          <button class="toolbar-btn" @click=${this._validatePhotons} title="Validate all photons">
            <span class="icon">✓</span>
            <span>Validate</span>
          </button>
        </div>
      </div>

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

      ${this._showAddRepoModal ? this._renderAddRepoModal() : ''}
    `;
    }

    private _renderAddRepoModal() {
        return html`
      <div class="modal-overlay" @click=${(e: Event) => {
            if (e.target === e.currentTarget) this._showAddRepoModal = false;
        }}>
        <div class="modal">
          <div class="modal-header">
            <h3>Add Marketplace</h3>
            <button class="modal-close" @click=${() => this._showAddRepoModal = false}>✕</button>
          </div>
          <div class="modal-body">
            <input
              type="text"
              placeholder="Enter GitHub repo, local path, or URL"
              .value=${this._repoInput}
              @input=${(e: Event) => this._repoInput = (e.target as HTMLInputElement).value}
              @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this._addRepository();
        }}
              autofocus
            >
            <table class="formats-table">
              <tbody>
                <tr><td class="type-label">GitHub</td><td><code>username/repo</code></td></tr>
                <tr><td class="type-label">GitHub URL</td><td><code>https://github.com/user/repo</code></td></tr>
                <tr><td class="type-label">SSH</td><td><code>git@github.com:user/repo.git</code></td></tr>
                <tr><td class="type-label">Local</td><td><code>~/path/to/folder</code></td></tr>
                <tr><td class="type-label">URL</td><td><code>https://example.com/photons.json</code></td></tr>
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="toolbar-btn" @click=${() => this._showAddRepoModal = false}>Cancel</button>
            <button class="toolbar-btn primary" @click=${this._addRepository}>Add</button>
          </div>
        </div>
      </div>
    `;
    }

    private _renderItem(item: MarketplaceItem) {
        const isInstalling = this._installing === item.name;
        const sourceClass = this._getSourceClass(item.marketplace);
        const sourceLabel = this._getSourceLabel(item.marketplace);

        return html`
      <div class="card glass">
        <div class="card-header">
          <div>
            <div class="card-title">${item.name}</div>
            <div class="card-author">by ${item.author}</div>
          </div>
          <div class="card-meta">
            <span class="source-pill ${sourceClass}">${sourceLabel}</span>
            <div class="tag" style="background: var(--accent-secondary); color: black;">${item.version}</div>
          </div>
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

    private _getSourceClass(marketplace: string): string {
        const lower = marketplace?.toLowerCase() || '';
        if (lower.includes('official') || lower === 'photon' || lower === 'portel') {
            return 'source-official';
        }
        if (lower.includes('community') || lower.includes('github')) {
            return 'source-community';
        }
        return 'source-local';
    }

    private _getSourceLabel(marketplace: string): string {
        const lower = marketplace?.toLowerCase() || '';
        if (lower.includes('official') || lower === 'photon' || lower === 'portel') {
            return 'Official';
        }
        if (lower.includes('community')) {
            return 'Community';
        }
        if (lower.includes('github')) {
            return 'GitHub';
        }
        return marketplace || 'Local';
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

    // Maker static method actions
    private _createNew() {
        this.dispatchEvent(new CustomEvent('maker-action', {
            detail: { action: 'new' },
            bubbles: true,
            composed: true
        }));
    }

    private _syncPhotons() {
        this.dispatchEvent(new CustomEvent('maker-action', {
            detail: { action: 'sync' },
            bubbles: true,
            composed: true
        }));
    }

    private _validatePhotons() {
        this.dispatchEvent(new CustomEvent('maker-action', {
            detail: { action: 'validate' },
            bubbles: true,
            composed: true
        }));
    }

    private async _addRepository() {
        const source = this._repoInput.trim();
        if (!source) {
            showToast('Please enter a marketplace location', 'error');
            return;
        }

        try {
            const res = await fetch('/api/marketplace/sources/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to add repository');
            }

            this._showAddRepoModal = false;
            this._repoInput = '';
            showToast(data.added ? `Added: ${data.name}` : `Already exists: ${data.name}`, 'success');

            // Refresh the marketplace list
            this._fetchItems();
        } catch (e: any) {
            showToast(e.message || 'Failed to add repository', 'error', 5000);
        }
    }
}
