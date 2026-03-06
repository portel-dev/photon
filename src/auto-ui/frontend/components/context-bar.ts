import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import type { OverflowMenuItem } from './overflow-menu.js';
import './instance-panel.js';
import { pencil, settings as settingsIcon, clipboard, source, appDefault } from '../icons.js';

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
  stateful?: boolean;
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
        font-size: 9px;
        color: var(--t-muted);
        transition:
          opacity 0.15s,
          color 0.15s,
          width 0.15s;
        padding: 0;
        border-radius: var(--radius-xs);
        flex-shrink: 0;
        /* no flip — pencil tip naturally points toward text on left */
        width: 0;
        overflow: hidden;
        display: inline-flex;
        align-items: center;
      }

      .identity:hover .edit-pencil,
      .edit-pencil:focus-visible {
        opacity: 0.4;
        width: 13px;
        padding: 2px;
      }

      .editable:hover .edit-pencil {
        opacity: 0.7;
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
        gap: 6px;
        flex-shrink: 0;
      }

      .action-btn {
        background: none;
        border: 1px solid transparent;
        color: var(--t-muted);
        padding: 5px 8px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-2xs);
        font-weight: 500;
        transition: all 0.15s ease;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        box-sizing: border-box;
      }

      .action-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
        border-color: var(--border-glass);
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
        box-shadow: var(--shadow-lg);
        padding: 4px;
        z-index: 100;
      }

      .method-dropdown-item {
        display: block;
        width: 100%;
        padding: 6px 10px;
        border: none;
        background: none;
        color: var(--t-muted);
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
        color: var(--color-success);
        text-transform: uppercase;
        margin-left: auto;
      }

      .live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-success);
        box-shadow: 0 0 6px 2px var(--color-success-glow);
        animation: live-pulse 2s ease-in-out infinite;
      }

      @keyframes live-pulse {
        0%,
        100% {
          opacity: 1;
          box-shadow: 0 0 6px 2px var(--color-success-glow);
        }
        50% {
          opacity: 0.5;
          box-shadow: 0 0 3px 1px var(--color-success-glow);
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

  // --- Phase 1: Instance Manager ---
  /** Current instance name (for stateful photons) */
  @property({ type: String })
  instanceName = 'default';

  /** Whether the photon is stateful (controls instance pill visibility) */
  @property({ type: Boolean })
  isStateful = false;

  /** Available instances for the instance panel */
  @property({ type: Array })
  instances: string[] = [];

  /** Whether instance is auto-selected (follows most recently active) */
  @property({ type: String })
  instanceSelectorMode: 'auto' | 'manual' = 'manual';

  /** The auto-selected instance name (for display in Auto option) */
  @property({ type: String })
  autoInstance = '';

  // --- Phase 2: Source/Edit toggle ---
  /** Source mode: 'hidden' = no button, 'source' = show "Source" btn, 'edit' = show "Edit" btn */
  @property({ type: String })
  sourceMode: 'hidden' | 'source' | 'edit' = 'hidden';

  // --- Phase 3: Settings ---
  /** Whether to show the settings gear button */
  @property({ type: Boolean })
  hasSettings = false;

  // --- Split View Controls ---
  /** Show the + button to enable split view */
  @property({ type: Boolean })
  showSplitViewButton = false;

  /** Show the split view method dropdown and - button */
  @property({ type: Boolean })
  showSplitViewDropdown = false;

  /** Methods for the split view dropdown */
  @property({ type: Array })
  splitViewMethods: any[] = [];

  /** Currently selected split view method */
  @property({ type: Object })
  splitViewSelectedMethod: any = null;

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
    const displayIcon = p.icon || (p.isApp ? appDefault : p.name.substring(0, 2).toUpperCase());
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
                          @click=${(e: Event) => this._toggleMethodDropdown(e)}
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
              <!-- Split View Controls (right after method dropdown) -->
              ${this.showSplitViewButton
                ? html`
                    <button
                      @click=${() => this._emit('split-view:add')}
                      style="padding: 4px 8px; margin-left: 2px; background: none; color: var(--accent-secondary); border: 1px solid var(--accent-secondary); border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 700;"
                      title="Add another method in split view"
                    >
                      +
                    </button>
                  `
                : ''}
              ${this.showSplitViewDropdown
                ? html`
                    <select
                      @change=${(e: Event) => {
                        const selected = (e.target as HTMLSelectElement).value;
                        this._emit('split-view:change', { method: selected });
                      }}
                      style="padding: 4px 6px; margin-left: 2px; background: var(--bg-glass); color: var(--t-primary); border: 1px solid var(--border-glass); border-radius: 3px; font-size: 12px; cursor: pointer;"
                    >
                      <option value=${this.splitViewSelectedMethod?.name || ''}>
                        ${this.splitViewSelectedMethod?.name || ''}
                      </option>
                      ${this.splitViewMethods
                        .filter((m: any) => m.name !== this.splitViewSelectedMethod?.name)
                        .map((m: any) => html` <option value=${m.name}>${m.name}</option> `)}
                    </select>
                    <button
                      @click=${() => this._emit('split-view:remove')}
                      style="padding: 4px 8px; margin-left: 2px; background: none; color: var(--color-error); border: 1px solid var(--color-error); border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 700;"
                      title="Remove split view"
                    >
                      −
                    </button>
                  `
                : ''}
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
                          @blur=${() => this._saveName()}
                          @keydown=${(e: Event) => this._handleNameKeydown(e as KeyboardEvent)}
                          autofocus
                        />`
                      : html`<span class="editable">
                          <span class="name">${p.name}</span>
                          ${!p.isExternalMCP
                            ? html`<span
                                class="edit-pencil"
                                role="button"
                                tabindex="0"
                                @click=${() => this._startEditingName()}
                                @keydown=${(e: KeyboardEvent) =>
                                  (e.key === 'Enter' || e.key === ' ') &&
                                  (e.preventDefault(), this._startEditingName())}
                                title="Rename"
                                aria-label="Rename photon"
                                >${pencil}</span
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
                          @blur=${() => this._saveDescription()}
                          @keydown=${(e: Event) =>
                            this._handleDescriptionKeydown(e as KeyboardEvent)}
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
                            role="button"
                            tabindex="0"
                            @click=${() => this._startEditingDescription()}
                            @keydown=${(e: KeyboardEvent) =>
                              (e.key === 'Enter' || e.key === ' ') &&
                              (e.preventDefault(), this._startEditingDescription())}
                            title="Edit description"
                            aria-label="Edit description"
                            >${pencil}</span
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
                      ? html`<span
                          class="meta-badge update"
                          title="Update available — click to upgrade"
                          @click=${() => this._emit('upgrade')}
                          >Update</span
                        >`
                      : ''}
                  </div>
                </div>
              </div>
            `}

        <div class="secondary-actions">
          ${this.isStateful && !p.isExternalMCP
            ? html`<instance-panel
                .instanceName=${this.instanceName}
                .instances=${this.instances}
                .photonName=${p.name}
                .selectorMode=${this.instanceSelectorMode}
                .autoInstance=${this.autoInstance}
                @instance-action=${(e: CustomEvent) =>
                  this._emit('instance-action', { instanceDetail: e.detail })}
              ></instance-panel>`
            : ''}
          ${this.sourceMode === 'source'
            ? html`<button class="action-btn" @click=${() => this._emit('view-source')}>
                ${source} Source
              </button>`
            : this.sourceMode === 'edit'
              ? html`<button class="action-btn" @click=${() => this._emit('edit-studio')}>
                  ${pencil} Edit
                </button>`
              : ''}
          ${this.hasSettings
            ? html`<button
                class="action-btn"
                @click=${() => this._emit('open-settings')}
                title="Settings"
              >
                ${settingsIcon}
              </button>`
            : ''}
          ${this.showConfigure && !p.isExternalMCP
            ? html`<button class="action-btn" @click=${() => this._emit('configure')}>
                Reconfigure
              </button>`
            : ''}
          ${this.showCopyConfig
            ? html`<button class="action-btn" @click=${() => this._emit('copy-config')}>
                ${clipboard} Copy MCP Config
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
    void this.updateComplete.then(() => {
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
    void this.updateComplete.then(() => {
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
