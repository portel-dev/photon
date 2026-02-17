/**
 * Photon Studio — Inline code editor for Beam.
 * Uses CodeMirror 6 with syntax highlighting, JSDoc tag autocomplete,
 * and auto-parsing Inspector panel.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { mcpClient } from '../services/mcp-client.js';
import { showToast } from './toast-manager.js';
import { createDocblockCompletions, photonFormatCompletions } from './docblock-completions.js';
import type { PhotonTemplate } from './studio-templates.js';
import type { ParseResult } from './studio-preview.js';
import './studio-preview.js';

// Light theme (minimal — use CodeMirror defaults)
const lightTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff' },
  '.cm-gutters': { backgroundColor: '#f8f9fa', color: '#888', borderRight: '1px solid #e0e0e0' },
  '.cm-activeLineGutter': { backgroundColor: '#e8e8e8' },
  '.cm-activeLine': { backgroundColor: '#f0f4ff' },
});

@customElement('photon-studio')
export class PhotonStudio extends LitElement {
  @property() photonName = '';
  @property() theme = 'dark';

  @state() private _source = '';
  @state() private _originalSource = '';
  @state() private _dirty = false;
  @state() private _parseResult: ParseResult | null = null;
  @state() private _parsing = false;
  @state() private _saving = false;
  @state() private _showInspector = true;
  @state() private _loading = true;
  @state() private _filePath = '';
  @state() private _error = '';

  private _editorView: EditorView | null = null;
  private _parseDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PARSE_DEBOUNCE_MS = 1500;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--font-sans, system-ui, sans-serif);
    }

    /* ─── Toolbar ─── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
      border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      flex-shrink: 0;
    }

    .toolbar-title {
      font-weight: 600;
      font-size: var(--text-md);
      color: var(--t-primary, #e0e0e0);
      margin-right: auto;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .dirty-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-warning);
      display: inline-block;
    }

    .toolbar-btn {
      padding: 5px 12px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
      background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
      color: var(--t-primary, #e0e0e0);
      font-size: var(--text-sm);
      cursor: pointer;
      transition: background 0.15s;
    }

    .toolbar-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .toolbar-btn.primary {
      background: var(--accent-primary);
      color: #fff;
      border-color: transparent;
    }

    .toolbar-btn.primary:hover {
      filter: brightness(1.1);
    }

    .toolbar-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--t-muted, #888);
      cursor: pointer;
      font-size: var(--text-xl);
      padding: 2px 6px;
      line-height: 1;
    }

    .close-btn:hover {
      color: var(--t-primary, #e0e0e0);
    }

    /* ─── Main layout ─── */
    .studio-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .editor-pane {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .editor-container {
      flex: 1;
      overflow: auto;
    }

    .editor-container .cm-editor {
      height: 100%;
    }

    .editor-container .cm-scroller {
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    /* ─── Inspector pane ─── */
    .preview-pane {
      width: 280px;
      border-left: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      overflow-y: auto;
      padding: 12px;
      flex-shrink: 0;
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .preview-title {
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--t-muted, #888);
      font-weight: 600;
    }

    /* ─── Status bar ─── */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      background: var(--bg-elevated, rgba(255, 255, 255, 0.02));
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      font-size: var(--text-xs);
      color: var(--t-muted, #888);
      flex-shrink: 0;
    }

    .status-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .kbd {
      display: inline-block;
      padding: 0 4px;
      border-radius: var(--radius-xs);
      background: rgba(255, 255, 255, 0.06);
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
    }

    /* ─── Loading / Error ─── */
    .loading-state,
    .error-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--t-muted, #888);
      font-size: var(--text-md);
    }

    .error-state {
      color: var(--color-error);
      flex-direction: column;
      gap: 8px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.photonName) {
      this._loadSource();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._editorView?.destroy();
    this._editorView = null;
    if (this._parseDebounceTimer) {
      clearTimeout(this._parseDebounceTimer);
      this._parseDebounceTimer = null;
    }
  }

  updated(changed: Map<string, any>) {
    if (changed.has('photonName') && this.photonName && !changed.has('_loading')) {
      this._loadSource();
    }
    if (changed.has('theme') && this._editorView) {
      // Rebuild editor with new theme
      this._initEditor();
    }
  }

  private async _loadSource() {
    this._loading = true;
    this._error = '';
    try {
      const result = await mcpClient.callTool('beam/studio-read', { name: this.photonName });
      const text = result?.content?.[0]?.text;
      if (!text) throw new Error('Empty response');
      const parsed = JSON.parse(text);
      this._source = parsed.source;
      this._originalSource = parsed.source;
      this._filePath = parsed.path || '';
      this._dirty = false;
      this._loading = false;
      await this.updateComplete;
      this._initEditor();
      // Auto-parse on load
      this._parse();
    } catch (err: any) {
      this._error = err.message || 'Failed to load source';
      this._loading = false;
    }
  }

  private _initEditor() {
    const container = this.renderRoot.querySelector('.editor-container');
    if (!container) return;

    // Destroy existing editor
    if (this._editorView) {
      this._editorView.destroy();
      this._editorView = null;
    }

    const isDark = this.theme === 'dark';

    // Create completion source once so CM6 gets a stable function reference
    const docblockCompletions = createDocblockCompletions(mcpClient.getServerVersion());

    const state = EditorState.create({
      doc: this._source,
      extensions: [
        basicSetup,
        javascript({ typescript: true }),
        isDark ? oneDark : lightTheme,
        // Add photon JSDoc completions via language data (merges with basicSetup's autocompletion)
        EditorState.languageData.of(() => [
          { autocomplete: docblockCompletions },
          { autocomplete: photonFormatCompletions },
        ]),
        // JSDoc comment continuation at high priority so it fires before basicSetup's Enter
        Prec.high(
          keymap.of([
            {
              key: 'Enter',
              run: (view: EditorView) => {
                const { state: st } = view;
                const pos = st.selection.main.head;
                const textBefore = st.doc.sliceString(Math.max(0, pos - 500), pos);
                const lastOpen = textBefore.lastIndexOf('/**');
                const lastClose = textBefore.lastIndexOf('*/');
                if (lastOpen <= lastClose) return false; // not inside JSDoc

                // Detect indentation of current line's " * " prefix
                const line = st.doc.lineAt(pos);
                const match = line.text.match(/^(\s*)\*\s?/);
                if (!match) return false; // no leading * pattern

                const indent = match[1];
                view.dispatch(
                  st.update({
                    changes: { from: pos, insert: `\n${indent}* ` },
                    selection: { anchor: pos + indent.length + 3 }, // after "* "
                  })
                );
                return true;
              },
            },
          ])
        ),
        keymap.of([
          ...defaultKeymap,
          {
            key: 'Mod-s',
            run: () => {
              this._save();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this._source = update.state.doc.toString();
            this._dirty = this._source !== this._originalSource;
            this._scheduleParse();
          }
        }),
      ],
    });

    this._editorView = new EditorView({
      state,
      parent: container as HTMLElement,
    });
  }

  private _scheduleParse() {
    if (this._parseDebounceTimer) {
      clearTimeout(this._parseDebounceTimer);
    }
    this._parseDebounceTimer = setTimeout(() => {
      this._parseDebounceTimer = null;
      this._parse();
    }, PhotonStudio.PARSE_DEBOUNCE_MS);
  }

  private async _save() {
    if (this._saving || !this._dirty) return;
    this._saving = true;
    try {
      const result = await mcpClient.callTool('beam/studio-write', {
        name: this.photonName,
        source: this._source,
      });
      const text = result?.content?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.success) {
          this._originalSource = this._source;
          this._dirty = false;
          if (parsed.parseResult) {
            this._parseResult = parsed.parseResult;
          }
          showToast('Saved and reloaded', 'success');
          this.dispatchEvent(new CustomEvent('studio-saved', { bubbles: true, composed: true }));
        } else {
          showToast(`Save failed: ${parsed.error}`, 'error');
        }
      }
    } catch (err: any) {
      showToast(`Save error: ${err.message}`, 'error');
    } finally {
      this._saving = false;
    }
  }

  private async _parse() {
    if (this._parsing) return;
    this._parsing = true;
    try {
      const result = await mcpClient.callTool('beam/studio-parse', { source: this._source });
      const text = result?.content?.[0]?.text;
      if (text) {
        this._parseResult = JSON.parse(text);
      }
    } catch (err: any) {
      showToast(`Parse error: ${err.message}`, 'error');
    } finally {
      this._parsing = false;
    }
  }

  applyTemplate(template: PhotonTemplate) {
    this._source = template.source;
    this._dirty = this._source !== this._originalSource;
    this._parseResult = null;

    // Update editor content
    if (this._editorView) {
      this._editorView.dispatch({
        changes: {
          from: 0,
          to: this._editorView.state.doc.length,
          insert: template.source,
        },
      });
    }
  }

  private _close() {
    if (this._dirty) {
      if (!confirm('You have unsaved changes. Close anyway?')) return;
    }
    this.dispatchEvent(new CustomEvent('studio-close', { bubbles: true, composed: true }));
  }

  render() {
    if (this._loading) {
      return html`
        <div class="toolbar">
          <span class="toolbar-title">Studio</span>
          <button class="close-btn" @click=${this._close}>&times;</button>
        </div>
        <div class="loading-state">Loading source...</div>
      `;
    }

    if (this._error) {
      return html`
        <div class="toolbar">
          <span class="toolbar-title">Studio</span>
          <button class="close-btn" @click=${this._close}>&times;</button>
        </div>
        <div class="error-state">
          <span>${this._error}</span>
          <button class="toolbar-btn" @click=${this._loadSource}>Retry</button>
        </div>
      `;
    }

    return html`
      <div class="toolbar">
        <span class="toolbar-title">
          ${this.photonName}
          ${this._dirty ? html`<span class="dirty-dot" title="Unsaved changes"></span>` : ''}
        </span>

        <button class="toolbar-btn" @click=${() => (this._showInspector = !this._showInspector)}>
          ${this._showInspector ? 'Hide Inspector' : 'Inspector'}
        </button>

        <button
          class="toolbar-btn primary"
          @click=${this._save}
          ?disabled=${!this._dirty || this._saving}
          title="Save (Cmd+S)"
        >
          ${this._saving ? 'Saving...' : 'Save'}
        </button>

        <button class="close-btn" @click=${this._close} title="Close Studio">&times;</button>
      </div>

      <div class="studio-body">
        <div class="editor-pane">
          <div class="editor-container"></div>
        </div>

        ${this._showInspector
          ? html`
              <div class="preview-pane">
                <div class="preview-header">
                  <span class="preview-title">Inspector</span>
                </div>
                <studio-preview
                  .parseResult=${this._parseResult}
                  .loading=${this._parsing}
                ></studio-preview>
              </div>
            `
          : ''}
      </div>

      <div class="status-bar">
        <span class="status-path" title="${this._filePath}">${this._filePath}</span>
        <span><span class="kbd">Cmd+S</span> Save</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'photon-studio': PhotonStudio;
  }
}
