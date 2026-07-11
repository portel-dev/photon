/**
 * Studio Inspector panel showing parsed photon metadata.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, badges } from '../styles/index.js';

export interface ParseResult {
  className?: string;
  description?: string;
  icon?: string;
  version?: string;
  runtime?: string;
  tags?: string[];
  stateful?: boolean;
  dependencies?: string[];
  methods: ParsedMethod[];
  errors?: string[];
  warnings?: string[];
}

interface ParsedMethod {
  name: string;
  description?: string;
  icon?: string;
  params?: Record<string, any>;
  autorun?: boolean;
  outputFormat?: string;
  buttonLabel?: string;
  webhook?: string;
  scheduled?: string;
  locked?: string;
}

@customElement('studio-preview')
export class StudioPreview extends LitElement {
  @property({ type: Object }) parseResult: ParseResult | null = null;
  @property({ type: Boolean }) loading = false;
  @state() private _activeTab: 'details' | 'comments' | 'json' | 'guidance' = 'details';
  @state() private _commentDraft = '';
  @state() private _copyLabel = 'Copy';

  private static readonly COMMENTS_KEY_PREFIX = 'photon-studio-comments:';

  static styles = [
    theme,
    badges,
    css`
      :host {
        display: block;
        font-family: var(--font-mono, 'SF Mono', monospace);
        font-size: var(--text-sm);
        color: var(--t-primary, #e0e0e0);
      }

      .preview-section {
        margin-bottom: 16px;
      }

      .tabs {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 4px;
        padding: 4px;
        margin-bottom: 12px;
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
        border-radius: var(--radius-sm);
      }

      .tab-btn {
        min-height: 30px;
        padding: 5px 4px;
        border: 0;
        border-radius: calc(var(--radius-sm) - 2px);
        background: transparent;
        color: var(--t-muted, #888);
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tab-btn:hover {
        color: var(--t-primary, #e0e0e0);
        background: rgba(255, 255, 255, 0.04);
      }

      .tab-btn.active {
        color: var(--t-primary, #e0e0e0);
        background: var(--accent-primary, #7c3aed);
      }

      .section-title {
        font-size: var(--text-xs);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--t-muted, #888);
        margin-bottom: 6px;
        font-weight: 600;
      }

      .meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        font-size: var(--text-sm);
      }

      .meta-label {
        color: var(--t-muted, #888);
        min-width: 70px;
      }

      .meta-value {
        color: var(--t-primary, #e0e0e0);
      }

      .photon-name {
        font-size: var(--text-lg);
        font-weight: 600;
        margin-bottom: 4px;
      }

      .photon-desc {
        color: var(--t-muted, #888);
        font-size: var(--text-sm);
        margin-bottom: 12px;
      }

      .method-item {
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        border-radius: var(--radius-sm);
        padding: 8px 10px;
        margin-bottom: 6px;
        border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
      }

      .method-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 500;
      }

      .method-icon {
        font-size: var(--text-md);
      }

      .method-name {
        color: var(--accent-primary);
      }

      .method-desc {
        color: var(--t-muted, #888);
        font-size: var(--text-xs);
        margin-top: 3px;
      }

      .method-params {
        margin-top: 6px;
        padding-left: 12px;
        font-size: var(--text-xs);
      }

      .method-meta {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 7px;
      }

      .param-item {
        display: flex;
        gap: 6px;
        padding: 1px 0;
      }

      .param-name {
        color: var(--accent-secondary, #f0abfc);
      }

      .param-type {
        color: var(--t-muted, #888);
      }

      .param-required {
        color: var(--color-error);
        font-size: var(--text-2xs);
      }

      .dep-tag {
        display: inline-block;
        padding: 1px 6px;
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        border-radius: var(--radius-xs);
        font-size: var(--text-xs);
        margin: 2px 2px 2px 0;
        color: var(--t-muted, #888);
      }

      .error-list,
      .warning-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .error-item {
        color: var(--color-error);
        font-size: var(--text-sm);
        padding: 2px 0;
      }

      .error-item::before {
        content: '✕ ';
      }

      .warning-item {
        color: var(--color-warning);
        font-size: var(--text-sm);
        padding: 2px 0;
      }

      .warning-item::before {
        content: '⚠ ';
      }

      .comment-list {
        display: grid;
        gap: 8px;
        margin-bottom: 10px;
      }

      .comment-item {
        padding: 8px 10px;
        border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
        border-radius: var(--radius-sm);
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
      }

      .comment-meta {
        color: var(--t-muted, #888);
        font-size: var(--text-2xs);
        margin-bottom: 4px;
      }

      .comment-text {
        white-space: pre-wrap;
        line-height: 1.45;
      }

      .comment-box {
        display: grid;
        gap: 8px;
      }

      textarea {
        width: 100%;
        min-height: 78px;
        resize: vertical;
        padding: 8px 10px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        color: var(--t-primary, #e0e0e0);
        font: inherit;
        line-height: 1.45;
      }

      textarea:focus {
        outline: 1px solid var(--accent-primary, #7c3aed);
        border-color: var(--accent-primary, #7c3aed);
      }

      .add-comment-btn,
      .copy-json-btn {
        min-height: 30px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
        color: var(--t-primary, #e0e0e0);
        cursor: pointer;
        font: inherit;
        font-size: var(--text-xs);
        font-weight: 700;
      }

      .add-comment-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .code-panel {
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: rgba(0, 0, 0, 0.22);
      }

      .code-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 8px;
        border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.04);
        color: var(--t-muted, #888);
        font-size: var(--text-xs);
      }

      pre.json-code {
        margin: 0;
        padding: 10px 12px;
        overflow: auto;
        max-height: 520px;
        line-height: 1.55;
        font-size: var(--text-xs);
        white-space: pre;
      }

      .json-key {
        color: #79c0ff;
      }

      .json-string {
        color: #a5d6ff;
      }

      .json-number {
        color: #f2cc60;
      }

      .json-boolean,
      .json-null {
        color: #ffab70;
      }

      .guidance-card,
      .warning-card {
        padding: 9px 10px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        margin-bottom: 8px;
        line-height: 1.45;
      }

      .warning-card {
        border-color: rgba(242, 204, 96, 0.35);
        background: rgba(242, 204, 96, 0.08);
      }

      .guidance-title {
        color: var(--t-primary, #e0e0e0);
        font-weight: 700;
        margin-bottom: 4px;
      }

      .guidance-body {
        color: var(--t-muted, #888);
      }

      .empty-state {
        color: var(--t-muted, #888);
        font-style: italic;
        text-align: center;
        padding: 24px 0;
        font-size: var(--text-sm);
      }

      .loading {
        text-align: center;
        color: var(--t-muted, #888);
        padding: 24px 0;
      }

      .loading::after {
        content: '';
        animation: dots 1.2s steps(3, end) infinite;
      }

      @keyframes dots {
        0% {
          content: '';
        }
        33% {
          content: '.';
        }
        66% {
          content: '..';
        }
        100% {
          content: '...';
        }
      }
    `,
  ];

  render() {
    if (this.loading) {
      return html`<div class="loading">Parsing</div>`;
    }

    if (!this.parseResult) {
      return html`<div class="empty-state">Edit the source to see inspector results</div>`;
    }

    const r = this.parseResult;

    return html`
      <div class="tabs" role="tablist" aria-label="Inspector sections">
        ${this._renderTab('details', 'Details')} ${this._renderTab('comments', 'Comments')}
        ${this._renderTab('json', 'JSON')} ${this._renderTab('guidance', 'Guidance')}
      </div>

      ${this._activeTab === 'details'
        ? this._renderDetails(r)
        : this._activeTab === 'comments'
          ? this._renderComments(r)
          : this._activeTab === 'json'
            ? this._renderJson(r)
            : this._renderGuidance(r)}
    `;
  }

  private _renderTab(tab: 'details' | 'comments' | 'json' | 'guidance', label: string) {
    return html`
      <button
        class="tab-btn ${this._activeTab === tab ? 'active' : ''}"
        role="tab"
        aria-selected=${this._activeTab === tab ? 'true' : 'false'}
        @click=${() => (this._activeTab = tab)}
      >
        ${label}
      </button>
    `;
  }

  private _renderDetails(r: ParseResult) {
    return html`
      ${r.errors?.length
        ? html`
            <div class="preview-section">
              <div class="section-title">Errors</div>
              <ul class="error-list">
                ${r.errors.map((e) => html`<li class="error-item">${e}</li>`)}
              </ul>
            </div>
          `
        : ''}

      <div class="preview-section">
        <div class="photon-name">${r.icon || ''} ${r.className || 'Unknown'}</div>
        ${r.description ? html`<div class="photon-desc">${r.description}</div>` : ''}
        ${r.version
          ? html`<div class="meta-row">
              <span class="meta-label">Version</span><span class="meta-value">${r.version}</span>
            </div>`
          : ''}
        ${r.runtime
          ? html`<div class="meta-row">
              <span class="meta-label">Runtime</span><span class="meta-value">${r.runtime}</span>
            </div>`
          : ''}
        ${r.stateful
          ? html`<div class="meta-row"><span class="type-badge stateful">stateful</span></div>`
          : ''}
      </div>

      ${r.dependencies?.length
        ? html`
            <div class="preview-section">
              <div class="section-title">Dependencies</div>
              <div>${r.dependencies.map((d) => html`<span class="dep-tag">${d}</span>`)}</div>
            </div>
          `
        : ''}
      ${r.tags?.length
        ? html`
            <div class="preview-section">
              <div class="section-title">Tags</div>
              <div>${r.tags.map((t) => html`<span class="dep-tag">${t}</span>`)}</div>
            </div>
          `
        : ''}

      <div class="preview-section">
        <div class="section-title">Methods (${r.methods.length})</div>
        ${r.methods.length === 0
          ? html`<div class="empty-state" style="padding:8px 0;">No methods found</div>`
          : r.methods.map((m) => this._renderMethod(m))}
      </div>
    `;
  }

  private _renderComments(r: ParseResult) {
    const comments = this._readComments(r);
    return html`
      <div class="preview-section">
        <div class="section-title">Comments</div>
        ${comments.length
          ? html`
              <div class="comment-list">
                ${comments.map(
                  (comment) => html`
                    <div class="comment-item">
                      <div class="comment-meta">
                        ${new Date(comment.createdAt).toLocaleString()}
                      </div>
                      <div class="comment-text">${comment.text}</div>
                    </div>
                  `
                )}
              </div>
            `
          : html`<div class="empty-state" style="padding:8px 0 14px;">No comments yet</div>`}

        <div class="comment-box">
          <textarea
            placeholder="Add a comment..."
            .value=${this._commentDraft}
            @input=${(event: Event) =>
              (this._commentDraft = (event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          <button
            class="add-comment-btn"
            ?disabled=${!this._commentDraft.trim()}
            @click=${() => this._addComment(r)}
          >
            Add Comment
          </button>
        </div>
      </div>
    `;
  }

  private _renderJson(r: ParseResult) {
    const json = JSON.stringify(r, null, 2);
    return html`
      <div class="code-panel">
        <div class="code-header">
          <span>JSON</span>
          <button class="copy-json-btn" @click=${() => this._copyJson(json)}>
            ${this._copyLabel}
          </button>
        </div>
        <pre class="json-code"><code>${this._highlightJson(json)}</code></pre>
      </div>
    `;
  }

  private _renderGuidance(r: ParseResult) {
    const warnings = this._buildWarnings(r);
    return html`
      <div class="preview-section">
        <div class="section-title">Element Help</div>
        <div class="guidance-card">
          <div class="guidance-title">Photon class</div>
          <div class="guidance-body">
            Use the class to describe one coherent tool surface. Class-level tags such as
            <code>@ui</code>, <code>@icon</code>, <code>@version</code>, and dependencies apply to
            the whole Photon.
          </div>
        </div>
        <div class="guidance-card">
          <div class="guidance-title">Methods</div>
          <div class="guidance-body">
            Public methods become callable tools. Keep each method focused, type parameters clearly,
            and declare formats or UI bindings only when the output needs a specific presentation.
          </div>
        </div>
        <div class="guidance-card">
          <div class="guidance-title">Parameters</div>
          <div class="guidance-body">
            Parameters should be simple enough for agents to fill automatically. Use JSDoc examples,
            choices, min/max, and descriptions when the right value is not obvious.
          </div>
        </div>
      </div>

      <div class="preview-section">
        <div class="section-title">Warnings</div>
        ${warnings.length
          ? warnings.map(
              (warning) => html`
                <div class="warning-card">
                  <div class="guidance-title">${warning.title}</div>
                  <div class="guidance-body">${warning.body}</div>
                </div>
              `
            )
          : html`<div class="guidance-card">
              <div class="guidance-title">No guidance warnings</div>
              <div class="guidance-body">The current Photon metadata looks consistent.</div>
            </div>`}
      </div>
    `;
  }

  private _renderMethod(m: ParsedMethod) {
    const params = m.params?.properties
      ? Object.entries(m.params.properties as Record<string, any>)
      : [];
    const required = m.params?.required || [];

    return html`
      <div class="method-item">
        <div class="method-header">
          ${m.icon ? html`<span class="method-icon">${m.icon}</span>` : ''}
          <span class="method-name">${m.name}</span>
          ${m.autorun ? html`<span class="type-badge autorun">autorun</span>` : ''}
          ${m.webhook ? html`<span class="type-badge webhook">webhook: ${m.webhook}</span>` : ''}
          ${m.scheduled ? html`<span class="type-badge cron">cron: ${m.scheduled}</span>` : ''}
          ${m.locked ? html`<span class="type-badge locked">locked</span>` : ''}
        </div>
        ${m.description ? html`<div class="method-desc">${m.description}</div>` : ''}
        ${m.outputFormat || m.buttonLabel
          ? html`<div class="method-meta">
              ${m.outputFormat ? html`<span class="dep-tag">format: ${m.outputFormat}</span>` : ''}
              ${m.buttonLabel ? html`<span class="dep-tag">button: ${m.buttonLabel}</span>` : ''}
            </div>`
          : ''}
        ${params.length > 0
          ? html`
              <div class="method-params">
                ${params.map(
                  ([name, schema]) => html`
                    <div class="param-item">
                      <span class="param-name">${name}</span>
                      <span class="param-type">${schema.type || 'any'}</span>
                      ${required.includes(name)
                        ? html`<span class="param-required">required</span>`
                        : ''}
                    </div>
                  `
                )}
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _commentsKey(r: ParseResult) {
    return `${StudioPreview.COMMENTS_KEY_PREFIX}${r.className || 'unknown'}`;
  }

  private _readComments(r: ParseResult): Array<{ text: string; createdAt: string }> {
    try {
      const raw = localStorage.getItem(this._commentsKey(r));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private _writeComments(r: ParseResult, comments: Array<{ text: string; createdAt: string }>) {
    localStorage.setItem(this._commentsKey(r), JSON.stringify(comments));
  }

  private _addComment(r: ParseResult) {
    const text = this._commentDraft.trim();
    if (!text) return;
    this._writeComments(r, [
      ...this._readComments(r),
      { text, createdAt: new Date().toISOString() },
    ]);
    this._commentDraft = '';
    this.requestUpdate();
  }

  private async _copyJson(json: string) {
    await navigator.clipboard.writeText(json);
    this._copyLabel = 'Copied';
    window.setTimeout(() => (this._copyLabel = 'Copy'), 1200);
  }

  private _highlightJson(json: string) {
    const parts = json.split(
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
    );

    return parts.map((part, index) => {
      if (!part) return '';
      if (/^"/.test(part)) {
        const isKey = /^\s*:/.test(parts[index + 1] || '');
        return html`<span class=${isKey ? 'json-key' : 'json-string'}>${part}</span>`;
      }
      if (/^-?\d/.test(part)) return html`<span class="json-number">${part}</span>`;
      if (part === 'true' || part === 'false')
        return html`<span class="json-boolean">${part}</span>`;
      if (part === 'null') return html`<span class="json-null">${part}</span>`;
      return part;
    });
  }

  private _buildWarnings(r: ParseResult): Array<{ title: string; body: string }> {
    const warnings = (r.warnings || []).map((warning) => ({
      title: 'Parser warning',
      body: warning,
    }));

    if (!r.description) {
      warnings.push({
        title: 'Missing class description',
        body: 'Add a short class JSDoc description so users and agents understand what this Photon is for.',
      });
    }

    for (const method of r.methods || []) {
      if (!method.description) {
        warnings.push({
          title: `${method.name} needs a description`,
          body: 'Method descriptions become tool descriptions. Without one, agents have less context for when to call it.',
        });
      }
      const params = method.params?.properties
        ? Object.entries(method.params.properties as Record<string, any>)
        : [];
      for (const [name, schema] of params) {
        if (!schema.description) {
          warnings.push({
            title: `${method.name}.${name} needs guidance`,
            body: 'Add a parameter description or example when the expected value is not self-evident.',
          });
        }
      }
    }

    return warnings;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'studio-preview': StudioPreview;
  }
}
