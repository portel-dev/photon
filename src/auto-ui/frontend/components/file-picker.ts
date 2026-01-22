import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResponse {
  path: string;
  parent: string | null;
  items: FileEntry[];
}

@customElement('file-picker')
export class FilePicker extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      .picker-container {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        border: 1px solid var(--border-glass);
        background: var(--bg-glass);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }

      .current-path {
        padding: var(--space-sm);
        background: rgba(0,0,0,0.2);
        font-family: var(--font-mono);
        font-size: 0.8rem;
        color: var(--t-muted);
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .path-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .file-list {
        max-height: 200px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      .file-item {
        padding: 6px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.9rem;
        transition: background 0.1s;
        border-bottom: 1px solid rgba(255,255,255,0.02);
      }

      .file-item:hover {
        background: rgba(255,255,255,0.05);
      }

      .file-item.selected {
        background: var(--accent-primary);
        color: white;
      }

      .icon {
        opacity: 0.7;
      }

      /* Input Base Styles */
      input {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        box-sizing: border-box;
        width: 100%;
        transition: all 0.2s;
      }

      input:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      input.error {
        border-color: #f87171;
      }

      input.error:focus {
        box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.3);
      }

      .input-wrapper {
        display: flex;
        gap: 0; /* Merged look */
      }
      
      .input-wrapper input {
        flex: 1;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: none;
      }
      
      .input-wrapper button {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        border-left: 1px solid var(--border-glass);
      }

      /* Modal styling if we want it to be a popover later, 
         for now it's inline */
      .browser-area {
        border-top: 1px solid var(--border-glass);
      }

      /* Button Styles */
      button {
        font-family: var(--font-sans);
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-secondary {
        background: transparent;
        color: var(--t-muted);
        border: 1px solid var(--border-glass);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
      }

      .btn-secondary:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }
    `
  ];

  @property({ type: String })
  value = '';

  @property({ type: Boolean })
  hasError = false;

  @state()
  private _isOpen = false;

  @state()
  private _currentPath = '';

  @state()
  private _items: FileEntry[] = [];

  @state()
  private _loading = false;

  firstUpdated() {
    // Determine initial path (use current value if absolute path, or default)
    if (this.value && this.value.startsWith('/')) {
      this._currentPath = this.value.substring(0, this.value.lastIndexOf('/'));
    }
  }

  render() {
    return html`
      <div class="input-wrapper" style="align-items: center;">
        <input
          type="text"
          class="${this.hasError ? 'error' : ''}"
          .value=${this.value}
          @input=${this._handleInput}
          placeholder="/path/to/file"
        >
        <button class="btn-secondary" style="height: auto; white-space: nowrap;" @click=${this._toggleBrowser}>
          ${this._isOpen ? 'Close' : 'Browse'}
        </button>
      </div>

      ${this._isOpen ? html`
        <div class="picker-container" style="margin-top: var(--space-sm);">
          <div class="current-path">
            <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.7rem;" @click=${this._goUp}>↑</button>
            <span class="path-text" title=${this._currentPath}>${this._currentPath || 'Loading...'}</span>
          </div>
          
          <div class="file-list">
            ${this._loading
          ? html`<div style="padding: var(--space-md); color: var(--t-muted);">Loading...</div>`
          : this._items.map(item => this._renderItem(item))}
            
            ${!this._loading && this._items.length === 0 ? html`
              <div style="padding: var(--space-md); color: var(--t-muted);">Empty directory</div>
            ` : ''}
          </div>
        </div>
      ` : ''}
    `;
  }

  private _renderItem(item: FileEntry) {
    const isSelected = this.value === item.path;
    return html`
      <div 
        class="file-item ${isSelected ? 'selected' : ''}"
        @click=${() => this._handleItemClick(item)}
      >
        <span class="icon">${item.isDirectory ? '📁' : '📄'}</span>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${item.name}</span>
      </div>
    `;
  }

  private _handleInput(e: Event) {
    const newVal = (e.target as HTMLInputElement).value;
    this.value = newVal;
    this._dispatchChange();
  }

  private _toggleBrowser() {
    this._isOpen = !this._isOpen;
    if (this._isOpen) {
      this._loadPath(this._currentPath || '');
    }
  }

  private async _loadPath(path: string) {
    this._loading = true;
    try {
      const url = new URL('/api/browse', window.location.origin);
      if (path) url.searchParams.set('path', path);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to load');

      const data: BrowseResponse = await res.json();
      this._currentPath = data.path;
      this._items = data.items;
    } catch (err) {
      console.error(err);
    } finally {
      this._loading = false;
    }
  }

  private _handleItemClick(item: FileEntry) {
    if (item.isDirectory) {
      this._loadPath(item.path);
    } else {
      this.value = item.path;
      this._dispatchChange();
      // Optional: Close on select? Maybe keep open for rapid changes.
    }
  }

  private _goUp() {
    this._loadPath(this._currentPath + '/..');
  }

  private _dispatchChange() {
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: this.value },
      bubbles: true,
      composed: true
    }));
  }
}
