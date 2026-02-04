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
        background: rgba(0, 0, 0, 0.2);
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
        border-bottom: 1px solid rgba(255, 255, 255, 0.02);
      }

      .file-item:hover {
        background: rgba(255, 255, 255, 0.05);
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

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        input {
          min-height: 44px;
          font-size: 16px; /* Prevent iOS zoom */
        }

        .btn-secondary {
          min-height: 44px;
        }

        .file-item {
          padding: var(--space-sm) var(--space-md);
          min-height: 44px;
        }

        .file-list {
          max-height: 300px;
        }
      }

      @media (max-width: 480px) {
        .input-wrapper {
          flex-direction: column;
          gap: var(--space-xs);
        }

        .input-wrapper input {
          border-radius: var(--radius-sm);
          border-right: 1px solid var(--border-glass);
        }

        .input-wrapper button {
          border-radius: var(--radius-sm);
          border-left: 1px solid var(--border-glass);
          width: 100%;
        }

        .current-path {
          flex-wrap: wrap;
        }

        .path-text {
          width: 100%;
          margin-top: var(--space-xs);
        }
      }
    `,
  ];

  @property({ type: String })
  value = '';

  @property({ type: Boolean })
  hasError = false;

  /** File extension filter (e.g., ".ts,.js,.tsx" or "*.photon.ts") */
  @property({ type: String })
  accept = '';

  /** Selection mode: 'file' only allows file selection, 'directory' allows directory selection */
  @property({ type: String })
  mode: 'file' | 'directory' = 'file';

  /** Root directory constraint — browser won't navigate above this */
  @property({ type: String })
  root = '';

  /** Photon name — used to resolve the photon's workdir as root */
  @property({ type: String })
  photonName = '';

  /** Placeholder text shown when input is empty */
  @property({ type: String })
  placeholder = '';

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
          placeholder="${this.placeholder || '/path/to/file'}"
        />
        <button
          class="btn-secondary"
          style="height: auto; white-space: nowrap;"
          @click=${this._toggleBrowser}
        >
          ${this._isOpen ? 'Close' : 'Browse'}
        </button>
      </div>

      ${this._isOpen
        ? html`
            <div class="picker-container" style="margin-top: var(--space-sm);">
              <div class="current-path">
                <button
                  class="btn-secondary"
                  style="padding: 2px 6px; font-size: 0.7rem;"
                  @click=${this._goUp}
                  ?disabled=${!!(this.root && this._currentPath === this.root)}
                >
                  ↑
                </button>
                <span class="path-text" title=${this._currentPath}
                  >${this._currentPath || 'Loading...'}</span
                >
              </div>

              <div class="file-list">
                ${this._loading
                  ? html`<div style="padding: var(--space-md); color: var(--t-muted);">
                      Loading...
                    </div>`
                  : this._items
                      .filter((item) => this._matchesFilter(item))
                      .map((item) => this._renderItem(item))}
                ${!this._loading &&
                this._items.filter((item) => this._matchesFilter(item)).length === 0
                  ? html`
                      <div style="padding: var(--space-md); color: var(--t-muted);">
                        Empty directory
                      </div>
                    `
                  : ''}
              </div>
            </div>
          `
        : ''}
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
      if (this.root) url.searchParams.set('root', this.root);
      if (this.photonName) url.searchParams.set('photon', this.photonName);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error('Failed to load');

      const data: BrowseResponse & { root?: string } = await res.json();
      this._currentPath = data.path;
      this._items = data.items;
      // Store resolved root from server for parent navigation constraint
      if (data.root && !this.root) {
        this.root = data.root;
      }
    } catch (err) {
      console.error(err);
    } finally {
      this._loading = false;
    }
  }

  private _handleItemClick(item: FileEntry) {
    if (item.isDirectory) {
      if (this.mode === 'directory') {
        // In directory mode, clicking a directory selects it
        this.value = item.path;
        this._dispatchChange();
        this._isOpen = false;
      } else {
        // In file mode, clicking a directory navigates into it
        this._loadPath(item.path);
      }
    } else {
      if (this.mode === 'directory') return; // Ignore file clicks in directory mode
      this.value = item.path;
      this._dispatchChange();
      this._isOpen = false;
    }
  }

  private _goUp() {
    // Don't navigate above root
    if (this.root && this._currentPath === this.root) return;
    this._loadPath(this._currentPath + '/..');
  }

  // Binary/non-text extensions that are useless to read as text
  private static readonly BINARY_EXTENSIONS = new Set([
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.tiff', '.tif',
    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flac', '.wav', '.ogg', '.webm',
    '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z', '.dmg', '.iso',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.sqlite', '.db', '.sqlite3',
    '.pyc', '.class', '.o', '.obj', '.wasm',
  ]);

  /** Check if a file matches the accept filter */
  private _matchesFilter(item: FileEntry): boolean {
    // Always show directories
    if (item.isDirectory) return true;

    // In directory mode, show all items for navigation context
    if (this.mode === 'directory') return true;

    const fileName = item.name.toLowerCase();

    // If explicit accept filter is set, use it
    if (this.accept) {
      const filters = this.accept.split(',').map((f) => f.trim().toLowerCase());
      return filters.some((filter) => {
        if (filter.startsWith('*.')) {
          const suffix = filter.slice(1);
          return fileName.endsWith(suffix);
        }
        const ext = filter.startsWith('.') ? filter : `.${filter}`;
        return fileName.endsWith(ext);
      });
    }

    // Default: hide known binary files
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex > 0) {
      const ext = fileName.slice(dotIndex);
      if (FilePicker.BINARY_EXTENSIONS.has(ext)) return false;
    }

    return true;
  }

  private _dispatchChange() {
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      })
    );
  }
}
