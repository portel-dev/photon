import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
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
        display: flex;
        flex-direction: column;
        height: 100%;
        color: var(--t-primary);
      }

      .sidebar-content {
        flex: 1;
        overflow-y: auto;
      }

      .sidebar-footer {
        padding: var(--space-sm) var(--space-md);
        border-top: 1px solid var(--border-glass);
        display: flex;
        justify-content: center;
        gap: var(--space-md);
      }

      .footer-link {
        color: var(--t-muted);
        font-size: 0.75rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: color 0.2s;
        background: none;
        border: none;
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-sm);
      }

      .footer-link:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
      }

      .footer-link kbd {
        font-size: 0.65rem;
        padding: 1px 4px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: 3px;
        font-family: var(--font-mono);
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

      .method-count.unconfigured {
        background: hsla(45, 80%, 50%, 0.15);
        border-color: hsla(45, 80%, 50%, 0.3);
        color: hsl(45, 80%, 50%);
      }

      .marketplace-btn {
        width: 100%;
        margin-top: var(--space-md);
        padding: var(--space-sm);
        background: var(--bg-glass-strong);
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
        background: var(--bg-panel);
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

      /* Favorites */
      .filter-row {
        display: flex;
        gap: var(--space-sm);
        margin-top: var(--space-sm);
      }

      .filter-btn {
        flex: 1;
        padding: var(--space-xs) var(--space-sm);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        cursor: pointer;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-size: 0.8rem;
        transition: all 0.2s;
      }

      .filter-btn:hover {
        background: var(--bg-glass-strong);
      }

      .filter-btn.active {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .star-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        font-size: 0.9rem;
        opacity: 0.3;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .star-btn:hover {
        opacity: 0.7;
        transform: scale(1.1);
      }

      .star-btn.favorited {
        opacity: 1;
      }

      .photon-item .star-btn {
        visibility: hidden;
      }

      .photon-item:hover .star-btn,
      .photon-item .star-btn.favorited {
        visibility: visible;
      }
    `
  ];

  @property({ type: Array })
  photons: PhotonItem[] = [];

  @property({ type: String })
  selectedPhoton: string | null = null;

  @property({ type: String })
  theme: Theme = 'dark';

  @state()
  private _searchQuery = '';

  @state()
  private _showFavoritesOnly = false;

  @state()
  private _favorites: Set<string> = new Set();

  @query('input')
  private _searchInput!: HTMLInputElement;

  private static FAVORITES_KEY = 'beam-favorites';

  connectedCallback() {
    super.connectedCallback();
    this._loadFavorites();
  }

  private _loadFavorites() {
    try {
      const stored = localStorage.getItem(BeamSidebar.FAVORITES_KEY);
      if (stored) {
        this._favorites = new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Failed to load favorites:', e);
    }
  }

  private _saveFavorites() {
    try {
      localStorage.setItem(BeamSidebar.FAVORITES_KEY, JSON.stringify([...this._favorites]));
    } catch (e) {
      console.warn('Failed to save favorites:', e);
    }
  }

  private get _filteredPhotons() {
    let filtered = this.photons;

    // Filter by favorites if enabled
    if (this._showFavoritesOnly) {
      filtered = filtered.filter(p => this._favorites.has(p.name));
    }

    // Filter by search query
    if (this._searchQuery.trim()) {
      const query = this._searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        (p.description && p.description.toLowerCase().includes(query))
      );
    }

    return filtered;
  }

  private get _apps() {
    return this._filteredPhotons.filter(p => p.isApp);
  }

  private get _configured() {
    return this._filteredPhotons.filter(p => !p.isApp && p.methods && p.methods.length > 0);
  }

  private get _needsSetup() {
    return this._filteredPhotons.filter(p => !p.isApp && (!p.methods || p.methods.length === 0));
  }

  render() {
    return html`
      <div class="sidebar-content">
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
            <input
              type="text"
              placeholder="Search photons... (⌘K)"
              .value=${this._searchQuery}
              @input=${this._handleSearch}
              @keydown=${this._handleSearchKeydown}
            >
          </div>
          <div class="filter-row">
            <button
              class="filter-btn ${this._showFavoritesOnly ? 'active' : ''}"
              @click=${this._toggleFavoritesFilter}
              title="Show favorites only (f)"
            >
              ⭐ Favorites ${this._favorites.size > 0 ? `(${this._favorites.size})` : ''}
            </button>
            <button
              class="filter-btn"
              @click=${() => this.dispatchEvent(new CustomEvent('marketplace'))}
            >
              🛍️ Marketplace
            </button>
          </div>
        </div>

        ${this._apps.length > 0 ? html`
          <div class="section-header">Apps</div>
          <ul class="photon-list">
            ${this._apps.map(photon => this._renderPhotonItem(photon, 'app'))}
          </ul>
        ` : ''}

        ${this._configured.length > 0 ? html`
          <div class="section-header">MCPs</div>
          <ul class="photon-list">
            ${this._configured.map(photon => this._renderPhotonItem(photon, 'configured'))}
          </ul>
        ` : ''}

        ${this._needsSetup.length > 0 ? html`
          <div class="section-header">Setup</div>
          <ul class="photon-list">
            ${this._needsSetup.map(photon => this._renderPhotonItem(photon, 'unconfigured'))}
          </ul>
        ` : ''}
      </div>

      <div class="sidebar-footer">
        <button class="footer-link" @click=${this._showShortcuts} title="Keyboard shortcuts">
          ⌨️ Shortcuts <kbd>?</kbd>
        </button>
      </div>
    `;
  }

  private _showShortcuts() {
    this.dispatchEvent(new CustomEvent('show-shortcuts', { bubbles: true, composed: true }));
  }

  private _renderPhotonItem(photon: PhotonItem, type: 'app' | 'configured' | 'unconfigured') {
    const methodCount = photon.methods?.length || 0;
    const isApp = type === 'app';
    const isUnconfigured = type === 'unconfigured';
    const isFavorited = this._favorites.has(photon.name);

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
        </div>
        <button
          class="star-btn ${isFavorited ? 'favorited' : ''}"
          @click=${(e: Event) => this._toggleFavorite(e, photon.name)}
          title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
        >${isFavorited ? '⭐' : '☆'}</button>
        ${isUnconfigured
          ? html`<span class="method-count unconfigured">?</span>`
          : methodCount > 0
            ? html`<span class="method-count">${methodCount}</span>`
            : ''}
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
    this._searchQuery = (e.target as HTMLInputElement).value;
  }

  private _handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this._searchQuery = '';
      this._searchInput.value = '';
      this._searchInput.blur();
    }
  }

  private _selectPhoton(photon: PhotonItem) {
    this.dispatchEvent(new CustomEvent('select', { detail: { photon } }));
  }

  private _toggleFavorite(e: Event, photonName: string) {
    e.stopPropagation(); // Don't select the photon
    const newFavorites = new Set(this._favorites);
    if (newFavorites.has(photonName)) {
      newFavorites.delete(photonName);
    } else {
      newFavorites.add(photonName);
    }
    this._favorites = newFavorites;
    this._saveFavorites();
  }

  private _toggleFavoritesFilter() {
    this._showFavoritesOnly = !this._showFavoritesOnly;
  }

  // Public methods for keyboard navigation from parent
  focusSearch() {
    this._searchInput?.focus();
  }

  clearSearch() {
    this._searchQuery = '';
    if (this._searchInput) {
      this._searchInput.value = '';
    }
  }

  getAllPhotons(): PhotonItem[] {
    return this._filteredPhotons;
  }

  toggleFavoritesFilter() {
    this._toggleFavoritesFilter();
  }

  isFavoritesFilterActive(): boolean {
    return this._showFavoritesOnly;
  }
}
