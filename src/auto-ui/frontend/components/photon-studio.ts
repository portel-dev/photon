/**
 * Photon Studio — Inline code editor for Beam.
 * Uses CodeMirror 6 with syntax highlighting, JSDoc tag autocomplete,
 * and auto-parsing Inspector panel.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap } from '@codemirror/commands';
import type { CompletionContext } from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import { basicSetup } from 'codemirror';
import { mcpClient } from '../services/mcp-client.js';
import { showToast } from './toast-manager.js';
import {
  createDocblockCompletions,
  photonFormatCompletions,
  photonRuntimeCompletions,
} from './docblock-completions.js';
import {
  type PhotonTsCodeFix,
  type PhotonTsOutlineItem,
  PhotonTsWorkerClient,
  type PhotonTsDefinition,
  type PhotonTsDiagnostic,
  type PhotonTsHover,
  type PhotonTsProjectFile,
  type PhotonTsRenamePlan,
  type PhotonTsReferences,
  type PhotonTsSignatureHelp,
} from '../services/photon-ts-worker-client.js';
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
  @state() private _tsDiagnostics: PhotonTsDiagnostic[] = [];
  @state() private _definitionPreview: PhotonTsDefinition | null = null;
  @state() private _referencesPreview: PhotonTsReferences | null = null;
  @state() private _renamePreview: PhotonTsRenamePlan | null = null;
  @state() private _codeFixPreview: {
    diagnostic: PhotonTsDiagnostic;
    fixes: PhotonTsCodeFix[];
  } | null = null;
  @state() private _signatureHelp: PhotonTsSignatureHelp | null = null;
  @state() private _outlineItems: PhotonTsOutlineItem[] = [];
  @state() private _showOutline = true;
  @state() private _activeOutlineKey = '';
  @state() private _readOnlySourcePreview: {
    title: string;
    filePath: string;
    source: string;
    originalSource?: string;
    line: number;
    canEdit?: boolean;
    editing?: boolean;
    dirty?: boolean;
  } | null = null;
  @state() private _hoverEnabled = true;

  private _editorView: EditorView | null = null;
  private _parseDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PARSE_DEBOUNCE_MS = 1500;
  private _tsWorkerClient: PhotonTsWorkerClient | null = null;
  private _diagnosticRequestToken = 0;
  private _projectSupportFiles: PhotonTsProjectFile[] = [];
  private _importSignature = '';
  private _projectRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _signatureHelpToken = 0;
  private _outlineToken = 0;

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
      scrollbar-width: thin;
      scrollbar-color: var(--border-glass, rgba(255, 255, 255, 0.08)) transparent;
    }

    .editor-container .cm-editor {
      height: 100%;
    }

    .editor-container .cm-scroller {
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
      scrollbar-width: thin;
      scrollbar-color: var(--border-glass, rgba(255, 255, 255, 0.08)) transparent;
    }

    .editor-container .cm-scroller::-webkit-scrollbar {
      width: 5px;
      height: 5px;
    }
    .editor-container .cm-scroller::-webkit-scrollbar-track {
      background: transparent;
    }
    .editor-container .cm-scroller::-webkit-scrollbar-thumb {
      background: var(--border-glass, rgba(255, 255, 255, 0.08));
      border-radius: 4px;
    }
    .editor-container .cm-scroller::-webkit-scrollbar-thumb:hover {
      background: var(--t-muted, #888);
    }

    /* ─── Custom scrollbar ─── */
    .editor-container ::-webkit-scrollbar,
    .preview-pane::-webkit-scrollbar {
      width: 5px;
      height: 5px;
    }
    .editor-container ::-webkit-scrollbar-track,
    .preview-pane::-webkit-scrollbar-track {
      background: transparent;
    }
    .editor-container ::-webkit-scrollbar-thumb,
    .preview-pane::-webkit-scrollbar-thumb {
      background: var(--border-glass, rgba(255, 255, 255, 0.08));
      border-radius: 4px;
    }
    .editor-container ::-webkit-scrollbar-thumb:hover,
    .preview-pane::-webkit-scrollbar-thumb:hover {
      background: var(--t-muted, #888);
    }

    /* ─── Inspector pane ─── */
    .preview-pane {
      width: 280px;
      border-left: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      overflow-y: auto;
      padding: 12px;
      flex-shrink: 0;
      scrollbar-width: thin;
      scrollbar-color: var(--border-glass, rgba(255, 255, 255, 0.08)) transparent;
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

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .status-pill.ok {
      color: #7ee787;
    }

    .status-pill.warning {
      color: #f2cc60;
    }

    .status-pill.error {
      color: #ff7b72;
    }

    .problems-panel {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 12px 10px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(255, 255, 255, 0.02);
    }

    .definition-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(88, 166, 255, 0.05);
    }

    .definition-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .definition-title {
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #79c0ff;
    }

    .definition-path {
      font-size: var(--text-xs);
      color: var(--t-muted, #888);
    }

    .definition-preview {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.24);
      color: var(--t-primary, #e0e0e0);
      font-size: 12px;
      line-height: 1.55;
      overflow: auto;
      white-space: pre-wrap;
      font-family: var(--font-mono, monospace);
    }

    .references-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(110, 231, 183, 0.06);
    }

    .references-count {
      font-size: var(--text-xs);
      color: var(--t-muted, #888);
    }

    .reference-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .reference-item {
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      cursor: pointer;
    }

    .reference-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .reference-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: var(--text-xs);
      color: var(--t-muted, #888);
      margin-bottom: 6px;
    }

    .reference-preview {
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      line-height: 1.5;
      color: var(--t-primary, #e0e0e0);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .rename-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(242, 204, 96, 0.08);
    }

    .code-fix-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(121, 192, 255, 0.08);
    }

    .rename-summary {
      font-size: var(--text-sm);
      color: var(--t-primary, #e0e0e0);
    }

    .rename-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .rename-file-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rename-file-item {
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      cursor: pointer;
    }

    .rename-file-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .rename-file-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: var(--text-xs);
      color: var(--t-muted, #888);
      margin-bottom: 6px;
    }

    .read-source-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(255, 255, 255, 0.035);
    }

    .read-source-scroll {
      max-height: 320px;
      overflow: auto;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.24);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .read-source-code {
      margin: 0;
      padding: 12px 0;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      line-height: 1.55;
      color: var(--t-primary, #e0e0e0);
      white-space: pre;
    }

    .read-source-line {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      gap: 12px;
      padding: 0 12px;
    }

    .read-source-line.active {
      background: rgba(88, 166, 255, 0.14);
    }

    .read-source-line-number {
      color: var(--t-muted, #888);
      text-align: right;
      user-select: none;
    }

    .read-source-line-text {
      overflow-x: auto;
    }

    .read-source-editor {
      width: 100%;
      min-height: 320px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 12px;
      background: rgba(0, 0, 0, 0.24);
      color: var(--t-primary, #e0e0e0);
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      line-height: 1.55;
      resize: vertical;
      outline: none;
    }

    .read-source-editor:focus {
      border-color: rgba(88, 166, 255, 0.45);
      box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.18);
    }

    .read-source-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .problem-item {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      font-size: var(--text-xs);
      line-height: 1.45;
      color: var(--t-primary, #e0e0e0);
      cursor: pointer;
      border-radius: 8px;
      padding: 4px 6px;
      margin: 0 -6px;
    }

    .problem-item:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .problem-badge {
      flex-shrink: 0;
      min-width: 44px;
      padding: 2px 6px;
      border-radius: 999px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-align: center;
    }

    .problem-badge.error {
      color: #ff7b72;
      background: rgba(255, 123, 114, 0.12);
    }

    .problem-badge.warning {
      color: #f2cc60;
      background: rgba(242, 204, 96, 0.12);
    }

    .problem-badge.info {
      color: #79c0ff;
      background: rgba(121, 192, 255, 0.12);
    }

    .problem-text {
      flex: 1;
      min-width: 0;
    }

    .problem-code {
      color: var(--t-muted, #888);
      margin-left: 6px;
      white-space: nowrap;
    }

    .problem-more {
      font-size: var(--text-xs);
      color: var(--t-muted, #888);
      padding-left: 52px;
    }

    .problem-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }

    .problem-action-btn {
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: var(--t-primary, #e0e0e0);
      font-size: 11px;
      cursor: pointer;
    }

    .problem-action-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .cm-tooltip.cm-photon-hover {
      max-width: 420px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: #151821;
      color: #e6edf3;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
      padding: 10px 12px;
      font-family: var(--font-sans, system-ui, sans-serif);
    }

    .cm-photon-hover-signature {
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      color: #c9d1d9;
      margin-bottom: 8px;
    }

    .cm-photon-hover-kind {
      display: inline-block;
      margin-bottom: 8px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(88, 166, 255, 0.14);
      color: #79c0ff;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .cm-photon-hover-doc {
      font-size: 12px;
      line-height: 1.55;
      color: #c9d1d9;
      white-space: pre-wrap;
    }

    .cm-photon-hover-tags {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      line-height: 1.45;
      color: #9fb3c8;
    }

    .status-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .signature-help-bar {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 12px 10px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(88, 166, 255, 0.06);
    }

    .signature-call {
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      line-height: 1.55;
      color: var(--t-primary, #e0e0e0);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .signature-parameter {
      color: #9fb3c8;
    }

    .signature-parameter.active {
      color: #79c0ff;
      font-weight: 700;
    }

    .signature-doc {
      font-size: var(--text-xs);
      line-height: 1.45;
      color: var(--t-muted, #a8b3c7);
      white-space: pre-wrap;
    }

    .outline-panel {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 12px 10px;
      border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      background: rgba(255, 255, 255, 0.03);
    }

    .outline-header {
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--t-muted, #9fb3c8);
    }

    .outline-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .outline-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--t-primary, #e0e0e0);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.02);
    }

    .outline-item:hover {
      background: rgba(255, 255, 255, 0.07);
    }

    .outline-item.active {
      background: rgba(88, 166, 255, 0.14);
      border: 1px solid rgba(88, 166, 255, 0.18);
    }

    .outline-kind {
      color: var(--t-muted, #888);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
      min-width: 56px;
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
      void this._loadSource();
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
    if (this._projectRefreshTimer) {
      clearTimeout(this._projectRefreshTimer);
      this._projectRefreshTimer = null;
    }
    this._tsWorkerClient?.destroy();
    this._tsWorkerClient = null;
  }

  updated(changed: Map<string, any>) {
    if (changed.has('photonName') && this.photonName && !changed.has('_loading')) {
      void this._loadSource();
    }
    if (changed.has('theme') && this._editorView) {
      // Rebuild editor with new theme
      this._initEditor();
    }
    if (changed.has('_readOnlySourcePreview') && this._readOnlySourcePreview) {
      requestAnimationFrame(() => {
        const activeLine = this.renderRoot.querySelector('.read-source-line.active');
        activeLine?.scrollIntoView({ block: 'center' });
      });
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
      this._projectSupportFiles = parsed.supportFiles || [];
      this._importSignature = this._extractImportSignature(this._source);
      this._dirty = false;
      this._loading = false;
      this._tsWorkerClient?.destroy();
      this._tsWorkerClient = new PhotonTsWorkerClient();
      await this._syncTypeScriptProject().catch(() => {});
      await this.updateComplete;
      this._initEditor();
      // Auto-parse on load
      void this._parse();
      void this._refreshTypeScriptDiagnostics();
      void this._refreshSignatureHelp();
      void this._refreshOutline();
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
    const tsWorker = this._tsWorkerClient;

    // Create completion source once so CM6 gets a stable function reference
    const docblockCompletions = createDocblockCompletions(mcpClient.getServerVersion());
    const tsCompletions = async (context: CompletionContext) => {
      if (!tsWorker || !this._filePath) return null;
      return tsWorker.completions(this._filePath, this._source, context);
    };
    const tsLint = linter(async () => {
      if (!tsWorker || !this._filePath) return [];
      const diagnostics = await tsWorker.diagnostics(this._filePath, this._source).catch(() => []);
      this._tsDiagnostics = diagnostics;
      return diagnostics.map(
        (diag): Diagnostic => ({
          from: diag.from,
          to: Math.max(diag.to, diag.from + 1),
          severity: diag.severity,
          message: diag.message,
          source: diag.code ? `ts(${diag.code})` : 'ts',
        })
      );
    });
    const tsHover = hoverTooltip(async (_view, pos) => {
      if (!this._hoverEnabled || !tsWorker || !this._filePath) return null;
      const hover = await tsWorker.hover(this._filePath, this._source, pos).catch(() => null);
      return this._createHoverTooltip(hover);
    });

    const state = EditorState.create({
      doc: this._source,
      extensions: [
        basicSetup,
        javascript({ typescript: true }),
        isDark ? oneDark : lightTheme,
        tsLint,
        tsHover,
        // Add photon JSDoc completions via language data (merges with basicSetup's autocompletion)
        EditorState.languageData.of(() => [
          { autocomplete: docblockCompletions },
          { autocomplete: photonFormatCompletions },
          { autocomplete: photonRuntimeCompletions },
          { autocomplete: tsCompletions },
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
            {
              key: 'F12',
              run: () => {
                void this._goToDefinition();
                return true;
              },
            },
            {
              key: 'Shift-F12',
              run: () => {
                void this._peekReferences();
                return true;
              },
            },
            {
              key: 'F2',
              run: () => {
                void this._renameSymbol();
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
              void this._save();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this._source = update.state.doc.toString();
            this._dirty = this._source !== this._originalSource;
            this._definitionPreview = null;
            this._referencesPreview = null;
            this._renamePreview = null;
            this._codeFixPreview = null;
            void this._syncTypeScriptProject().catch(() => {});
            const nextImportSignature = this._extractImportSignature(this._source);
            if (nextImportSignature !== this._importSignature) {
              this._importSignature = nextImportSignature;
              this._scheduleProjectContextRefresh();
            }
            void this._refreshTypeScriptDiagnostics();
            void this._refreshSignatureHelp(update.state.selection.main.head);
            void this._refreshOutline();
            this._scheduleParse();
          } else if (update.selectionSet) {
            this._syncActiveOutline(update.state.selection.main.head);
            void this._refreshSignatureHelp(update.state.selection.main.head);
          }
        }),
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            event.preventDefault();
            void this._goToDefinition(pos);
            return true;
          },
        }),
      ],
    });

    this._editorView = new EditorView({
      state,
      parent: container as HTMLElement,
    });
  }

  private _createHoverTooltip(hover: PhotonTsHover | null) {
    if (!hover || hover.from === hover.to) return null;
    return {
      pos: hover.from,
      end: hover.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-photon-hover';

        const kind = document.createElement('div');
        kind.className = 'cm-photon-hover-kind';
        kind.textContent = hover.kind;
        dom.appendChild(kind);

        if (hover.display) {
          const signature = document.createElement('div');
          signature.className = 'cm-photon-hover-signature';
          signature.textContent = hover.display;
          dom.appendChild(signature);
        }

        if (hover.documentation) {
          const doc = document.createElement('div');
          doc.className = 'cm-photon-hover-doc';
          doc.textContent = hover.documentation;
          dom.appendChild(doc);
        }

        if (hover.tags?.length) {
          const tags = document.createElement('div');
          tags.className = 'cm-photon-hover-tags';
          for (const tagEntry of hover.tags) {
            const row = document.createElement('div');
            row.textContent = tagEntry.text
              ? `@${tagEntry.name} ${tagEntry.text}`
              : `@${tagEntry.name}`;
            tags.appendChild(row);
          }
          dom.appendChild(tags);
        }

        return { dom };
      },
    };
  }

  private _focusEditorSpan(from: number, to: number) {
    if (!this._editorView) return;
    this._readOnlySourcePreview = null;
    this._editorView.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    this._editorView.focus();
  }

  private _normalizeEditorTokenSpan(from: number, to: number): { from: number; to: number } {
    const source = this._source;
    let nextFrom = Math.max(0, from);
    let nextTo = Math.max(nextFrom, to);

    while (nextFrom < source.length && !/[A-Za-z0-9_$'"]/.test(source[nextFrom] || '')) {
      nextFrom++;
    }
    while (nextTo > nextFrom && !/[A-Za-z0-9_$'"]/.test(source[nextTo - 1] || '')) {
      nextTo--;
    }
    while (nextFrom > 0 && /[A-Za-z0-9_$'"]/.test(source[nextFrom - 1] || '')) {
      nextFrom--;
    }
    while (nextTo < source.length && /[A-Za-z0-9_$'"]/.test(source[nextTo] || '')) {
      nextTo++;
    }

    return { from: nextFrom, to: Math.max(nextTo, nextFrom + 1) };
  }

  private async _goToDefinition(pos = this._editorView?.state.selection.main.head ?? 0) {
    if (!this._tsWorkerClient || !this._filePath || !this._editorView) return;

    const definition = await this._tsWorkerClient
      .definition(this._filePath, this._source, pos)
      .catch(() => null);

    if (!definition) {
      showToast('No definition found', 'warning');
      return;
    }

    if (definition.kind === 'source') {
      this._definitionPreview = null;
      this._readOnlySourcePreview = null;
      this._renamePreview = null;
      this._codeFixPreview = null;
      this._focusEditorSpan(definition.targetFrom, definition.targetTo);
      return;
    }

    if (definition.kind === 'project') {
      this._openReadOnlySourcePreview(
        definition.title,
        definition.filePath,
        this._lineNumberForPos(
          this._getProjectFileSource(definition.filePath) || '',
          definition.targetFrom
        )
      );
    }

    this._definitionPreview = definition;
    this._referencesPreview = null;
    this._renamePreview = null;
    this._codeFixPreview = null;
    showToast(`Opened ${definition.title} definition preview`, 'info');
  }

  private async _peekReferences(pos = this._editorView?.state.selection.main.head ?? 0) {
    if (!this._tsWorkerClient || !this._filePath) return;

    const references = await this._tsWorkerClient
      .references(this._filePath, this._source, pos)
      .catch(() => null);

    if (!references || references.items.length === 0) {
      this._referencesPreview = null;
      showToast('No references found', 'warning');
      return;
    }

    this._definitionPreview = null;
    this._readOnlySourcePreview = null;
    this._referencesPreview = references;
    this._renamePreview = null;
    this._codeFixPreview = null;
    showToast(
      `${references.items.length} reference${references.items.length === 1 ? '' : 's'} for ${references.symbolName}`,
      'info'
    );
  }

  private _openReference(item: PhotonTsReferences['items'][number]) {
    if (item.kind === 'source' && this._editorView) {
      this._readOnlySourcePreview = null;
      this._renamePreview = null;
      this._focusEditorSpan(item.from, item.to);
      return;
    }

    this._openReadOnlySourcePreview(
      `${this._referencesPreview?.symbolName || 'Reference'} reference`,
      item.filePath,
      item.line
    );
  }

  private _getProjectFileSource(filePath: string): string | null {
    return this._projectSupportFiles.find((file) => file.path === filePath)?.source || null;
  }

  private _lineNumberForPos(source: string, pos: number): number {
    if (!source) return 1;
    return source.slice(0, Math.max(0, pos)).split('\n').length;
  }

  private _openReadOnlySourcePreview(title: string, filePath: string, line: number) {
    const source = this._getProjectFileSource(filePath);
    if (!source) {
      this._definitionPreview = {
        kind: 'project',
        filePath,
        from: 0,
        to: 0,
        targetFrom: 0,
        targetTo: 0,
        title,
        preview: 'Source preview unavailable for this file.',
      };
      return;
    }

    this._definitionPreview = null;
    this._readOnlySourcePreview = {
      title,
      filePath,
      source,
      originalSource: source,
      line,
      canEdit: true,
      editing: false,
      dirty: false,
    };
  }

  private _enterSourcePreviewEdit() {
    if (!this._readOnlySourcePreview?.canEdit) return;
    this._readOnlySourcePreview = {
      ...this._readOnlySourcePreview,
      editing: true,
    };
  }

  private _cancelSourcePreviewEdit() {
    if (!this._readOnlySourcePreview) return;
    this._readOnlySourcePreview = {
      ...this._readOnlySourcePreview,
      source: this._readOnlySourcePreview.originalSource || this._readOnlySourcePreview.source,
      editing: false,
      dirty: false,
    };
  }

  private _updateSourcePreviewDraft(source: string) {
    if (!this._readOnlySourcePreview) return;
    this._readOnlySourcePreview = {
      ...this._readOnlySourcePreview,
      source,
      dirty: source !== (this._readOnlySourcePreview.originalSource || ''),
    };
  }

  private async _saveSourcePreviewEdit() {
    const preview = this._readOnlySourcePreview;
    if (!preview?.canEdit) return;

    try {
      const result = await mcpClient.callTool('beam/studio-apply-files', {
        name: this.photonName,
        source: this._source,
        files: [{ path: preview.filePath, source: preview.source }],
      });
      const text = result?.content?.[0]?.text;
      if (!text) throw new Error('Empty response');
      const parsed = JSON.parse(text);
      if (!parsed.success) throw new Error(parsed.error || 'Save failed');

      this._projectSupportFiles = parsed.supportFiles || [];
      await this._syncTypeScriptProject().catch(() => {});
      await this._refreshTypeScriptDiagnostics();
      await this._refreshSignatureHelp();
      await this._refreshOutline();
      this._readOnlySourcePreview = {
        ...preview,
        originalSource: preview.source,
        editing: false,
        dirty: false,
      };
      showToast(`Saved ${preview.filePath.split('/').pop() || 'support file'}`, 'success');
    } catch (error) {
      showToast(
        error instanceof Error
          ? `Support file save failed: ${error.message}`
          : 'Support file save failed',
        'error'
      );
    }
  }

  private _findFirstChangedLine(previousSource: string, nextSource: string): number {
    const previousLines = previousSource.split('\n');
    const nextLines = nextSource.split('\n');
    const max = Math.max(previousLines.length, nextLines.length);
    for (let index = 0; index < max; index++) {
      if ((previousLines[index] || '') !== (nextLines[index] || '')) {
        return index + 1;
      }
    }
    return 1;
  }

  private async _renameSymbol(pos = this._editorView?.state.selection.main.head ?? 0) {
    if (!this._tsWorkerClient || !this._filePath) return;

    const seedPlan = await this._tsWorkerClient
      .rename(this._filePath, this._source, pos, '__photon_rename_probe__')
      .catch(() => null);

    if (!seedPlan) {
      showToast('This symbol cannot be renamed', 'warning');
      return;
    }

    const currentName = seedPlan.symbolName.replace(/^\(alias\)\s*/, '').trim();
    const nextName = window.prompt('Rename symbol to:', currentName);
    if (!nextName || nextName === currentName) return;

    const renamePlan = await this._tsWorkerClient
      .rename(this._filePath, this._source, pos, nextName)
      .catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
        return null;
      });

    if (!renamePlan || renamePlan.files.length === 0) {
      showToast('No rename edits generated', 'warning');
      return;
    }

    this._definitionPreview = null;
    this._referencesPreview = null;
    this._readOnlySourcePreview = null;
    this._renamePreview = renamePlan;
  }

  private async _applyRenamePlan(renamePlan: PhotonTsRenamePlan) {
    const currentFile = renamePlan.files.find((file) => file.kind === 'source');
    const nextSource = currentFile?.source ?? this._source;

    try {
      const projectEditCount = renamePlan.files.filter((file) => file.kind === 'project').length;
      await this._applyFileEdits(
        renamePlan.files.map((file) => ({ filePath: file.filePath, source: file.source })),
        nextSource,
        `Renamed ${renamePlan.symbolName} to ${renamePlan.nextName}${projectEditCount > 0 ? ` across ${projectEditCount + 1} files` : ''}`
      );
    } catch (error) {
      showToast(
        error instanceof Error ? `Rename failed: ${error.message}` : 'Rename failed',
        'error'
      );
    }
  }

  private _previewRenameFile(file: PhotonTsRenamePlan['files'][number]) {
    const previousSource =
      file.kind === 'source' ? this._source : this._getProjectFileSource(file.filePath) || '';
    const firstChangedLine = this._findFirstChangedLine(previousSource, file.source);

    if (file.kind === 'source' && this._editorView) {
      this._readOnlySourcePreview = {
        title: `${this._renamePreview?.symbolName || 'Rename'} preview`,
        filePath: file.filePath,
        source: file.source,
        line: firstChangedLine,
      };
      return;
    }

    this._readOnlySourcePreview = {
      title: `${this._renamePreview?.symbolName || 'Rename'} preview`,
      filePath: file.filePath,
      source: file.source,
      line: firstChangedLine,
    };
  }

  private async _applyFileEdits(
    files: Array<{ filePath: string; source: string }>,
    nextSource: string,
    successMessage: string
  ) {
    const result = await mcpClient.callTool('beam/studio-apply-files', {
      name: this.photonName,
      source: nextSource,
      files: files.map((file) => ({
        path: file.filePath,
        source: file.source,
      })),
    });
    const text = result?.content?.[0]?.text;
    if (!text) throw new Error('Empty response');
    const parsed = JSON.parse(text);
    if (!parsed.success) throw new Error(parsed.error || 'Failed to apply editor changes');

    if (this._editorView) {
      this._editorView.dispatch({
        changes: {
          from: 0,
          to: this._editorView.state.doc.length,
          insert: nextSource,
        },
      });
    }

    this._source = nextSource;
    this._originalSource = nextSource;
    this._dirty = false;
    this._definitionPreview = null;
    this._referencesPreview = null;
    this._renamePreview = null;
    this._codeFixPreview = null;
    this._readOnlySourcePreview = null;
    this._projectSupportFiles = parsed.supportFiles || [];
    this._importSignature = this._extractImportSignature(this._source);
    await this._syncTypeScriptProject().catch(() => {});
    await this._refreshTypeScriptDiagnostics();
    await this._refreshSignatureHelp();
    await this._refreshOutline();
    showToast(successMessage, 'success');
    this.dispatchEvent(new CustomEvent('studio-saved', { bubbles: true, composed: true }));
  }

  private _previewCodeFixFile(fix: PhotonTsCodeFix) {
    const currentFile = fix.files.find((file) => file.kind === 'source') || fix.files[0];
    if (!currentFile) return;

    const previousSource =
      currentFile.kind === 'source'
        ? this._source
        : this._getProjectFileSource(currentFile.filePath) || '';
    const firstChangedLine = this._findFirstChangedLine(previousSource, currentFile.source);
    this._readOnlySourcePreview = {
      title: fix.description,
      filePath: currentFile.filePath,
      source: currentFile.source,
      line: firstChangedLine,
    };
  }

  private async _applyCodeFix(fix: PhotonTsCodeFix) {
    const currentFile = fix.files.find((file) => file.kind === 'source');
    if (!currentFile) {
      showToast('Quick fix is missing the current photon source', 'error');
      return;
    }

    try {
      await this._applyFileEdits(
        fix.files.map((file) => ({ filePath: file.filePath, source: file.source })),
        currentFile.source,
        `Applied quick fix: ${fix.description}`
      );
    } catch (error) {
      showToast(
        error instanceof Error ? `Quick fix failed: ${error.message}` : 'Quick fix failed',
        'error'
      );
    }
  }

  private _diagnosticSeverityClass(): 'ok' | 'warning' | 'error' {
    if (this._tsDiagnostics.some((diag) => diag.severity === 'error')) return 'error';
    if (this._tsDiagnostics.some((diag) => diag.severity === 'warning')) return 'warning';
    return 'ok';
  }

  private _visibleDiagnostics() {
    return this._tsDiagnostics.slice(0, 3);
  }

  private _openDiagnostic(diag: PhotonTsDiagnostic) {
    this._definitionPreview = null;
    this._referencesPreview = null;
    this._renamePreview = null;
    this._codeFixPreview = null;
    const span = this._normalizeEditorTokenSpan(diag.from, Math.max(diag.to, diag.from + 1));
    this._focusEditorSpan(span.from, span.to);
  }

  private async _loadCodeFixes(diag: PhotonTsDiagnostic) {
    if (!this._tsWorkerClient || !this._filePath || !diag.code) {
      showToast('No quick fixes available for this issue', 'warning');
      return;
    }

    try {
      const fixes = await this._tsWorkerClient.codeFixes(
        this._filePath,
        this._source,
        diag.from,
        diag.to,
        diag.code
      );

      if (!fixes.length) {
        showToast('TypeScript did not return a quick fix for this issue', 'warning');
        return;
      }

      this._definitionPreview = null;
      this._referencesPreview = null;
      this._renamePreview = null;
      this._codeFixPreview = { diagnostic: diag, fixes };
      this._previewCodeFixFile(fixes[0]);
      showToast(`${fixes.length} quick fix${fixes.length === 1 ? '' : 'es'} available`, 'info');
    } catch (error) {
      showToast(
        error instanceof Error
          ? `Quick fix lookup failed: ${error.message}`
          : 'Quick fix lookup failed',
        'error'
      );
    }
  }

  private _scheduleParse() {
    if (this._parseDebounceTimer) {
      clearTimeout(this._parseDebounceTimer);
    }
    this._parseDebounceTimer = setTimeout(() => {
      this._parseDebounceTimer = null;
      void this._parse();
    }, PhotonStudio.PARSE_DEBOUNCE_MS);
  }

  private _extractImportSignature(source: string): string {
    return source
      .split('\n')
      .filter((line) => /^\s*(import|export)\b/.test(line))
      .join('\n');
  }

  private _scheduleProjectContextRefresh() {
    if (this._projectRefreshTimer) {
      clearTimeout(this._projectRefreshTimer);
    }
    this._projectRefreshTimer = setTimeout(() => {
      this._projectRefreshTimer = null;
      void this._refreshProjectContext();
    }, 500);
  }

  private async _syncTypeScriptProject() {
    if (!this._tsWorkerClient || !this._filePath) return;
    await this._tsWorkerClient.sync(this._filePath, this._source, this._projectSupportFiles);
  }

  private async _refreshProjectContext() {
    if (!this.photonName) return;
    try {
      const result = await mcpClient.callTool('beam/studio-project', {
        name: this.photonName,
        source: this._source,
      });
      const text = result?.content?.[0]?.text;
      if (!text) return;
      const parsed = JSON.parse(text);
      this._projectSupportFiles = parsed.supportFiles || [];
      await this._syncTypeScriptProject();
    } catch {
      // Keep last-known project context if support-file resolution fails.
    }
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
          this._projectSupportFiles = parsed.supportFiles || [];
          this._importSignature = this._extractImportSignature(this._source);
          if (parsed.parseResult) {
            this._parseResult = parsed.parseResult;
          }
          void this._syncTypeScriptProject().catch(() => {});
          void this._refreshTypeScriptDiagnostics();
          void this._refreshSignatureHelp();
          void this._refreshOutline();
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
    this._importSignature = this._extractImportSignature(this._source);
    void this._refreshProjectContext().catch(() => {});
    void this._refreshTypeScriptDiagnostics();
    void this._refreshSignatureHelp();
    void this._refreshOutline();

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

  private async _refreshTypeScriptDiagnostics() {
    const token = ++this._diagnosticRequestToken;
    if (!this._tsWorkerClient || !this._filePath) {
      this._tsDiagnostics = [];
      return;
    }

    try {
      const diagnostics = await this._tsWorkerClient.diagnostics(this._filePath, this._source);
      if (token === this._diagnosticRequestToken) {
        this._tsDiagnostics = diagnostics;
      }
    } catch {
      if (token === this._diagnosticRequestToken) {
        this._tsDiagnostics = [];
      }
    }
  }

  private async _refreshSignatureHelp(pos = this._editorView?.state.selection.main.head ?? 0) {
    const token = ++this._signatureHelpToken;
    if (!this._tsWorkerClient || !this._filePath) {
      this._signatureHelp = null;
      return;
    }

    try {
      const signatureHelp = await this._tsWorkerClient.signatureHelp(
        this._filePath,
        this._source,
        pos
      );
      if (token === this._signatureHelpToken) {
        this._signatureHelp = signatureHelp;
      }
    } catch {
      if (token === this._signatureHelpToken) {
        this._signatureHelp = null;
      }
    }
  }

  private async _refreshOutline() {
    const token = ++this._outlineToken;
    if (!this._tsWorkerClient || !this._filePath) {
      this._outlineItems = [];
      return;
    }

    try {
      const outline = await this._tsWorkerClient.outline(this._filePath, this._source);
      if (token === this._outlineToken) {
        this._outlineItems = outline;
        this._syncActiveOutline();
      }
    } catch {
      if (token === this._outlineToken) {
        this._outlineItems = [];
        this._activeOutlineKey = '';
      }
    }
  }

  private _renderSignatureHelp() {
    const activeItem =
      this._signatureHelp?.items[this._signatureHelp.activeItem] || this._signatureHelp?.items[0];
    if (!activeItem) return null;

    const activeParameter = activeItem.parameters[this._signatureHelp?.activeParameter ?? 0];

    return html`
      <div class="signature-help-bar">
        <div class="signature-call">
          ${activeItem.prefix}${activeItem.parameters.map((parameter, index) => {
            const isActive = index === (this._signatureHelp?.activeParameter ?? 0);
            return html`${index > 0 ? activeItem.separator : ''}<span
                class="signature-parameter ${isActive ? 'active' : ''}"
                >${parameter.text}</span
              >`;
          })}${activeItem.suffix}
        </div>
        ${activeParameter?.documentation || activeItem.documentation
          ? html`
              <div class="signature-doc">
                ${activeParameter?.documentation || activeItem.documentation}
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _renderOutline() {
    if (!this._showOutline || this._outlineItems.length === 0) return null;

    return html`
      <div class="outline-panel">
        <div class="outline-header">Outline</div>
        <div class="outline-list">
          ${this._outlineItems.map(
            (item) => html`
              <div
                class="outline-item ${this._outlineKey(item) === this._activeOutlineKey
                  ? 'active'
                  : ''}"
                style="padding-left: ${8 + item.level * 16}px"
                @click=${() => {
                  this._focusEditorSpan(item.from, Math.max(item.to, item.from + 1));
                }}
              >
                <span class="outline-kind">${item.kind}</span>
                <span>${item.text}</span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  private _outlineKey(item: PhotonTsOutlineItem) {
    return `${item.kind}:${item.text}:${item.from}:${item.to}`;
  }

  private _syncActiveOutline(pos = this._editorView?.state.selection.main.head ?? 0) {
    const matchingItem = this._outlineItems
      .filter((item) => pos >= item.from && pos <= Math.max(item.to, item.from + 1))
      .sort((left, right) => right.level - left.level)[0];
    this._activeOutlineKey = matchingItem ? this._outlineKey(matchingItem) : '';
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
          <button class="close-btn" @click=${() => this._close()}>&times;</button>
        </div>
        <div class="loading-state">Loading source...</div>
      `;
    }

    if (this._error) {
      return html`
        <div class="toolbar">
          <span class="toolbar-title">Studio</span>
          <button class="close-btn" @click=${() => this._close()}>&times;</button>
        </div>
        <div class="error-state">
          <span>${this._error}</span>
          <button
            class="toolbar-btn"
            @click=${() => {
              void this._loadSource();
            }}
          >
            Retry
          </button>
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

        <button class="toolbar-btn" @click=${() => (this._showOutline = !this._showOutline)}>
          ${this._showOutline ? 'Hide Outline' : 'Outline'}
        </button>

        <button
          class="toolbar-btn"
          @click=${() => {
            void this._goToDefinition();
          }}
          title="Go to definition (F12 or Cmd/Ctrl+Click)"
        >
          Definition
        </button>

        <button
          class="toolbar-btn"
          @click=${() => {
            void this._peekReferences();
          }}
          title="Peek references (Shift+F12)"
        >
          References
        </button>

        <button
          class="toolbar-btn"
          @click=${() => {
            void this._renameSymbol();
          }}
          title="Rename symbol (F2)"
        >
          Rename
        </button>

        <button
          class="toolbar-btn primary"
          @click=${() => {
            void this._save();
          }}
          ?disabled=${!this._dirty || this._saving}
          title="Save (Cmd+S)"
        >
          ${this._saving ? 'Saving...' : 'Save'}
        </button>

        <button class="close-btn" @click=${() => this._close()} title="Close Studio">
          &times;
        </button>
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
        <span class="status-pill ${this._diagnosticSeverityClass()}">
          TS
          ${this._tsDiagnostics.length === 0
            ? 'clean'
            : `${this._tsDiagnostics.length} issue${this._tsDiagnostics.length === 1 ? '' : 's'}`}
        </span>
        <span class="status-pill">Hover types on</span>
        ${this._activeOutlineKey
          ? html`<span class="status-pill">
              Symbol
              ${this._outlineItems.find((item) => this._outlineKey(item) === this._activeOutlineKey)
                ?.text || ''}
            </span>`
          : ''}
        <span class="status-pill">F12 / Cmd+Click</span>
        <span class="status-pill">Shift+F12 refs</span>
        <span class="status-pill">F2 rename</span>
        <span><span class="kbd">Cmd+S</span> Save</span>
      </div>

      ${this._signatureHelp ? this._renderSignatureHelp() : ''} ${this._renderOutline()}
      ${this._renamePreview
        ? html`
            <div class="rename-panel">
              <div class="definition-header">
                <div>
                  <div class="definition-title">Rename Preview</div>
                  <div class="rename-summary">
                    ${this._renamePreview.symbolName} → ${this._renamePreview.nextName}
                  </div>
                  <div class="references-count">
                    ${this._renamePreview.files.length}
                    file${this._renamePreview.files.length === 1 ? '' : 's'} affected
                  </div>
                </div>
                <div class="rename-actions">
                  <button
                    class="toolbar-btn primary"
                    @click=${() => {
                      void this._applyRenamePlan(this._renamePreview!);
                    }}
                  >
                    Apply Rename
                  </button>
                  <button
                    class="toolbar-btn"
                    @click=${() => {
                      this._renamePreview = null;
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div class="rename-file-list">
                ${this._renamePreview.files.map(
                  (file) => html`
                    <div
                      class="rename-file-item"
                      @click=${() => {
                        this._previewRenameFile(file);
                      }}
                    >
                      <div class="rename-file-meta">
                        <span>${file.filePath}</span>
                        <span>${file.changeCount} change${file.changeCount === 1 ? '' : 's'}</span>
                      </div>
                      <div class="reference-preview">
                        ${file.source.split('\n').slice(0, 4).join('\n')}
                      </div>
                    </div>
                  `
                )}
              </div>
            </div>
          `
        : ''}
      ${this._codeFixPreview
        ? html`
            <div class="code-fix-panel">
              <div class="definition-header">
                <div>
                  <div class="definition-title">Quick Fixes</div>
                  <div class="rename-summary">${this._codeFixPreview.diagnostic.message}</div>
                  <div class="references-count">
                    ${this._codeFixPreview.fixes.length}
                    fix${this._codeFixPreview.fixes.length === 1 ? '' : 'es'} available
                  </div>
                </div>
                <button
                  class="toolbar-btn"
                  @click=${() => {
                    this._codeFixPreview = null;
                  }}
                >
                  Close
                </button>
              </div>
              <div class="rename-file-list">
                ${this._codeFixPreview.fixes.map((fix) => {
                  const totalChanges = fix.files.reduce(
                    (count, file) => count + file.changeCount,
                    0
                  );
                  return html`
                    <div
                      class="rename-file-item"
                      @click=${() => {
                        this._previewCodeFixFile(fix);
                      }}
                    >
                      <div class="rename-file-meta">
                        <span>${fix.description}</span>
                        <span>${totalChanges} edit${totalChanges === 1 ? '' : 's'}</span>
                      </div>
                      <div class="reference-preview">
                        ${fix.files.map((file) => file.filePath.split('/').pop()).join(', ')}
                      </div>
                      <div class="problem-actions">
                        <button
                          class="problem-action-btn"
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            this._previewCodeFixFile(fix);
                          }}
                        >
                          Preview
                        </button>
                        <button
                          class="problem-action-btn"
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            void this._applyCodeFix(fix);
                          }}
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  `;
                })}
              </div>
            </div>
          `
        : ''}
      ${this._readOnlySourcePreview
        ? html`
            <div class="read-source-panel">
              <div class="definition-header">
                <div>
                  <div class="definition-title">${this._readOnlySourcePreview.title}</div>
                  <div class="definition-path">${this._readOnlySourcePreview.filePath}</div>
                </div>
                <div class="read-source-actions">
                  ${this._readOnlySourcePreview.canEdit && !this._readOnlySourcePreview.editing
                    ? html`
                        <button class="toolbar-btn" @click=${() => this._enterSourcePreviewEdit()}>
                          Edit
                        </button>
                      `
                    : ''}
                  ${this._readOnlySourcePreview.editing
                    ? html`
                        <button
                          class="toolbar-btn primary"
                          ?disabled=${!this._readOnlySourcePreview.dirty}
                          @click=${() => {
                            void this._saveSourcePreviewEdit();
                          }}
                        >
                          Save
                        </button>
                        <button
                          class="toolbar-btn"
                          @click=${() => {
                            this._cancelSourcePreviewEdit();
                          }}
                        >
                          Cancel
                        </button>
                      `
                    : ''}
                  <button
                    class="toolbar-btn"
                    @click=${() => {
                      this._readOnlySourcePreview = null;
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
              ${this._readOnlySourcePreview.editing
                ? html`
                    <textarea
                      class="read-source-editor"
                      .value=${this._readOnlySourcePreview.source}
                      @input=${(event: Event) => {
                        this._updateSourcePreviewDraft((event.target as HTMLTextAreaElement).value);
                      }}
                    ></textarea>
                  `
                : html`
                    <div class="read-source-scroll">
                      <pre class="read-source-code">
${this._readOnlySourcePreview.source.split('\n').map(
                          (line, index) => html`
                            <div
                              class="read-source-line ${index + 1 ===
                              this._readOnlySourcePreview!.line
                                ? 'active'
                                : ''}"
                            >
                              <span class="read-source-line-number">${index + 1}</span>
                              <span class="read-source-line-text">${line || ' '}</span>
                            </div>
                          `
                        )}</pre
                      >
                    </div>
                  `}
            </div>
          `
        : ''}
      ${this._definitionPreview
        ? html`
            <div class="definition-panel">
              <div class="definition-header">
                <div>
                  <div class="definition-title">${this._definitionPreview.title}</div>
                  <div class="definition-path">${this._definitionPreview.filePath}</div>
                </div>
                <button
                  class="toolbar-btn"
                  @click=${() => {
                    this._definitionPreview = null;
                  }}
                >
                  Close
                </button>
              </div>
              ${this._definitionPreview.preview
                ? html`<pre class="definition-preview">${this._definitionPreview.preview}</pre>`
                : html`<div class="definition-path">
                    Preview is only available for virtual Photon runtime definitions right now.
                  </div>`}
            </div>
          `
        : ''}
      ${this._referencesPreview
        ? html`
            <div class="references-panel">
              <div class="definition-header">
                <div>
                  <div class="definition-title">
                    References for ${this._referencesPreview.symbolName}
                  </div>
                  <div class="references-count">
                    ${this._referencesPreview.items.length}
                    result${this._referencesPreview.items.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  class="toolbar-btn"
                  @click=${() => {
                    this._referencesPreview = null;
                  }}
                >
                  Close
                </button>
              </div>
              <div class="reference-list">
                ${this._referencesPreview.items.map(
                  (item) => html`
                    <div
                      class="reference-item"
                      @click=${() => {
                        this._openReference(item);
                      }}
                    >
                      <div class="reference-meta">
                        <span>${item.filePath}</span>
                        <span>Ln ${item.line}, Col ${item.column}</span>
                      </div>
                      <div class="reference-preview">${item.preview}</div>
                    </div>
                  `
                )}
              </div>
            </div>
          `
        : ''}
      ${this._tsDiagnostics.length > 0
        ? html`
            <div class="problems-panel">
              ${this._visibleDiagnostics().map(
                (diag) => html`
                  <div
                    class="problem-item"
                    @click=${() => {
                      this._openDiagnostic(diag);
                    }}
                  >
                    <span class="problem-badge ${diag.severity}">${diag.severity}</span>
                    <div class="problem-text">
                      ${diag.message}
                      ${diag.code ? html`<span class="problem-code">ts(${diag.code})</span>` : ''}
                      ${diag.code
                        ? html`
                            <div class="problem-actions">
                              <button
                                class="problem-action-btn"
                                @click=${(event: Event) => {
                                  event.stopPropagation();
                                  void this._loadCodeFixes(diag);
                                }}
                              >
                                Quick Fixes
                              </button>
                            </div>
                          `
                        : ''}
                    </div>
                  </div>
                `
              )}
              ${this._tsDiagnostics.length > 3
                ? html`
                    <div class="problem-more">
                      +${this._tsDiagnostics.length - 3} more
                      issue${this._tsDiagnostics.length - 3 === 1 ? '' : 's'}
                    </div>
                  `
                : ''}
            </div>
          `
        : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'photon-studio': PhotonStudio;
  }
}
