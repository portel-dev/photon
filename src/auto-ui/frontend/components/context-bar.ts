import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import type { OverflowMenuItem } from './overflow-menu.js';

export interface ContextBarPhoton {
  name: string;
  description?: string;
  icon?: string;
  isApp?: boolean;
  version?: string;
  hasUpdate?: boolean;
  author?: string;
  installSource?: { marketplace: string };
  path?: string;
  internal?: boolean;
  configured?: boolean;
  methods?: any[];
  isExternalMCP?: boolean;
}

@customElement('context-bar')
export class ContextBar extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        position: relative;
        z-index: 10;
      }

      .context-bar {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-sm) var(--space-md);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        background: var(--bg-glass);
        backdrop-filter: blur(16px);
        position: relative;
      }

      .identity {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex: 1;
        min-width: 0;
      }

      .icon {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: white;
        flex-shrink: 0;
        cursor: pointer;
        transition: transform 0.15s ease;
      }

      .icon:hover {
        transform: scale(1.1);
      }

      .icon.mcp-icon {
        font-size: 11px;
        font-weight: 600;
      }

      .info {
        min-width: 0;
        flex: 1;
      }

      .top-line {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .name {
        font-family: var(--font-display);
        font-weight: 600;
        font-size: var(--text-md);
        color: var(--t-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .editable {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }

      .edit-pencil {
        opacity: 0;
        cursor: pointer;
        font-size: var(--text-xs);
        color: var(--t-muted);
        transition:
          opacity 0.15s,
          color 0.15s;
        padding: 2px 4px;
        border-radius: var(--radius-xs);
        flex-shrink: 0;
      }

      .editable:hover .edit-pencil {
        opacity: 0.5;
      }

      .edit-pencil:hover {
        opacity: 1 !important;
        color: var(--accent-secondary);
        background: var(--bg-glass);
      }

      .separator {
        color: var(--t-muted);
        opacity: 0.4;
      }

      .desc {
        font-size: var(--text-sm);
        color: var(--t-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .desc.placeholder {
        font-style: italic;
      }

      .meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-xs);
        color: var(--t-muted);
      }

      .meta-badge {
        padding: 1px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-xs);
        font-weight: 500;
      }

      .meta-badge.app {
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        border-color: transparent;
        color: white;
      }

      .meta-badge.update {
        background: hsla(0, 80%, 55%, 0.15);
        border-color: hsla(0, 80%, 55%, 0.3);
        color: hsl(0, 80%, 65%);
        cursor: pointer;
      }

      .secondary-actions {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        flex-shrink: 0;
      }

      .action-btn {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-xs);
        font-weight: 500;
        transition: all 0.2s ease;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .action-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .action-btn.primary {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .action-btn.primary:hover {
        filter: brightness(1.1);
      }

      .breadcrumb {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--text-sm);
        color: var(--t-muted);
        margin-right: auto;
      }

      .breadcrumb a {
        color: var(--accent-secondary);
        cursor: pointer;
        text-decoration: none;
      }

      .breadcrumb a:hover {
        text-decoration: underline;
      }

      .breadcrumb .current {
        color: var(--t-primary);
        font-weight: 500;
      }

      .breadcrumb .current.has-dropdown {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;
        margin: -2px -6px;
        border-radius: var(--radius-xs);
        transition: background 0.15s ease;
        position: relative;
      }

      .breadcrumb .current.has-dropdown:hover {
        background: var(--bg-glass);
      }

      .breadcrumb .chevron {
        opacity: 0.6;
        transition: transform 0.15s ease;
        flex-shrink: 0;
      }

      .breadcrumb .current.has-dropdown:hover .chevron {
        opacity: 1;
      }

      .breadcrumb .chevron.open {
        transform: rotate(180deg);
      }

      .method-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        max-height: 280px;
        overflow-y: auto;
        background: var(--bg-glass-strong, var(--bg-glass));
        backdrop-filter: blur(20px);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        padding: 4px;
        z-index: 100;
      }

      .method-dropdown-item {
        display: block;
        width: 100%;
        padding: 6px 10px;
        border: none;
        background: none;
        color: var(--t-secondary);
        font-size: var(--text-sm);
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        border-radius: var(--radius-xs);
        transition: all 0.1s ease;
      }

      .method-dropdown-item:hover {
        background: var(--bg-glass);
        color: var(--t-primary);
      }

      .method-dropdown-item.active {
        color: var(--accent-secondary);
        font-weight: 500;
      }

      .live-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: var(--text-2xs);
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #4ade80;
        text-transform: uppercase;
        margin-left: auto;
      }

      .live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
        box-shadow: 0 0 6px 2px rgba(74, 222, 128, 0.6);
        animation: live-pulse 2s ease-in-out infinite;
      }

      @keyframes live-pulse {
        0%,
        100% {
          opacity: 1;
          box-shadow: 0 0 6px 2px rgba(74, 222, 128, 0.6);
        }
        50% {
          opacity: 0.5;
          box-shadow: 0 0 3px 1px rgba(74, 222, 128, 0.3);
        }
      }

      /* Responsive */
      @media (max-width: 768px) {
        .context-bar {
          flex-wrap: wrap;
        }

        .secondary-actions {
          width: 100%;
          justify-content: flex-end;
          padding-top: var(--space-xs);
          border-top: 1px solid var(--border-glass);
        }

        .desc {
          display: none;
        }

        .meta {
          display: none;
        }
      }
    `,
  ];

  @property({ type: Object })
  photon: ContextBarPhoton | null = null;

  /** Breadcrumb trail: [{label, action?}] — last item is current (no action) */
  @property({ type: Array })
  breadcrumbs: Array<{ label: string; action?: string }> = [];

  /** Show the "Edit in Studio" button */
  @property({ type: Boolean })
  showEdit = false;

  /** Show the "Configure" button */
  @property({ type: Boolean })
  showConfigure = false;

  /** Show the "Copy MCP Config" button */
  @property({ type: Boolean })
  showCopyConfig = true;

  /** Show live indicator next to breadcrumb (stateful auto-refresh) */
  @property({ type: Boolean })
  live = false;

  /** Overflow menu items */
  @property({ type: Array })
  overflowItems: OverflowMenuItem[] = [];

  @state()
  private _methodDropdownOpen = false;

  @state()
  private _editingName = false;

  @state()
  private _editedName = '';

  @state()
  private _editingDescription = false;

  @state()
  private _editedDescription = '';

  render() {
    if (!this.photon) return '';

    const p = this.photon;
    const methods = p.methods || [];
    const methodCount = methods.length;
    const templateCount = methods.filter((m: any) => m.isTemplate).length;
    const toolCount = methods.filter((m: any) => !m.isTemplate).length;
    const displayIcon = p.icon || (p.isApp ? '📱' : p.name.substring(0, 2).toUpperCase());
    const hasCustomIcon = !!p.icon;
    const description = p.description || `${p.name} MCP`;
    const isGenericDesc =
      description.endsWith(' MCP') ||
      description === 'Photon tool' ||
      /^add description/i.test(description.trim());

    return html`
      <div class="context-bar">
        ${this.breadcrumbs.length > 0
          ? html`
              <div class="breadcrumb">
                ${this.breadcrumbs.map((crumb, i) =>
                  i < this.breadcrumbs.length - 1
                    ? html`<a @click=${() => this._emitAction(crumb.action || '')}>${crumb.label}</a
                        ><span class="separator">/</span>`
                    : this._hasMethodDropdown()
                      ? html`<span
                          class="current has-dropdown"
                          @click=${this._toggleMethodDropdown}
                        >
                          ${crumb.label}<svg
                            class="chevron ${this._methodDropdownOpen ? 'open' : ''}"
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                          >
                            <path
                              d="M3 4.5L6 7.5L9 4.5"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </svg>
                          ${this._methodDropdownOpen ? this._renderMethodDropdown(crumb.label) : ''}
                        </span>`
                      : html`<span class="current">${crumb.label}</span>`
                )}
              </div>
              ${this.live
                ? html`<span class="live-badge"><span class="live-dot"></span>LIVE</span>`
                : ''}
            `
          : html`
              <div class="identity">
                <div
                  class="icon ${hasCustomIcon || p.isApp ? '' : 'mcp-icon'}"
                  @click=${() => this._emit('edit-icon')}
                  title="Click to change icon"
                >
                  ${displayIcon}
                </div>
                <div class="info">
                  <div class="top-line">
                    ${this._editingName
                      ? html`<input
                          class="editable-input"
                          style="font-weight:600;font-size:0.95rem;min-width:0;width:auto;"
                          type="text"
                          .value=${this._editedName}
                          @input=${(e: Event) => {
                            this._editedName = (e.target as HTMLInputElement).value;
                          }}
                          @blur=${this._saveName}
                          @keydown=${this._handleNameKeydown}
                          autofocus
                        />`
                      : html`<span class="editable">
                          <span class="name">${p.name}</span>
                          ${!p.isExternalMCP
                            ? html`<span
                                class="edit-pencil"
                                @click=${this._startEditingName}
                                title="Rename"
                                >✎</span
                              >`
                            : ''}
                        </span>`}
                    <span class="separator">·</span>
                    ${this._editingDescription
                      ? html`<input
                          class="editable-input"
                          style="font-size:0.8rem;flex:1;min-width:0;"
                          type="text"
                          .value=${this._editedDescription}
                          @input=${(e: Event) => {
                            this._editedDescription = (e.target as HTMLInputElement).value;
                          }}
                          placeholder="Add a description..."
                          @blur=${this._saveDescription}
                          @keydown=${this._handleDescriptionKeydown}
                          autofocus
                        />`
                      : html`<span class="editable" style="flex:1;min-width:0;">
                          <span
                            class="desc ${isGenericDesc ? 'placeholder' : ''}"
                            style="flex:1;min-width:0;"
                          >
                            ${isGenericDesc ? 'Add description...' : description}
                          </span>
                          <span
                            class="edit-pencil"
                            @click=${this._startEditingDescription}
                            title="Edit description"
                            >✎</span
                          >
                        </span>`}
                  </div>
                  <div class="meta">
                    ${p.isApp
                      ? html`<span class="meta-badge app">App</span>`
                      : html`<span class="meta-badge">MCP</span>`}
                    ${templateCount > 0 && toolCount === 0
                      ? html`<span class="meta-badge"
                          >${templateCount} prompt${templateCount !== 1 ? 's' : ''}</span
                        >`
                      : templateCount > 0
                        ? html`<span class="meta-badge"
                            >${toolCount} tool${toolCount !== 1 ? 's' : ''}, ${templateCount}
                            prompt${templateCount !== 1 ? 's' : ''}</span
                          >`
                        : html`<span class="meta-badge"
                            >${methodCount} method${methodCount !== 1 ? 's' : ''}</span
                          >`}
                    ${p.version ? html`<span class="meta-badge">${p.version}</span>` : ''}
                    ${p.hasUpdate
                      ? html`<span class="meta-badge update" @click=${() => this._emit('upgrade')}
                          >Update</span
                        >`
                      : ''}
                  </div>
                </div>
              </div>
            `}

        <div class="secondary-actions">
          ${this.showEdit && !p.isExternalMCP
            ? html`<button class="action-btn" @click=${() => this._emit('edit-studio')}>
                ✎ Edit
              </button>`
            : ''}
          ${this.showConfigure && !p.isExternalMCP
            ? html`<button class="action-btn" @click=${() => this._emit('configure')}>
                Configure
              </button>`
            : ''}
          ${this.showCopyConfig
            ? html`<button class="action-btn" @click=${() => this._emit('copy-config')}>
                📋 MCP Config
              </button>`
            : ''}
          ${p.hasUpdate
            ? html`<button class="action-btn primary" @click=${() => this._emit('upgrade')}>
                ⬆ Upgrade
              </button>`
            : ''}
          ${this.overflowItems.length > 0
            ? html`<overflow-menu
                .items=${this.overflowItems}
                @menu-select=${(e: CustomEvent) => this._emit('overflow', e.detail)}
              ></overflow-menu>`
            : ''}
        </div>
      </div>
    `;
  }

  private _hasMethodDropdown(): boolean {
    return !!(
      this.photon?.methods &&
      this.photon.methods.length > 1 &&
      this.breadcrumbs.length >= 2
    );
  }

  private _toggleMethodDropdown(e: Event) {
    e.stopPropagation();
    this._methodDropdownOpen = !this._methodDropdownOpen;
    if (this._methodDropdownOpen) {
      // Close on click outside
      const handler = (evt: MouseEvent) => {
        const path = evt.composedPath();
        if (!path.includes(this)) {
          this._methodDropdownOpen = false;
          document.removeEventListener('click', handler, true);
        }
      };
      // Defer so the current click doesn't immediately close
      requestAnimationFrame(() => {
        document.addEventListener('click', handler, true);
      });
    }
  }

  private _renderMethodDropdown(currentLabel: string) {
    const methods = this.photon?.methods || [];
    return html`
      <div class="method-dropdown" @click=${(e: Event) => e.stopPropagation()}>
        ${methods.map(
          (m: any) => html`
            <button
              class="method-dropdown-item ${m.name === currentLabel ? 'active' : ''}"
              @click=${() => this._selectMethod(m.name)}
            >
              ${m.name}
            </button>
          `
        )}
      </div>
    `;
  }

  private _selectMethod(methodName: string) {
    this._methodDropdownOpen = false;
    this._emit('select-method', { methodName });
  }

  private _emit(action: string, detail?: any) {
    this.dispatchEvent(
      new CustomEvent('context-action', {
        detail: { action, ...detail },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _emitAction(action: string) {
    this._emit(action);
  }

  private _startEditingName() {
    this._editedName = this.photon?.name || '';
    this._editingName = true;
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('input') as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  private _handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this._saveName();
    } else if (e.key === 'Escape') {
      this._editingName = false;
    }
  }

  private _saveName() {
    this._editingName = false;
    const newName = this._editedName.trim();
    const originalName = (this.photon?.name || '').trim();
    if (!newName || newName === originalName) return;
    this._emit('update-name', { name: newName });
  }

  private _startEditingDescription() {
    const desc = this.photon?.description || '';
    const isGeneric = desc.endsWith(' MCP') || desc === 'Photon tool';
    this._editedDescription = isGeneric ? '' : desc;
    this._editingDescription = true;
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('input');
      input?.focus();
    });
  }

  private _handleDescriptionKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this._saveDescription();
    } else if (e.key === 'Escape') {
      this._editingDescription = false;
    }
  }

  private _saveDescription() {
    this._editingDescription = false;
    const newDesc = this._editedDescription.trim();
    const currentDesc = this.photon?.description || '';
    const isGeneric = currentDesc.endsWith(' MCP') || currentDesc === 'Photon tool';
    const originalDesc = isGeneric ? '' : currentDesc;
    // No-op if nothing changed
    if (newDesc === originalDesc.trim()) return;
    this._emit('update-description', { description: newDesc || null });
  }
}
