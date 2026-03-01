import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, forms, type Theme } from '../styles/index.js';
import {
  starFilled,
  starOutline,
  marketplace as marketplaceIcon,
  activity as activityIcon,
  search as searchIcon,
  keyboard as keyboardIcon,
  palette,
  packageBox,
  plug,
  appDefault,
  warning as warningIcon,
  xMark,
  docs,
} from '../icons.js';

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
  /** Why this photon needs attention */
  errorReason?: 'missing-config' | 'load-error';
  // External MCP fields
  isExternalMCP?: boolean;
  connected?: boolean;
  errorMessage?: string;
  // MCP Apps Extension fields
  hasMcpApp?: boolean;
  mcpAppUri?: string;
  mcpAppUris?: string[];
  /** True if photon has property-based settings */
  hasSettings?: boolean;
}

@customElement('beam-sidebar')
export class BeamSidebar extends LitElement {
  static styles = [
    theme,
    forms,
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

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-xl) var(--space-md);
        text-align: center;
        flex: 1;
      }

      .empty-icon {
        font-size: var(--text-3xl);
        margin-bottom: var(--space-sm);
        opacity: 0.6;
      }

      .empty-title {
        font-weight: 600;
        font-size: var(--text-md);
        color: var(--t-primary);
        margin-bottom: var(--space-xs);
      }

      .empty-hint {
        font-size: var(--text-sm);
        color: var(--t-muted);
        line-height: 1.4;
      }

      .empty-action {
        margin-top: var(--space-md);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--accent-primary);
        font-size: var(--text-md);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .empty-action:hover {
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .sidebar-footer {
        padding: var(--space-sm) var(--space-md);
        border-top: 1px solid var(--border-glass);
        display: flex;
        justify-content: center;
        gap: var(--space-xs);
        flex-wrap: wrap;
      }

      .footer-link {
        color: var(--t-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s;
        background: none;
        border: none;
        padding: 6px;
        border-radius: var(--radius-sm);
      }

      .footer-link:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
      }

      .footer-link kbd {
        font-size: var(--text-2xs);
        padding: 1px 4px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-xs);
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
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: 700;
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
        background: var(--color-success);
        box-shadow:
          0 0 6px var(--color-success-glow),
          0 0 2px var(--color-success);
      }

      .status-indicator.reconnecting {
        background: var(--color-warning);
        box-shadow: 0 0 6px var(--color-warning);
        animation: pulse 1s ease-in-out infinite;
      }

      .status-indicator.disconnected {
        background: var(--color-error);
        box-shadow: 0 0 6px var(--color-error);
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
        border-radius: var(--radius-full);
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
        padding: var(--space-sm) var(--space-md);
      }

      .section-header {
        font-family: var(--font-display);
        padding: var(--space-sm) var(--space-md);
        font-size: var(--text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-muted);
        margin-top: var(--space-sm);
        border-left: 2px solid var(--accent-primary);
      }

      .section-header.attention {
        color: var(--color-warning);
        border-left-color: var(--color-warning);
        display: flex;
        align-items: center;
        gap: var(--space-xs);
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

      .photon-item.flash-highlight {
        animation: flash-highlight 0.6s ease-out;
      }

      @keyframes flash-highlight {
        0% {
          background: hsla(260, 100%, 65%, 0.2);
        }
        100% {
          background: transparent;
        }
      }

      .photon-icon {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        background: var(--bg-glass-strong);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        color: var(--t-primary);
        flex-shrink: 0;
        letter-spacing: 0.5px;
      }

      .photon-icon.emoji-icon {
        background: transparent;
        font-size: 20px;
      }

      .photon-item.internal {
        opacity: 0.85;
      }

      .internal-badge {
        font-size: var(--text-2xs);
        padding: 1px 4px;
        background: linear-gradient(135deg, hsl(280, 60%, 50%), hsl(320, 60%, 50%));
        color: white;
        border-radius: var(--radius-xs);
        text-transform: uppercase;
        font-weight: 600;
        letter-spacing: 0.03em;
      }

      .photon-info {
        min-width: 0;
        flex: 1;
      }

      .photon-name {
        font-family: var(--font-display);
        font-weight: 600;
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
        font-size: var(--text-2xs);
        padding: 2px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        border-radius: var(--radius-full);
        font-weight: 500;
        flex-shrink: 0;
      }

      .method-count.unconfigured {
        background: var(--color-warning-bg);
        border-color: var(--color-warning-glow);
        color: var(--color-warning);
      }

      .method-count.error {
        background: var(--color-error-bg);
        border-color: var(--color-error-glow);
        color: var(--color-error);
      }

      .counts-pill {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-2xs);
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-full);
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
      .count-sep {
        color: var(--t-muted);
        opacity: 0.5;
        font-size: 0.7em;
      }

      .version-badge {
        font-size: var(--text-2xs);
        color: var(--t-muted);
        opacity: 0.7;
      }

      .update-dot {
        position: absolute;
        top: -3px;
        right: -3px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-secondary);
        pointer-events: none;
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

      .update-badge {
        font-size: var(--text-2xs);
        padding: 1px 5px;
        background: hsl(0, 80%, 55%);
        color: white;
        border-radius: var(--radius-sm);
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
        font-size: var(--text-md);
        font-style: italic;
      }

      /* External MCPs */
      .photon-icon.external-mcp-icon {
        background: linear-gradient(135deg, hsl(200, 60%, 45%), hsl(220, 60%, 55%));
        color: white;
        border-radius: var(--radius-sm);
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
        font-size: var(--text-2xs);
        padding: 1px 4px;
        background: hsla(0, 60%, 50%, 0.2);
        color: hsl(0, 60%, 55%);
        border: 1px solid hsla(0, 60%, 50%, 0.3);
        border-radius: var(--radius-xs);
        text-transform: uppercase;
        font-weight: 600;
        letter-spacing: 0.03em;
      }

      .reconnect-btn {
        font-size: var(--text-2xs);
        padding: 2px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        border-radius: var(--radius-xs);
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
        font-size: var(--text-sm);
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

      .settings-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        font-size: var(--text-sm);
        opacity: 0.25;
        transition: all 0.2s;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
      }

      .photon-item:hover .settings-btn,
      .settings-btn:focus-visible {
        opacity: 0.5;
      }

      .settings-btn:hover {
        opacity: 0.8 !important;
        transform: scale(1.1);
      }

      .star-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        font-size: var(--text-md);
        opacity: 0.4;
        transition: all 0.2s;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
      }

      .star-btn:hover,
      .star-btn:focus-visible {
        opacity: 0.8;
        transform: scale(1.1);
      }

      .star-btn.favorited {
        opacity: 1;
      }

      .photon-item .star-btn {
        opacity: 0.35;
      }

      .photon-item:hover .star-btn,
      .photon-item:focus-within .star-btn {
        opacity: 0.6;
      }

      .photon-item .star-btn.favorited {
        opacity: 1;
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
          padding: var(--space-sm);
          opacity: 0.4;
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
          min-width: 44px;
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
  private static RECENT_KEY = 'beam-recent-photons';

  @state()
  private _recentPhotons: string[] = [];

  connectedCallback() {
    super.connectedCallback();
    this._loadFavorites();
    this._loadRecent();
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

  private _loadRecent() {
    try {
      const stored = localStorage.getItem(BeamSidebar.RECENT_KEY);
      if (stored) this._recentPhotons = JSON.parse(stored);
    } catch {
      // ignore
    }
  }

  trackRecentPhoton(name: string) {
    const recent = [name, ...this._recentPhotons.filter((n) => n !== name)].slice(0, 20);
    this._recentPhotons = recent;
    try {
      localStorage.setItem(BeamSidebar.RECENT_KEY, JSON.stringify(recent));
    } catch {
      // ignore
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

  private get _apps(): PhotonItem[] {
    const photonApps = this._filteredPhotons.filter((p) => p.isApp);
    const externalApps = this._filteredExternalMCPs.filter((m) => m.hasMcpApp);
    return [...photonApps, ...externalApps];
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

  /** External MCPs that are NOT apps (apps go to _apps) */
  private get _nonAppExternalMCPs() {
    return this._filteredExternalMCPs.filter((m) => !m.hasMcpApp);
  }

  /** Sort items by recency — recently used items float to the top */
  private _sortByRecency<T extends { name: string }>(items: T[]): T[] {
    const recentIndex = new Map(this._recentPhotons.map((name, i) => [name, i]));
    return [...items].sort((a, b) => {
      const aIdx = recentIndex.get(a.name);
      const bIdx = recentIndex.get(b.name);
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return 0; // preserve original order for non-recent items
    });
  }

  /** @deprecated No longer used — recent items are sorted inline within their sections */
  private get _recentSet(): Set<string> {
    if (this._showFavoritesOnly || this._searchQuery) return new Set();
    return new Set(
      this._recentPhotons.filter((n) => this._filteredPhotons.some((p) => p.name === n))
    );
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
              ${starFilled} Favorites ${this._favorites.size > 0 ? `(${this._favorites.size})` : ''}
            </button>
            <button
              class="filter-btn"
              @click=${() => this.dispatchEvent(new CustomEvent('marketplace'))}
              aria-label="Open marketplace"
            >
              ${marketplaceIcon} Marketplace
              ${this.updatesAvailable > 0
                ? html`<span class="update-badge">${this.updatesAvailable}</span>`
                : ''}
            </button>
          </div>
        </div>

        ${(() => {
          const apps = this._sortByRecency(this._apps);
          const configured = this._sortByRecency(this._configured);
          return html`
            ${apps.length > 0
              ? html`
                  <div class="section-header" id="apps-header">APPS</div>
                  <ul class="photon-list" role="listbox" aria-labelledby="apps-header">
                    ${apps.map((photon) =>
                      photon.isExternalMCP
                        ? this._renderExternalMCPItem(photon)
                        : this._renderPhotonItem(photon, 'app')
                    )}
                  </ul>
                `
              : ''}
            ${configured.length > 0
              ? html`
                  <div class="section-header" id="photons-header">PHOTONS</div>
                  <ul class="photon-list" role="listbox" aria-labelledby="photons-header">
                    ${configured.map((photon) => this._renderPhotonItem(photon, 'configured'))}
                  </ul>
                `
              : ''}
          `;
        })()}
        ${(() => {
          const needsConfig = this._needsSetup.filter((p) => p.errorReason !== 'load-error');
          const loadErrors = this._needsSetup.filter((p) => p.errorReason === 'load-error');
          return html`
            ${needsConfig.length > 0
              ? html`
                  <div class="section-header attention" id="config-header">
                    ${warningIcon}<span>NEEDS CONFIGURATION</span>
                  </div>
                  <ul class="photon-list" role="listbox" aria-labelledby="config-header">
                    ${needsConfig.map((photon) => this._renderPhotonItem(photon, 'unconfigured'))}
                  </ul>
                `
              : ''}
            ${loadErrors.length > 0
              ? html`
                  <div class="section-header attention" id="errors-header">
                    ${xMark}<span>LOAD ERRORS</span>
                  </div>
                  <ul class="photon-list" role="listbox" aria-labelledby="errors-header">
                    ${loadErrors.map((photon) => this._renderPhotonItem(photon, 'unconfigured'))}
                  </ul>
                `
              : ''}
          `;
        })()}
        ${this._nonAppExternalMCPs.length > 0
          ? html`
              <div class="section-header" id="mcps-header">MCPS</div>
              <ul class="photon-list" role="listbox" aria-labelledby="mcps-header">
                ${this._sortByRecency(this._nonAppExternalMCPs).map((mcp) =>
                  this._renderExternalMCPItem(mcp)
                )}
              </ul>
            `
          : ''}
        ${this._apps.length === 0 &&
        this._configured.length === 0 &&
        this._needsSetup.length === 0 &&
        this._nonAppExternalMCPs.length === 0
          ? html`
              <div class="empty-state">
                ${this._searchQuery.trim()
                  ? html`
                      <div class="empty-icon">${searchIcon}</div>
                      <div class="empty-title">No results</div>
                      <div class="empty-hint">No photons match "${this._searchQuery}"</div>
                    `
                  : html`
                      <div class="empty-icon">${packageBox}</div>
                      <div class="empty-title">No photons yet</div>
                      <div class="empty-hint">
                        Add photons from the marketplace or create your own
                      </div>
                      <button
                        class="empty-action"
                        @click=${() => this.dispatchEvent(new CustomEvent('marketplace'))}
                      >
                        ${marketplaceIcon} Browse Marketplace
                      </button>
                    `}
              </div>
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
          ${activityIcon}
        </button>
        <button
          class="footer-link"
          @click=${this._showShortcuts}
          title="Shortcuts"
          aria-label="Show keyboard shortcuts"
        >
          ${keyboardIcon}
        </button>
        <button
          class="footer-link"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent('open-theme-settings', { bubbles: true, composed: true })
            )}
          title="Theme"
          aria-label="Open theme settings"
        >
          ${palette}
        </button>
        <a
          class="footer-link"
          href="https://github.com/portel-dev/photon#readme"
          target="_blank"
          rel="noopener noreferrer"
          title="Docs"
          aria-label="Open documentation"
        >
          ${docs}
        </a>
      </div>
    `;
  }

  private _showShortcuts() {
    this.dispatchEvent(new CustomEvent('show-shortcuts', { bubbles: true, composed: true }));
  }

  private _openStudio(photonName: string) {
    this.dispatchEvent(
      new CustomEvent('open-studio', {
        detail: { photonName },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _renderPhotonItem(photon: PhotonItem, type: 'app' | 'configured' | 'unconfigured') {
    const methodCount = photon.methods?.length || 0;
    const isApp = type === 'app';
    const isUnconfigured = type === 'unconfigured';
    const isFavorited = this._favorites.has(photon.name);

    // Determine icon: use photon's icon if available, otherwise default
    const displayIcon =
      photon.icon || (isApp ? appDefault : photon.name.substring(0, 2).toUpperCase());
    const hasCustomIcon = !!photon.icon;
    const isEmoji = isApp || hasCustomIcon;

    // Generate a deterministic hue from photon name for initials icons
    let initialsStyle = '';
    if (!isEmoji) {
      let hash = 0;
      for (let i = 0; i < photon.name.length; i++) {
        hash = photon.name.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      const isLight = this.theme === 'light';
      initialsStyle = isLight
        ? `background: hsl(${hue}, 30%, 90%); color: hsl(${hue}, 50%, 35%);`
        : `background: hsl(${hue}, 35%, 22%); color: hsl(${hue}, 60%, 75%);`;
    }

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
        <div
          class="photon-icon ${isEmoji ? 'emoji-icon' : ''}"
          style="${initialsStyle}"
          aria-hidden="true"
        >
          ${displayIcon}
        </div>
        <div class="photon-info">
          <div class="photon-name">${photon.name}</div>
          ${photon.internal ? html`<span class="internal-badge">System</span>` : ''}
        </div>
        ${'' /* Settings button removed — now in context bar (Phase 3) */}
        <button
          class="star-btn ${isFavorited ? 'favorited' : ''}"
          @click=${(e: Event) => this._toggleFavorite(e, photon.name)}
          title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
          aria-label="${isFavorited
            ? `Remove ${photon.name} from favorites`
            : `Add ${photon.name} to favorites`}"
          aria-pressed="${isFavorited}"
        >
          ${isFavorited ? starFilled : starOutline}
        </button>
        ${isUnconfigured
          ? photon.errorReason === 'load-error'
            ? html`<span class="method-count error" aria-label="Error loading">×</span>`
            : html`<span class="method-count unconfigured" aria-label="Needs configuration"
                >?</span
              >`
          : this._renderCountsPill(photon, methodCount)}
      </li>
    `;
  }

  private _renderExternalMCPItem(mcp: PhotonItem) {
    const methodCount = mcp.methods?.length || 0;
    const isConnected = mcp.connected !== false;
    const displayIcon = mcp.icon || plug;

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
              <span class="disconnect-badge" title="${mcp.errorMessage || 'Disconnected'}"
                >Offline</span
              >
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

    const tooltipParts = [
      actualToolCount > 0 ? `${actualToolCount} ${actualToolCount === 1 ? 'tool' : 'tools'}` : '',
      promptCount > 0 ? `${promptCount} ${promptCount === 1 ? 'prompt' : 'prompts'}` : '',
      resourceCount > 0 ? `${resourceCount} ${resourceCount === 1 ? 'resource' : 'resources'}` : '',
    ].filter(Boolean);

    return html`<span
      class="counts-pill"
      aria-label="${tooltipParts.join(', ')}"
      title="${tooltipParts.join(', ')}"
    >
      ${photon.hasUpdate
        ? html`<span class="update-dot" title="Update available"
            ><span class="visually-hidden">Update available</span></span
          >`
        : ''}
      ${actualToolCount > 0 ? html`<span class="count-tools">${actualToolCount}</span>` : ''}
      ${promptCount > 0 && actualToolCount > 0 ? html`<span class="count-sep">·</span>` : ''}
      ${promptCount > 0 ? html`<span class="count-prompts">${promptCount}</span>` : ''}
      ${resourceCount > 0 && (actualToolCount > 0 || promptCount > 0)
        ? html`<span class="count-sep">·</span>`
        : ''}
      ${resourceCount > 0 ? html`<span class="count-resources">${resourceCount}</span>` : ''}
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

  private _openSettings(e: Event, photonName: string) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('photon-settings', {
        detail: { name: photonName },
        bubbles: true,
        composed: true,
      })
    );
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

  scrollPhotonIntoView(name: string) {
    this.updateComplete.then(() => {
      const items = this.shadowRoot?.querySelectorAll('.photon-item');
      if (!items) return;
      for (const item of items) {
        const nameEl = item.querySelector('.photon-name');
        if (nameEl?.textContent?.trim() === name) {
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          (item as HTMLElement).classList.add('flash-highlight');
          setTimeout(() => (item as HTMLElement).classList.remove('flash-highlight'), 600);
          break;
        }
      }
    });
  }
}
