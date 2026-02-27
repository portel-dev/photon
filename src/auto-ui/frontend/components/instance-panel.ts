import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

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
        padding: 3px 10px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-full, 20px);
        cursor: pointer;
        font-size: var(--text-xs);
        font-weight: 500;
        color: var(--t-muted);
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .instance-pill:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .instance-pill .chevron {
        opacity: 0.6;
        transition: transform 0.15s ease;
        font-size: 0.7em;
      }

      .instance-pill:hover .chevron {
        opacity: 1;
      }

      .instance-pill .chevron.open {
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
    const display = this.instanceName === 'default' ? 'default' : this.instanceName;
    return html`
      <button
        class="instance-pill"
        @click=${this._toggle}
        title="Switch instance"
        aria-label="Current instance: ${display}"
      >
        ${display}
        <span class="chevron ${this._open ? 'open' : ''}">▾</span>
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
        outline: none;
      `;
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

      // Instance list
      const list = document.createElement('div');
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
            if (!isCurrent) {
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
          outline: none;
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
          outline: none;
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
          outline: none;
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
        btn.innerHTML = `<span style="font-size: 0.9rem;">${icon}</span> ${label}`;
        btn.onclick = (ev) => {
          ev.stopPropagation();
          onClick();
        };
        return btn;
      };

      actions.appendChild(
        makeBtn('New', '+', () => {
          this._creating = true;
          this._newName = '';
          rebuild();
        })
      );
      actions.appendChild(
        makeBtn('Clone', '⧉', () => {
          this._cloning = true;
          this._cloneName = '';
          rebuild();
        })
      );
      actions.appendChild(
        makeBtn('Rename', '✎', () => {
          this._renaming = true;
          this._renameName = this.instanceName;
          rebuild();
        })
      );
      actions.appendChild(
        makeBtn(
          'Delete',
          '🗑',
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
