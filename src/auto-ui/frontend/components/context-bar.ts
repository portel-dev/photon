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
        border-radius: 8px;
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
        font-weight: 600;
        font-size: 0.95rem;
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
        font-size: 0.7rem;
        color: var(--t-muted);
        transition:
          opacity 0.15s,
          color 0.15s;
        padding: 2px 4px;
        border-radius: 3px;
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
        font-size: 0.8rem;
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
        font-size: 0.7rem;
        color: var(--t-muted);
      }

      .meta-badge {
        padding: 1px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: 3px;
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
        font-size: 0.75rem;
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
        font-size: 0.8rem;
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

  /** Overflow menu items */
  @property({ type: Array })
  overflowItems: OverflowMenuItem[] = [];

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
    const methodCount = p.methods?.length || 0;
    const displayIcon = p.icon || (p.isApp ? '📱' : p.name.substring(0, 2).toUpperCase());
    const hasCustomIcon = !!p.icon;
    const description = p.description || `${p.name} MCP`;
    const isGenericDesc = description.endsWith(' MCP') || description === 'Photon tool';

    return html`
      <div class="context-bar">
        ${this.breadcrumbs.length > 0
          ? html`
              <div class="breadcrumb">
                ${this.breadcrumbs.map((crumb, i) =>
                  i < this.breadcrumbs.length - 1
                    ? html`<a @click=${() => this._emitAction(crumb.action || '')}>${crumb.label}</a
                        ><span class="separator">/</span>`
                    : html`<span class="current">${crumb.label}</span>`
                )}
              </div>
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
                          style="background:transparent;border:none;color:var(--t-primary);font:inherit;font-weight:600;font-size:0.95rem;outline:none;min-width:0;width:auto;"
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
                          style="background:transparent;border:none;color:var(--t-primary);font:inherit;font-size:0.8rem;outline:none;flex:1;min-width:0;"
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
                    <span class="meta-badge"
                      >${methodCount} method${methodCount !== 1 ? 's' : ''}</span
                    >
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
