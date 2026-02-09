/**
 * Studio preview panel showing parsed photon metadata.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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

  static styles = [
    theme,
    badges,
    css`
      :host {
        display: block;
        font-family: var(--font-mono, 'SF Mono', monospace);
        font-size: 0.82rem;
        color: var(--t-primary, #e0e0e0);
      }

      .preview-section {
        margin-bottom: 16px;
      }

      .section-title {
        font-size: 0.7rem;
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
        font-size: 0.8rem;
      }

      .meta-label {
        color: var(--t-muted, #888);
        min-width: 70px;
      }

      .meta-value {
        color: var(--t-primary, #e0e0e0);
      }

      .photon-name {
        font-size: 1rem;
        font-weight: 600;
        margin-bottom: 4px;
      }

      .photon-desc {
        color: var(--t-muted, #888);
        font-size: 0.8rem;
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
        font-size: 0.9rem;
      }

      .method-name {
        color: var(--accent-primary);
      }

      .method-desc {
        color: var(--t-muted, #888);
        font-size: 0.75rem;
        margin-top: 3px;
      }

      .method-params {
        margin-top: 6px;
        padding-left: 12px;
        font-size: 0.75rem;
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
        font-size: 0.65rem;
      }

      .dep-tag {
        display: inline-block;
        padding: 1px 6px;
        background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
        border-radius: var(--radius-xs);
        font-size: 0.72rem;
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
        font-size: 0.78rem;
        padding: 2px 0;
      }

      .error-item::before {
        content: '✕ ';
      }

      .warning-item {
        color: var(--color-warning);
        font-size: 0.78rem;
        padding: 2px 0;
      }

      .warning-item::before {
        content: '⚠ ';
      }

      .empty-state {
        color: var(--t-muted, #888);
        font-style: italic;
        text-align: center;
        padding: 24px 0;
        font-size: 0.82rem;
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
      return html`<div class="empty-state">Press Parse or save to see schema preview</div>`;
    }

    const r = this.parseResult;

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
      ${r.warnings?.length
        ? html`
            <div class="preview-section">
              <div class="section-title">Warnings</div>
              <ul class="warning-list">
                ${r.warnings.map((w) => html`<li class="warning-item">${w}</li>`)}
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
        ${params.length > 0
          ? html`
              <div class="method-params">
                ${params.map(
                  ([name, schema]) => html`
                    <div class="param-item">
                      <span class="param-name">${name}</span>
                      <span class="param-type">${(schema as any).type || 'any'}</span>
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
}

declare global {
  interface HTMLElementTagNameMap {
    'studio-preview': StudioPreview;
  }
}
