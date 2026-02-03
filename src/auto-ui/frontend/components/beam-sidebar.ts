import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';

interface PhotonItem {
  name: string;
  description: string;
  isApp?: boolean;
  appEntry?: any;
  methods?: any[];
  icon?: string;
  internal?: boolean;
  version?: string;
  resourceCount?: number;
  promptCount?: number;
  hasUpdate?: boolean;
  path?: string;
  // External MCP fields
  isExternalMCP?: boolean;
  connected?: boolean;
  errorMessage?: string;
  // MCP Apps Extension fields
  hasMcpApp?: boolean;
  mcpAppUri?: string;
  mcpAppUris?: string[];
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
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-indicator.connected {
        background: #4ade80;
        box-shadow: 0 0 6px #4ade80;
      }

      .status-indicator.reconnecting {
        background: #fbbf24;
        box-shadow: 0 0 6px #fbbf24;
        animation: pulse 1s ease-in-out infinite;
      }

      .status-indicator.disconnected {
        background: #f87171;
        box-shadow: 0 0 6px #f87171;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
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

      .photon-icon.app-icon,
      .photon-icon.emoji-icon {
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        color: white;
        border-radius: 8px;
        font-size: 16px;
      }

      .photon-item.internal {
        opacity: 0.85;
      }

      .internal-badge {
        font-size: 0.6rem;
        padding: 1px 4px;
        background: linear-gradient(135deg, hsl(280, 60%, 50%), hsl(320, 60%, 50%));
        color: white;
        border-radius: 3px;
        text-transform: uppercase;
        font-weight: 600;
        letter-spacing: 0.03em;
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

      .counts-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.65rem;
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border-glass);
        border-radius: 10px;
        font-weight: 500;
        flex-shrink: 0;
      }

      .count-tools {
        color: hsl(210, 80%, 65%);
      }
      .count-prompts {
        color: hsl(140, 60%, 55%);
      }
      .count-resources {
        color: hsl(30, 80%, 60%);
      }

      .version-badge {
        font-size: 0.6rem;
        color: var(--t-muted);
        opacity: 0.7;
      }

      .update-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: hsl(0, 80%, 55%);
        margin-left: 2px;
        flex-shrink: 0;
      }

      .update-badge {
        font-size: 0.6rem;
        padding: 1px 5px;
        background: hsl(0, 80%, 55%);
        color: white;
        border-radius: 8px;
        font-weight: 600;
        flex-shrink: 0;
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
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        transform: translateY(-1px);
      }

      .empty-section {
        padding: var(--space-sm) var(--space-md);
        color: var(--t-muted);
        font-size: 0.85rem;
        font-style: italic;
      }

      /* External MCPs */
      .photon-icon.external-mcp-icon {
        background: linear-gradient(135deg, hsl(200, 60%, 45%), hsl(220, 60%, 55%));
        color: white;
        border-radius: 8px;
        font-size: 14px;
      }

      .photon-item.disconnected {
        opacity: 0.6;
      }

      .photon-item.disconnected .photon-icon {
        background: var(--bg-glass);
        color: var(--t-muted);
      }

      .disconnect-badge {
        font-size: 0.55rem;
        padding: 1px 4px;
        background: hsla(0, 60%, 50%, 0.2);
        color: hsl(0, 60%, 55%);
        border: 1px solid hsla(0, 60%, 50%, 0.3);
        border-radius: 3px;
        text-transform: uppercase;
        font-weight: 600;
        letter-spacing: 0.03em;
      }

      .reconnect-btn {
        font-size: 0.65rem;
        padding: 2px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .reconnect-btn:hover {
        background: var(--bg-glass-strong);
        color: var(--t-primary);
        border-color: var(--accent-primary);
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

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .header {
          padding: var(--space-lg) var(--space-md);
          padding-top: calc(var(--space-lg) + 8px);
        }

        .photon-item {
          padding: var(--space-md);
          min-height: 44px;
        }

        .photon-item .star-btn {
          visibility: visible;
          padding: var(--space-sm);
        }

        .filter-btn {
          min-height: 44px;
          font-size: 0.85rem;
        }

        input {
          min-height: 44px;
          font-size: 16px; /* Prevent iOS zoom on focus */
        }

        .theme-btn {
          width: 36px;
          height: 36px;
        }

        .footer-link {
          min-height: 44px;
          padding: var(--space-sm) var(--space-md);
        }
      }
    `,
  ];

  @property({ type: Array })
  photons: PhotonItem[] = [];

  @property({ type: Array })
  externalMCPs: PhotonItem[] = [];

  @property({ type: String })
  selectedPhoton: string | null = null;

  @property({ type: String })
  theme: Theme = 'dark';

  @property({ type: Boolean })
  connected = false;

  @property({ type: Boolean })
  reconnecting = false;

  @property({ type: Number })
  updatesAvailable = 0;

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
    // Exclude internal photons — their static methods appear in the marketplace/global area
    let filtered = this.photons.filter((p) => !p.internal);

    // Filter by favorites if enabled
    if (this._showFavoritesOnly) {
      filtered = filtered.filter((p) => this._favorites.has(p.name));
    }

    // Filter by search query
    if (this._searchQuery.trim()) {
      const query = this._searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query))
      );
    }

    return filtered;
  }

  private get _apps() {
    return this._filteredPhotons.filter((p) => p.isApp);
  }

  private get _configured() {
    return this._filteredPhotons.filter((p) => !p.isApp && p.methods && p.methods.length > 0);
  }

  private get _needsSetup() {
    return this._filteredPhotons.filter((p) => !p.isApp && (!p.methods || p.methods.length === 0));
  }

  private get _filteredExternalMCPs() {
    let filtered = this.externalMCPs;

    // Filter by search query
    if (this._searchQuery.trim()) {
      const query = this._searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          (m.description && m.description.toLowerCase().includes(query))
      );
    }

    return filtered;
  }

  render() {
    return html`
      <nav class="sidebar-content" role="navigation" aria-label="Photon navigation">
        <div class="header">
          <div class="header-row">
            <h2 class="text-gradient logo">
              Photon Beam
              <span
                class="status-indicator ${this.connected
                  ? 'connected'
                  : this.reconnecting
                    ? 'reconnecting'
                    : 'disconnected'}"
                title="${this.connected
                  ? 'Connected'
                  : this.reconnecting
                    ? 'Reconnecting...'
                    : 'Disconnected'}"
              ></span>
            </h2>
            <div class="theme-toggle" role="group" aria-label="Theme selection">
              <button
                class="theme-btn ${this.theme === 'light' ? 'active' : ''}"
                @click=${() => this._setTheme('light')}
                title="Light theme"
                aria-label="Switch to light theme"
                aria-pressed="${this.theme === 'light'}"
              >
                ☀️
              </button>
              <button
                class="theme-btn ${this.theme === 'dark' ? 'active' : ''}"
                @click=${() => this._setTheme('dark')}
                title="Dark theme"
                aria-label="Switch to dark theme"
                aria-pressed="${this.theme === 'dark'}"
              >
                🌙
              </button>
            </div>
          </div>
          <div class="search-box" role="search">
            <input
              type="search"
              placeholder="Search photons... (⌘K)"
              .value=${this._searchQuery}
              @input=${this._handleSearch}
              @keydown=${this._handleSearchKeydown}
              aria-label="Search photons"
            />
          </div>
          <div class="filter-row" role="group" aria-label="Filter options">
            <button
              class="filter-btn ${this._showFavoritesOnly ? 'active' : ''}"
              @click=${this._toggleFavoritesFilter}
              title="Show favorites only (f)"
              aria-pressed="${this._showFavoritesOnly}"
              aria-label="Filter by favorites"
            >
              ⭐ Favorites ${this._favorites.size > 0 ? `(${this._favorites.size})` : ''}
            </button>
            <button
              class="filter-btn"
              @click=${() => this.dispatchEvent(new CustomEvent('marketplace'))}
              aria-label="Open marketplace"
            >
              🛍️ Marketplace
              ${this.updatesAvailable > 0
                ? html`<span class="update-badge">${this.updatesAvailable}</span>`
                : ''}
            </button>
          </div>
        </div>

        ${this._apps.length > 0
          ? html`
              <div class="section-header" id="apps-header">Apps</div>
              <ul class="photon-list" role="listbox" aria-labelledby="apps-header">
                ${this._apps.map((photon) => this._renderPhotonItem(photon, 'app'))}
              </ul>
            `
          : ''}
        ${this._configured.length > 0
          ? html`
              <div class="section-header" id="mcps-header">MCPs</div>
              <ul class="photon-list" role="listbox" aria-labelledby="mcps-header">
                ${this._configured.map((photon) => this._renderPhotonItem(photon, 'configured'))}
              </ul>
            `
          : ''}
        ${this._needsSetup.length > 0
          ? html`
              <div class="section-header" id="setup-header">Setup</div>
              <ul class="photon-list" role="listbox" aria-labelledby="setup-header">
                ${this._needsSetup.map((photon) => this._renderPhotonItem(photon, 'unconfigured'))}
              </ul>
            `
          : ''}
        ${this._filteredExternalMCPs.length > 0
          ? html`
              <div class="section-header" id="external-mcps-header">External MCPs</div>
              <ul class="photon-list" role="listbox" aria-labelledby="external-mcps-header">
                ${this._filteredExternalMCPs.map((mcp) => this._renderExternalMCPItem(mcp))}
              </ul>
            `
          : ''}
      </nav>

      <div class="sidebar-footer">
        <button
          class="footer-link"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('diagnostics', { bubbles: true, composed: true }))}
          title="Server diagnostics"
          aria-label="Show diagnostics"
        >
          🔍 Status
        </button>
        <button
          class="footer-link"
          @click=${this._showShortcuts}
          title="Keyboard shortcuts"
          aria-label="Show keyboard shortcuts"
        >
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

    // Determine icon: use photon's icon if available, otherwise default
    const displayIcon = photon.icon || (isApp ? '📱' : photon.name.substring(0, 2).toUpperCase());
    const hasCustomIcon = !!photon.icon;

    return html`
      <li
        class="photon-item ${this.selectedPhoton === photon.name ? 'active' : ''} ${photon.internal
          ? 'internal'
          : ''}"
        role="option"
        aria-selected="${this.selectedPhoton === photon.name}"
        tabindex="0"
        @click=${() => this._selectPhoton(photon)}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._selectPhoton(photon)}
        title="${photon.description || photon.name}${photon.path ? `\n${photon.path}` : ''}"
      >
        <div class="photon-icon ${isApp || hasCustomIcon ? 'emoji-icon' : ''}" aria-hidden="true">
          ${displayIcon}
        </div>
        <div class="photon-info">
          <div class="photon-name">${photon.name}</div>
          ${photon.internal ? html`<span class="internal-badge">System</span>` : ''}
        </div>
        <button
          class="star-btn ${isFavorited ? 'favorited' : ''}"
          @click=${(e: Event) => this._toggleFavorite(e, photon.name)}
          title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
          aria-label="${isFavorited
            ? `Remove ${photon.name} from favorites`
            : `Add ${photon.name} to favorites`}"
          aria-pressed="${isFavorited}"
        >
          ${isFavorited ? '⭐' : '☆'}
        </button>
        ${photon.hasUpdate ? html`<span class="update-dot" title="Update available"></span>` : ''}
        ${isUnconfigured
          ? html`<span class="method-count unconfigured" aria-label="Needs configuration">?</span>`
          : this._renderCountsPill(photon, methodCount)}
      </li>
    `;
  }

  private _renderExternalMCPItem(mcp: PhotonItem) {
    const methodCount = mcp.methods?.length || 0;
    const isConnected = mcp.connected !== false;
    const displayIcon = mcp.icon || '🔌';

    return html`
      <li
        class="photon-item ${this.selectedPhoton === mcp.name ? 'active' : ''} ${!isConnected
          ? 'disconnected'
          : ''}"
        role="option"
        aria-selected="${this.selectedPhoton === mcp.name}"
        tabindex="0"
        @click=${() => this._selectPhoton(mcp)}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this._selectPhoton(mcp)}
        title="${mcp.description || mcp.name}${mcp.errorMessage ? `\n⚠️ ${mcp.errorMessage}` : ''}"
      >
        <div class="photon-icon external-mcp-icon" aria-hidden="true">${displayIcon}</div>
        <div class="photon-info">
          <div class="photon-name">${mcp.name}</div>
        </div>
        ${!isConnected
          ? html`
              <span class="disconnect-badge" title="${mcp.errorMessage || 'Disconnected'}">Offline</span>
              <button
                class="reconnect-btn"
                @click=${(e: Event) => this._reconnectMCP(e, mcp.name)}
                title="Reconnect"
                aria-label="Reconnect ${mcp.name}"
              >
                ↻
              </button>
            `
          : this._renderCountsPill(mcp, methodCount)}
      </li>
    `;
  }

  private _reconnectMCP(e: Event, mcpName: string) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('reconnect-mcp', {
        detail: { name: mcpName },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _renderCountsPill(photon: PhotonItem, toolCount: number) {
    const promptCount = photon.promptCount || 0;
    const resourceCount = photon.resourceCount || 0;
    // Prompt templates are added as methods, so subtract to avoid double counting
    const actualToolCount = Math.max(0, toolCount - promptCount);
    const hasAnyCounts = actualToolCount > 0 || promptCount > 0 || resourceCount > 0;

    if (!hasAnyCounts) return '';

    return html`<span
      class="counts-pill"
      aria-label="${actualToolCount} tools, ${promptCount} prompts, ${resourceCount} resources"
    >
      ${actualToolCount > 0
        ? html`<span class="count-tools" title="${actualToolCount} tools">${actualToolCount}</span>`
        : ''}
      ${promptCount > 0
        ? html`<span class="count-prompts" title="${promptCount} prompts">${promptCount}</span>`
        : ''}
      ${resourceCount > 0
        ? html`<span class="count-resources" title="${resourceCount} resources"
            >${resourceCount}</span
          >`
        : ''}
    </span>`;
  }

  private _setTheme(theme: Theme) {
    this.dispatchEvent(
      new CustomEvent('theme-change', {
        detail: { theme },
        bubbles: true,
        composed: true,
      })
    );
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
