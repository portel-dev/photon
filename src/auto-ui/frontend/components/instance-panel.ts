import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { iconSvgString, iconPaths } from '../icons.js';

@customElement('instance-panel')
export class InstancePanel extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      .instance-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 10px;
        background: none;
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-xs);
        font-weight: 500;
        color: var(--t-secondary);
        transition: all 0.15s ease;
        white-space: nowrap;
        height: 28px;
        box-sizing: border-box;
      }

      .instance-pill:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
        border-color: var(--accent-primary);
      }

      .instance-icon,
      .instance-pill .chevron-icon {
        display: inline-flex;
        align-items: center;
        opacity: 0.5;
        flex-shrink: 0;
      }

      .instance-pill:hover .instance-icon,
      .instance-pill:hover .chevron-icon {
        opacity: 0.8;
      }

      .instance-pill .chevron-icon {
        transition:
          transform 0.15s ease,
          opacity 0.15s ease;
      }

      .instance-pill .chevron-icon.open {
        transform: rotate(180deg);
      }
    `,
  ];

  @property({ type: String })
  instanceName = 'default';

  @property({ type: Array })
  instances: string[] = [];

  @property({ type: String })
  photonName = '';

  @property({ type: String })
  selectorMode: 'auto' | 'manual' = 'manual';

  @property({ type: String })
  autoInstance = '';

  @state()
  private _open = false;

  @state()
  private _searchQuery = '';

  @state()
  private _creating = false;

  @state()
  private _newName = '';

  @state()
  private _renaming = false;

  @state()
  private _renameName = '';

  @state()
  private _cloning = false;

  @state()
  private _cloneName = '';

  @state()
  private _confirmingDelete = false;

  private _portal: HTMLDivElement | null = null;
  private _boundClose = this._handleOutsideClick.bind(this);

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._boundClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._boundClose);
    this._removePortal();
  }

  private _handleOutsideClick(e: MouseEvent) {
    if (this._open) {
      const path = e.composedPath();
      const pill = this.shadowRoot?.querySelector('.instance-pill');
      if (pill && path.includes(pill)) return;
      if (this._portal && path.includes(this._portal)) return;
      this._close();
    }
  }

  render() {
    const display =
      this.selectorMode === 'auto'
        ? `auto · ${this.instanceName}`
        : this.instanceName === 'default'
          ? 'default'
          : this.instanceName;
    return html`
      <button
        class="instance-pill"
        @click=${(e: Event) => this._toggle(e)}
        title="Instances are separate data containers — like multiple accounts in the same app. Click to switch."
        aria-label="Current instance: ${display}"
        aria-haspopup="true"
        aria-expanded="${this._open}"
      >
        <span class="instance-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14a9 3 0 0 0 18 0V5" />
            <path d="M3 12a9 3 0 0 0 18 0" />
          </svg>
        </span>
        ${display}
        <span class="chevron-icon ${this._open ? 'open' : ''}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </button>
    `;
  }

  private _toggle(e: Event) {
    e.stopPropagation();
    if (this._open) {
      this._close();
    } else {
      this._openPanel();
    }
  }

  private _getVar(name: string, fallback: string): string {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let el: HTMLElement | null = this;
    while (el) {
      const val = getComputedStyle(el).getPropertyValue(name).trim();
      if (val) return val;
      el = ((el.getRootNode() as ShadowRoot)?.host as HTMLElement) || el.parentElement;
      if (el === document.documentElement) break;
    }
    return fallback;
  }

  private _openPanel() {
    const pill = this.shadowRoot?.querySelector('.instance-pill') as HTMLElement;
    if (!pill) return;

    const rect = pill.getBoundingClientRect();
    this._open = true;
    this._searchQuery = '';
    this._creating = false;
    this._renaming = false;
    this._cloning = false;
    this._confirmingDelete = false;

    this._removePortal();
    this._renderPortal(rect);
  }

  private _renderPortal(anchorRect: DOMRect) {
    const bgPanel = this._getVar('--bg-panel', '#1a1a2e');
    const borderGlass = this._getVar('--border-glass', 'rgba(255,255,255,0.08)');
    const tPrimary = this._getVar('--t-primary', '#e2e8f0');
    const tMuted = this._getVar('--t-muted', '#94a3b8');
    const bgGlass = this._getVar('--bg-glass', 'rgba(255,255,255,0.05)');
    const bgGlassStrong = this._getVar('--bg-glass-strong', 'rgba(255,255,255,0.1)');
    const accentPrimary = this._getVar('--accent-primary', '#7c3aed');
    const accentSecondary = this._getVar('--accent-secondary', '#06b6d4');
    const colorError = this._getVar('--color-error', '#f87171');
    const glowPrimary = this._getVar('--glow-primary', 'rgba(124, 58, 237, 0.3)');
    const radiusMd = this._getVar('--radius-md', '12px');
    const radiusSm = this._getVar('--radius-sm', '6px');

    const portal = document.createElement('div');
    portal.style.cssText = `
      position: fixed;
      z-index: 99999;
      min-width: 260px;
      max-width: 320px;
      background: ${bgPanel};
      border: 1px solid ${borderGlass};
      border-radius: ${radiusMd};
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      font-family: 'Inter', sans-serif;
      padding: 8px;
    `;

    // Add focus glow ring to portal inputs since outline:none is needed for styling
    const addFocusGlow = (el: HTMLInputElement) => {
      el.addEventListener('focus', () => {
        el.style.boxShadow = `0 0 0 2px ${glowPrimary}`;
      });
      el.addEventListener('blur', () => {
        el.style.boxShadow = 'none';
      });
    };

    const rebuild = () => {
      portal.innerHTML = '';
      const filtered = this.instances.filter(
        (name) => !this._searchQuery || name.toLowerCase().includes(this._searchQuery.toLowerCase())
      );

      // Search input
      const searchWrap = document.createElement('div');
      searchWrap.style.cssText = 'padding: 0 4px 6px; position: relative;';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Filter instances...';
      searchInput.value = this._searchQuery;
      searchInput.style.cssText = `
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        background: ${bgGlass};
        border: 1px solid ${borderGlass};
        border-radius: ${radiusSm};
        color: ${tPrimary};
        font-size: 0.82rem;
        font-family: inherit;
        outline: none; /* focus-visible adds glow via JS below */
      `;
      addFocusGlow(searchInput);
      searchInput.addEventListener('input', () => {
        this._searchQuery = searchInput.value;
        rebuild();
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this._close();
        }
      });
      searchWrap.appendChild(searchInput);
      portal.appendChild(searchWrap);

      // Divider
      const divider1 = document.createElement('div');
      divider1.style.cssText = `height: 1px; background: ${borderGlass}; margin: 2px 0 4px;`;
      portal.appendChild(divider1);

      // Auto option
      const autoItem = document.createElement('button');
      const isAuto = this.selectorMode === 'auto';
      autoItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 10px;
        border: none;
        background: ${isAuto ? bgGlassStrong : 'none'};
        color: ${isAuto ? accentSecondary : tPrimary};
        font-size: 0.82rem;
        font-family: inherit;
        cursor: pointer;
        border-radius: ${radiusSm};
        text-align: left;
        transition: background 0.1s;
      `;
      autoItem.onmouseenter = () => {
        autoItem.style.background = bgGlass;
      };
      autoItem.onmouseleave = () => {
        autoItem.style.background = isAuto ? bgGlassStrong : 'none';
      };
      autoItem.innerHTML = `
        <span style="display:inline-flex;align-items:center;width:16px;height:16px;opacity:0.7;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </span>
        <span>Auto</span>
        <span style="color:${tMuted};font-size:0.75rem;margin-left:auto;">${this.autoInstance ? this.autoInstance : 'most recent'}</span>
      `;
      autoItem.onclick = (ev) => {
        ev.stopPropagation();
        this._emitSelect('__auto__');
        this._close();
      };
      portal.appendChild(autoItem);

      // Divider before instances
      const dividerAuto = document.createElement('div');
      dividerAuto.style.cssText = `height: 1px; background: ${borderGlass}; margin: 2px 0 4px;`;
      portal.appendChild(dividerAuto);

      // Instance list
      const list = document.createElement('div');
      list.className = 'instance-list';
      list.style.cssText = 'max-height: 200px; overflow-y: auto; padding: 0 2px;';

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No matching instances';
        empty.style.cssText = `padding: 12px; color: ${tMuted}; font-size: 0.82rem; text-align: center; font-style: italic;`;
        list.appendChild(empty);
      } else {
        filtered.forEach((name) => {
          const item = document.createElement('button');
          const isCurrent = name === this.instanceName;
          item.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 7px 10px;
            border: none;
            background: ${isCurrent ? bgGlassStrong : 'none'};
            color: ${isCurrent ? accentSecondary : tPrimary};
            font-size: 0.85rem;
            font-family: inherit;
            cursor: pointer;
            border-radius: ${radiusSm};
            text-align: left;
            transition: background 0.12s;
            font-weight: ${isCurrent ? '600' : '400'};
          `;
          item.onmouseenter = () => {
            if (!isCurrent) item.style.background = bgGlass;
          };
          item.onmouseleave = () => {
            if (!isCurrent) item.style.background = 'none';
          };

          const dot = document.createElement('span');
          dot.textContent = isCurrent ? '●' : '';
          dot.style.cssText = `width: 12px; font-size: 0.6rem; color: ${accentSecondary}; flex-shrink: 0;`;
          item.appendChild(dot);

          const label = document.createElement('span');
          label.textContent = name;
          label.style.cssText =
            'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
          item.appendChild(label);

          item.onclick = (ev) => {
            ev.stopPropagation();
            // Always emit in auto mode (explicit click switches auto → manual),
            // or when selecting a different instance in manual mode.
            if (this.selectorMode === 'auto' || !isCurrent) {
              this._emitSelect(name);
            }
            this._close();
          };
          list.appendChild(item);
        });
      }

      portal.appendChild(list);

      // Creating new instance inline
      if (this._creating) {
        const divC = document.createElement('div');
        divC.style.cssText = `height: 1px; background: ${borderGlass}; margin: 4px 0;`;
        portal.appendChild(divC);

        const createWrap = document.createElement('div');
        createWrap.style.cssText = 'padding: 4px;';
        const createInput = document.createElement('input');
        createInput.type = 'text';
        createInput.placeholder = 'Instance name...';
        createInput.value = this._newName;
        createInput.style.cssText = `
          width: 100%;
          box-sizing: border-box;
          padding: 6px 10px;
          background: ${bgGlass};
          border: 1px solid ${accentPrimary};
          border-radius: ${radiusSm};
          color: ${tPrimary};
          font-size: 0.82rem;
          font-family: inherit;
          outline: none; /* focus-visible adds glow via JS below */
        `;
        createInput.addEventListener('input', () => {
          this._newName = createInput.value;
        });
        createInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && this._newName.trim()) {
            this._emitCreate(this._newName.trim());
            this._close();
          } else if (e.key === 'Escape') {
            this._creating = false;
            rebuild();
          }
        });
        createWrap.appendChild(createInput);
        portal.appendChild(createWrap);

        requestAnimationFrame(() => createInput.focus());
        return;
      }

      // Renaming inline
      if (this._renaming) {
        const divR = document.createElement('div');
        divR.style.cssText = `height: 1px; background: ${borderGlass}; margin: 4px 0;`;
        portal.appendChild(divR);

        const renameWrap = document.createElement('div');
        renameWrap.style.cssText = 'padding: 4px;';
        const renameLabel = document.createElement('div');
        renameLabel.textContent = `Rename "${this.instanceName}" to:`;
        renameLabel.style.cssText = `font-size: 0.75rem; color: ${tMuted}; margin-bottom: 4px; padding: 0 4px;`;
        renameWrap.appendChild(renameLabel);

        const renameInput = document.createElement('input');
        renameInput.type = 'text';
        renameInput.placeholder = 'New name...';
        renameInput.value = this._renameName;
        renameInput.style.cssText = `
          width: 100%;
          box-sizing: border-box;
          padding: 6px 10px;
          background: ${bgGlass};
          border: 1px solid ${accentPrimary};
          border-radius: ${radiusSm};
          color: ${tPrimary};
          font-size: 0.82rem;
          font-family: inherit;
          outline: none; /* focus-visible adds glow via JS below */
        `;
        renameInput.addEventListener('input', () => {
          this._renameName = renameInput.value;
        });
        renameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && this._renameName.trim()) {
            this._emitRename(this._renameName.trim());
            this._close();
          } else if (e.key === 'Escape') {
            this._renaming = false;
            rebuild();
          }
        });
        renameWrap.appendChild(renameInput);
        portal.appendChild(renameWrap);

        requestAnimationFrame(() => {
          renameInput.focus();
          renameInput.select();
        });
        return;
      }

      // Cloning inline
      if (this._cloning) {
        const divCl = document.createElement('div');
        divCl.style.cssText = `height: 1px; background: ${borderGlass}; margin: 4px 0;`;
        portal.appendChild(divCl);

        const cloneWrap = document.createElement('div');
        cloneWrap.style.cssText = 'padding: 4px;';
        const cloneLabel = document.createElement('div');
        cloneLabel.textContent = `Clone "${this.instanceName}" as:`;
        cloneLabel.style.cssText = `font-size: 0.75rem; color: ${tMuted}; margin-bottom: 4px; padding: 0 4px;`;
        cloneWrap.appendChild(cloneLabel);

        const cloneInput = document.createElement('input');
        cloneInput.type = 'text';
        cloneInput.placeholder = 'Clone name...';
        cloneInput.value = this._cloneName;
        cloneInput.style.cssText = `
          width: 100%;
          box-sizing: border-box;
          padding: 6px 10px;
          background: ${bgGlass};
          border: 1px solid ${accentPrimary};
          border-radius: ${radiusSm};
          color: ${tPrimary};
          font-size: 0.82rem;
          font-family: inherit;
          outline: none; /* focus-visible adds glow via JS below */
        `;
        cloneInput.addEventListener('input', () => {
          this._cloneName = cloneInput.value;
        });
        cloneInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && this._cloneName.trim()) {
            this._emitClone(this._cloneName.trim());
            this._close();
          } else if (e.key === 'Escape') {
            this._cloning = false;
            rebuild();
          }
        });
        cloneWrap.appendChild(cloneInput);
        portal.appendChild(cloneWrap);

        requestAnimationFrame(() => cloneInput.focus());
        return;
      }

      // Confirming delete inline
      if (this._confirmingDelete) {
        const divD = document.createElement('div');
        divD.style.cssText = `height: 1px; background: ${borderGlass}; margin: 4px 0;`;
        portal.appendChild(divD);

        const deleteWrap = document.createElement('div');
        deleteWrap.style.cssText = 'padding: 4px;';
        const deleteLabel = document.createElement('div');
        deleteLabel.textContent = `Delete "${this.instanceName}"? This cannot be undone.`;
        deleteLabel.style.cssText = `font-size: 0.78rem; color: ${colorError}; margin-bottom: 6px; padding: 0 4px;`;
        deleteWrap.appendChild(deleteLabel);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 6px; padding: 0 4px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
          flex: 1; padding: 5px 0; border: 1px solid ${borderGlass}; background: none;
          color: ${tMuted}; font-size: 0.78rem; font-family: inherit; cursor: pointer;
          border-radius: ${radiusSm}; transition: all 0.12s;
        `;
        cancelBtn.onmouseenter = () => {
          cancelBtn.style.background = bgGlass;
          cancelBtn.style.color = tPrimary;
        };
        cancelBtn.onmouseleave = () => {
          cancelBtn.style.background = 'none';
          cancelBtn.style.color = tMuted;
        };
        cancelBtn.onclick = (ev) => {
          ev.stopPropagation();
          this._confirmingDelete = false;
          rebuild();
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Delete';
        confirmBtn.style.cssText = `
          flex: 1; padding: 5px 0; border: 1px solid ${colorError}; background: hsla(0, 80%, 60%, 0.15);
          color: ${colorError}; font-size: 0.78rem; font-family: inherit; cursor: pointer;
          border-radius: ${radiusSm}; font-weight: 600; transition: all 0.12s;
        `;
        confirmBtn.onmouseenter = () => {
          confirmBtn.style.background = 'hsla(0, 80%, 60%, 0.25)';
        };
        confirmBtn.onmouseleave = () => {
          confirmBtn.style.background = 'hsla(0, 80%, 60%, 0.15)';
        };
        confirmBtn.onclick = (ev) => {
          ev.stopPropagation();
          this._emitDelete();
          this._close();
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        deleteWrap.appendChild(btnRow);
        portal.appendChild(deleteWrap);
        return;
      }

      // Action buttons row
      const divider2 = document.createElement('div');
      divider2.style.cssText = `height: 1px; background: ${borderGlass}; margin: 4px 0;`;
      portal.appendChild(divider2);

      const actions = document.createElement('div');
      actions.style.cssText =
        'display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px;';

      const makeBtn = (label: string, icon: string, onClick: () => void, danger = false) => {
        const btn = document.createElement('button');
        btn.style.cssText = `
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 8px;
          border: none;
          background: none;
          color: ${danger ? colorError : tMuted};
          font-size: 0.78rem;
          font-family: inherit;
          cursor: pointer;
          border-radius: ${radiusSm};
          transition: all 0.12s;
        `;
        btn.onmouseenter = () => {
          btn.style.background = danger ? 'hsla(0, 80%, 60%, 0.1)' : bgGlass;
          btn.style.color = danger ? colorError : tPrimary;
        };
        btn.onmouseleave = () => {
          btn.style.background = 'none';
          btn.style.color = danger ? colorError : tMuted;
        };
        btn.innerHTML = `<span style="display:inline-flex;align-items:center;width:16px;height:16px;">${icon}</span> ${label}`;
        btn.onclick = (ev) => {
          ev.stopPropagation();
          onClick();
        };
        return btn;
      };

      actions.appendChild(
        makeBtn('New', iconSvgString(iconPaths.plus), () => {
          this._creating = true;
          this._newName = '';
          rebuild();
        })
      );
      actions.appendChild(
        makeBtn('Clone', iconSvgString(iconPaths.clone), () => {
          this._cloning = true;
          this._cloneName = '';
          rebuild();
        })
      );
      actions.appendChild(
        makeBtn('Rename', iconSvgString(iconPaths.pencil), () => {
          this._renaming = true;
          this._renameName = this.instanceName;
          rebuild();
        })
      );
      actions.appendChild(
        makeBtn(
          'Delete',
          iconSvgString(iconPaths.trash),
          () => {
            if (this.instanceName === 'default') {
              return; // Can't delete default — beam-app will also guard this
            }
            this._confirmingDelete = true;
            rebuild();
          },
          true
        )
      );

      portal.appendChild(actions);
    };

    // Inject custom scrollbar styles into the portal
    const style = document.createElement('style');
    style.textContent = `
      .instance-list::-webkit-scrollbar { width: 6px; }
      .instance-list::-webkit-scrollbar-track { background: transparent; }
      .instance-list::-webkit-scrollbar-thumb {
        background: ${borderGlass};
        border-radius: 3px;
      }
      .instance-list::-webkit-scrollbar-thumb:hover {
        background: ${tMuted};
      }
      .instance-list { scrollbar-width: thin; scrollbar-color: ${borderGlass} transparent; }
    `;
    portal.appendChild(style);

    rebuild();
    document.body.appendChild(portal);

    // Position below pill
    const portalRect = portal.getBoundingClientRect();
    let left = anchorRect.left;
    let top = anchorRect.bottom + 4;

    // Clamp
    if (left + portalRect.width > window.innerWidth - 8) {
      left = window.innerWidth - portalRect.width - 8;
    }
    if (left < 8) left = 8;
    if (top + portalRect.height > window.innerHeight - 8) {
      top = anchorRect.top - portalRect.height - 4;
    }
    if (top < 8) top = 8;

    portal.style.left = `${left}px`;
    portal.style.top = `${top}px`;
    this._portal = portal;

    // Focus search
    requestAnimationFrame(() => {
      const input = portal.querySelector('input');
      input?.focus();
    });
  }

  private _close() {
    this._open = false;
    this._removePortal();
  }

  private _removePortal() {
    if (this._portal) {
      this._portal.remove();
      this._portal = null;
    }
  }

  private _emit(action: string, detail?: any) {
    this.dispatchEvent(
      new CustomEvent('instance-action', {
        detail: { action, ...detail },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _emitSelect(name: string) {
    this._emit('switch', { instance: name });
  }

  private _emitCreate(name: string) {
    this._emit('create', { instance: name });
  }

  private _emitClone(cloneName: string) {
    this._emit('clone', { instance: this.instanceName, cloneName });
  }

  private _emitRename(newName: string) {
    this._emit('rename', { instance: this.instanceName, newName });
  }

  private _emitDelete() {
    this._emit('delete', { instance: this.instanceName });
  }

  close() {
    this._close();
  }
}
