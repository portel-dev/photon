import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, badges } from '../styles/index.js';
import { showToast } from './toast-manager.js';
import { pencil, formInput, play } from '../icons.js';

interface MethodInfo {
  name: string;
  description: string;
  params: { type?: string; properties?: Record<string, any>; required?: string[] };
  icon?: string;
  isTemplate?: boolean;
  autorun?: boolean;
  webhook?: string | boolean;
  scheduled?: string;
  locked?: string | boolean;
  cached?: { ttl: number };
  timeout?: { ms: number };
  retryable?: { count: number; delay: number };
  throttled?: { count: number; windowMs: number };
  debounced?: { delay: number };
  queued?: { concurrency: number };
  deprecated?: string | true;
  emitsEvent?: boolean;
  eventName?: string;
}

@customElement('method-card')
export class MethodCard extends LitElement {
  static styles = [
    theme,
    badges,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .card {
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: 6px;
        cursor: pointer;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease,
          border-left-color 0.2s ease;
        height: 100%;
        box-sizing: border-box;
        position: relative;
        border-left: 3px solid transparent;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-lg);
        border-left-color: var(--accent-primary);
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--space-sm);
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex: 1;
        min-width: 0;
      }

      .method-icon {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        background: var(--bg-glass);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
        cursor: pointer;
        transition: all 0.15s ease;
        border: 1px solid transparent;
      }

      .method-icon:hover {
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
        transform: scale(1.1);
      }

      .title {
        font-family: var(--font-mono);
        font-weight: 600;
        font-size: var(--text-md);
        margin: 0;
        color: var(--t-primary);
        display: flex;
        align-items: baseline;
        min-width: 0;
      }

      .title-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex-shrink: 1;
        min-width: 0;
      }
      .title .method-params {
        font-weight: 400;
        opacity: 0.5;
        font-size: 0.85em;
        white-space: nowrap;
      }
      .title .method-params-trunc {
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 1;
        min-width: 0;
      }
      .title .method-params-suffix {
        flex-shrink: 0;
      }

      .editable {
        display: flex;
        align-items: center;
        min-width: 0;
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
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        /* no flip — pencil tip naturally points toward text on left */
        width: 0;
        overflow: hidden;
      }

      .card:hover .edit-pencil {
        opacity: 0.4;
        width: 13px;
        padding: 2px;
      }

      .editable:hover .edit-pencil,
      .edit-pencil:focus-visible {
        opacity: 0.7;
      }

      .edit-pencil:hover {
        opacity: 1 !important;
        color: var(--accent-secondary);
        background: var(--bg-glass);
      }

      .description {
        font-size: var(--text-md);
        color: var(--t-muted);
        line-height: 1.5;
        margin-bottom: var(--space-md);
        flex: 1;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        padding: 4px 6px;
        margin: -4px -6px;
        margin-bottom: calc(var(--space-md) - 4px);
        border-radius: var(--radius-sm);
      }

      .description.placeholder {
        font-style: italic;
        opacity: 0.7;
      }

      .description.editing {
        background: var(--bg-glass-strong);
        box-shadow: 0 0 0 2px var(--accent-primary);
        -webkit-line-clamp: unset;
        overflow: visible;
      }

      .description-input {
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        width: 100%;
        outline: none;
        padding: 0;
        margin: 0;
        resize: none;
        line-height: 1.5;
      }

      .description-input:focus-visible {
        outline: none; /* Parent .editing provides visual ring */
      }

      .description-input::placeholder {
        color: var(--t-muted);
        font-style: italic;
      }

      .char-counter {
        display: block;
        text-align: right;
        font-size: var(--text-2xs);
        color: var(--t-muted);
        margin-top: 2px;
      }

      .badge {
        font-size: var(--text-xs);
        padding: 2px 8px;
        border-radius: var(--radius-md);
        background: var(--bg-glass);
        color: var(--t-muted);
        flex-shrink: 0;
      }

      .badge.prompt {
        background: hsla(45, 80%, 50%, 0.15);
        color: hsl(45, 80%, 60%);
      }

      .badge.scheduled {
        background: hsla(215, 80%, 60%, 0.15);
        color: hsl(215, 80%, 65%);
      }

      .badge.deprecated {
        background: hsla(0, 0%, 50%, 0.15);
        color: hsl(0, 0%, 60%);
        text-decoration: line-through;
      }

      .badge.cached {
        background: hsla(280, 60%, 50%, 0.15);
        color: hsl(280, 60%, 65%);
      }

      .badge.throttled {
        background: hsla(30, 80%, 50%, 0.15);
        color: hsl(30, 80%, 60%);
      }

      .badge.queued {
        background: hsla(200, 70%, 50%, 0.15);
        color: hsl(200, 70%, 60%);
      }

      .badge.event {
        background: hsla(100, 70%, 50%, 0.15);
        color: hsl(100, 70%, 60%);
      }

      .param-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        min-height: 20px;
        margin-top: 2px;
      }

      .param-tag {
        font-size: var(--text-xs);
        padding: 4px 10px;
        border-radius: var(--radius-xs);
        background: var(--param-tag-bg, hsla(260, 60%, 50%, 0.12));
        color: var(--param-tag-color, var(--t-primary));
        border: 1px solid var(--param-tag-border, hsla(260, 60%, 50%, 0.2));
        font-weight: 500;
      }

      .param-count {
        font-size: var(--text-2xs);
        min-width: 20px;
        height: 20px;
        border-radius: var(--radius-sm);
        background: var(--color-warning-bg, hsla(45, 80%, 50%, 0.2));
        color: var(--color-warning, hsl(45, 80%, 60%));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        flex-shrink: 0;
      }

      .type-badges {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 2px;
      }

      .action-icon {
        position: absolute;
        bottom: var(--space-sm);
        right: var(--space-sm);
        font-size: var(--text-xl);
        opacity: 0.5;
        transition:
          opacity 0.2s ease,
          background 0.2s ease;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        background: var(--bg-glass);
      }

      .card:hover .action-icon {
        opacity: 1;
        background: var(--bg-glass-strong);
      }

      /* Emoji Picker */
      .emoji-picker {
        position: fixed;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-sm);
        box-shadow: var(--shadow-lg);
        z-index: 100;
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 2px;
        max-width: 200px;
      }

      .emoji-picker button {
        background: none;
        border: none;
        font-size: var(--text-xl);
        padding: 4px;
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition:
          background 0.15s ease,
          transform 0.1s ease;
      }

      .emoji-picker button:hover {
        background: var(--bg-glass);
        transform: scale(1.15);
      }

      .emoji-picker .remove-btn {
        font-size: var(--text-xs);
        color: var(--t-muted);
        grid-column: span 6;
        padding: 6px;
        margin-top: 4px;
        border-top: 1px solid var(--border-glass);
      }

      .emoji-picker .remove-btn:hover {
        color: var(--color-error);
        background: var(--color-error-bg);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .card {
          padding: var(--space-md);
          min-height: 44px;
        }

        .run-btn {
          width: 100%;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          border-color: transparent;
          color: white;
        }

        .edit-pencil {
          opacity: 0.4;
        }

        .emoji-picker {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          max-width: 90vw;
          z-index: 1000;
        }
      }

      @media (max-width: 480px) {
        .title {
          font-size: 1rem;
        }

        .description {
          font-size: 0.85rem;
          -webkit-line-clamp: 2;
        }

        .method-icon {
          width: 28px;
          height: 28px;
          font-size: 14px;
        }
      }
    `,
  ];

  @property({ type: Object })
  method!: MethodInfo;

  @property({ type: String })
  photonName = '';

  @state() private _editingDescription = false;
  @state() private _editingIcon = false;
  @state() private _editedDescription = '';

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._handleDocumentClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleDocumentClick);
  }

  private _handleDocumentClick = (e: MouseEvent) => {
    if (this._editingIcon) {
      const path = e.composedPath();
      const picker = this.shadowRoot?.querySelector('.emoji-picker');
      const icon = this.shadowRoot?.querySelector('.method-icon');
      if (picker && !path.includes(picker) && !path.includes(icon!)) {
        this._editingIcon = false;
      }
    }
  };

  render() {
    const hasIcon = !!this.method.icon;
    const hasDescription =
      this.method.description &&
      this.method.description !== 'No description provided.' &&
      this.method.description !== 'Add description...' &&
      !/^add description/i.test(this.method.description.trim());

    const isAutorun = !!this.method.autorun;
    const isWebhook = !!this.method.webhook;
    const isCron = !!this.method.scheduled;
    const isLocked = !!this.method.locked;
    const isDeprecated = !!this.method.deprecated;
    const isCached = !!this.method.cached;
    const hasTimeout = !!this.method.timeout;
    const isRetryable = !!this.method.retryable;
    const isThrottled = !!this.method.throttled;
    const isDebounced = !!this.method.debounced;
    const isQueued = !!this.method.queued;
    const emitsEvent = !!this.method.emitsEvent;
    const isTyped = isAutorun || isWebhook || isCron || isLocked || isDeprecated;

    // Determine accent color for typed methods
    const typeAccent = isDeprecated
      ? 'hsl(0, 0%, 50%)'
      : isWebhook
        ? 'hsl(45, 80%, 50%)'
        : isCron
          ? 'hsl(215, 80%, 60%)'
          : isLocked
            ? 'hsl(0, 65%, 55%)'
            : isAutorun
              ? 'hsl(160, 60%, 45%)'
              : '';

    return html`
      <div
        class="card glass-panel ${isTyped ? 'typed' : ''}"
        style="${isTyped ? `--type-accent: ${typeAccent}` : ''}"
        role="button"
        tabindex="0"
        aria-label="${this.method.name}${hasDescription
          ? ': ' + this._renderDescription(this.method.description)
          : ''}"
        @click=${(e: Event) => this._handleCardClick(e)}
        @keydown=${(e: Event) => this._handleCardKeydown(e as KeyboardEvent)}
      >
        <div>
          <div class="header">
            <div class="title-row">
              ${hasIcon
                ? html`
                    <div
                      class="method-icon"
                      @click=${(e: Event) => this._handleIconClick(e)}
                      title="Click to set icon"
                    >
                      ${this.method.icon}
                    </div>
                  `
                : ''}
              <span class="editable">
                <h3 class="title">
                  <span class="title-name">${this.method.name}</span>${this._renderParamSignature()}
                </h3>
                <span
                  class="edit-pencil"
                  role="button"
                  tabindex="0"
                  @click=${(e: Event) => this._handleNameEditClick(e)}
                  @keydown=${(e: KeyboardEvent) =>
                    (e.key === 'Enter' || e.key === ' ') &&
                    (e.preventDefault(), this._handleNameEditClick(e))}
                  title="Rename method"
                  aria-label="Rename method"
                  >${pencil}</span
                >
              </span>
            </div>
            ${this.method.isTemplate ? html`<span class="badge prompt">Prompt</span>` : ''}
            ${isCron
              ? html`<span
                  class="badge scheduled"
                  title="Runs automatically on schedule: ${this.method.scheduled}"
                  >⏱ Scheduled</span
                >`
              : ''}
            ${isDeprecated ? html`<span class="badge deprecated">Deprecated</span>` : ''}
            ${isCached ? html`<span class="badge cached">Cached</span>` : ''}
            ${isThrottled ? html`<span class="badge throttled">Throttled</span>` : ''}
            ${isQueued ? html`<span class="badge queued">Queued</span>` : ''}
            ${emitsEvent
              ? html`<span
                  class="badge event"
                  title="Automatically emits event: ${this.method.eventName}"
                  >📡 Event</span
                >`
              : ''}
          </div>
          ${this._editingDescription
            ? html`
                <div class="description editing" @click=${(e: Event) => e.stopPropagation()}>
                  <textarea
                    class="description-input"
                    .value=${this._editedDescription}
                    placeholder="Add a description..."
                    rows="3"
                    maxlength="500"
                    @input=${(e: Event) =>
                      (this._editedDescription = (e.target as HTMLTextAreaElement).value)}
                    @blur=${() => this._saveDescription()}
                    @keydown=${(e: Event) => this._handleDescriptionKeydown(e as KeyboardEvent)}
                    @click=${(e: Event) => e.stopPropagation()}
                  ></textarea>
                  <span class="char-counter">${this._editedDescription.length}/500</span>
                </div>
              `
            : html`
                <div class="editable" style="flex:1; align-items: flex-start;">
                  <div class="description ${hasDescription ? '' : 'placeholder'}" style="flex:1;">
                    ${hasDescription
                      ? this._renderDescription(this.method.description)
                      : 'Add description...'}
                  </div>
                  <span
                    class="edit-pencil"
                    role="button"
                    tabindex="0"
                    @click=${(e: Event) => this._handleDescriptionEditClick(e)}
                    @keydown=${(e: KeyboardEvent) =>
                      (e.key === 'Enter' || e.key === ' ') &&
                      (e.preventDefault(), this._handleDescriptionEditClick(e))}
                    title="Edit description"
                    aria-label="Edit description"
                    style="margin-top: 2px;"
                    >${pencil}</span
                  >
                </div>
              `}
        </div>
        ${(() => {
          const props = this.method.params?.properties || {};
          const paramCount = Object.keys(props).length;
          const hasParams = paramCount > 0;
          return html`<div
            class="action-icon"
            title="${hasParams ? 'Requires parameters' : 'Click to execute'}"
          >
            ${hasParams ? formInput : play}
          </div>`;
        })()}
        ${this._editingIcon ? this._renderEmojiPicker() : ''}
      </div>
    `;
  }

  private _renderParamSignature() {
    if (this.method.isTemplate) return '';
    const props = this.method.params?.properties || {};
    const paramNames = Object.keys(props);
    if (paramNames.length === 0) return '';
    if (paramNames.length <= 4) {
      return html`<span class="method-params method-params-trunc">(${paramNames.join(', ')}</span
        ><span class="method-params method-params-suffix">)</span>`;
    }
    // Show first 3 params, keep +N) as a non-shrinkable suffix
    const visible = paramNames.slice(0, 3).join(', ');
    return html`<span class="method-params method-params-trunc">(${visible}, </span
      ><span class="method-params method-params-suffix">+${paramNames.length - 3})</span>`;
  }

  private _renderEmojiPicker() {
    const emojis = [
      '📥',
      '📤',
      '🔍',
      '🔎',
      '📊',
      '📈',
      '💾',
      '📁',
      '📝',
      '✏️',
      '🗑️',
      '➕',
      '🔄',
      '⚡',
      '🔧',
      '⚙️',
      '🛠️',
      '🔨',
      '🔒',
      '🔓',
      '🔑',
      '🛡️',
      '👤',
      '👥',
      '📧',
      '💬',
      '🔔',
      '📣',
      '🌐',
      '🔗',
      '✅',
      '❌',
      '⭐',
      '🎯',
      '💡',
      '🚀',
    ];

    return html`
      <div
        class="emoji-picker"
        style="top:${this._pickerPos.top}px;left:${this._pickerPos.left}px"
        @click=${(e: Event) => e.stopPropagation()}
      >
        ${emojis.map(
          (emoji) => html` <button @click=${() => this._selectIcon(emoji)}>${emoji}</button> `
        )}
        ${this.method.icon
          ? html`
              <button class="remove-btn" @click=${() => this._selectIcon('')}>Remove icon</button>
            `
          : ''}
      </div>
    `;
  }

  private _handleCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._handleCardClick(e);
    }
  }

  private _handleCardClick(e: Event) {
    // Don't trigger card click if editing
    if (this._editingDescription || this._editingIcon) {
      return;
    }
    this.dispatchEvent(new CustomEvent('select', { detail: { method: this.method } }));
  }

  private _handleRunClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('select', { detail: { method: this.method } }));
  }

  private _pickerPos = { top: 0, left: 0 };

  private _handleIconClick(e: Event) {
    e.stopPropagation();
    this._editingIcon = !this._editingIcon;
    if (this._editingIcon) {
      const target = (e.currentTarget || e.target) as HTMLElement;
      const rect = target.getBoundingClientRect();
      const pickerHeight = 220; // approximate
      // Position below the icon, or above if near bottom
      const spaceBelow = window.innerHeight - rect.bottom;
      this._pickerPos = {
        top: spaceBelow > pickerHeight ? rect.bottom + 4 : rect.top - pickerHeight - 4,
        left: Math.min(rect.left, window.innerWidth - 210),
      };
    }
  }

  private _selectIcon(icon: string) {
    this._editingIcon = false;

    // Dispatch event to parent for persistence
    this.dispatchEvent(
      new CustomEvent('update-metadata', {
        bubbles: true,
        composed: true,
        detail: {
          photonName: this.photonName,
          methodName: this.method.name,
          metadata: { icon: icon || null },
        },
      })
    );
  }

  private _handleNameEditClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('edit-method-name', {
        bubbles: true,
        composed: true,
        detail: {
          photonName: this.photonName,
          methodName: this.method.name,
        },
      })
    );
  }

  private _renderDescription(description: string) {
    // Strip markdown to plain text for card preview — line-clamp truncation
    // can break mid-HTML-tag and show rendering artifacts (dangling backticks).
    // Full markdown rendering happens in the detail view (beam-app.ts).
    let text = description
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      // Italic: *text* or _text_ (single)
      .replace(/\*(.+?)\*/g, '$1')
      // Strip leading @ from code spans before unwrapping: `@tag` → `tag`
      // This prevents the @-tag stripper below from eating code span content like `@title`
      .replace(/`@(\w[^`]*)`/g, '`$1`')
      // Inline code: `text`
      .replace(/`([^`]*)`/g, '$1')
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Strip docblock directive tags (@internal, @template, etc.).
      // Two cases:
      // 1. Line-starting tags (when JSDoc is multi-line and tag is on its own line)
      .replace(/^\s*@\w+[^\n]*/gm, '')
      // 2. Trailing tags at end of string — when schema-extractor joins JSDoc lines with spaces
      //    the tag ends up inline: "Description text @template"
      .replace(/\s+@\w+(\s+@\w+)*\s*$/, '')
      // Remove stray markdown characters (unclosed ** or `)
      .replace(/\*{1,2}/g, '')
      .replace(/`/g, '')
      // Headings: ## text
      .replace(/^#{1,6}\s+/gm, '')
      // Clean up double dashes used as em-dashes
      .replace(/\s--\s/g, ' \u2014 ')
      // Collapse multiple spaces and trim
      .replace(/\s{2,}/g, ' ')
      .trim();
    return text;
  }

  private _handleDescriptionEditClick(e: Event) {
    e.stopPropagation();
    this._editedDescription = this.method.description || '';
    this._editingDescription = true;

    // Focus the textarea after render
    void this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('.description-input') as HTMLTextAreaElement;
      textarea?.focus();
      textarea?.select();
    });
  }

  private _handleDescriptionKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._saveDescription();
    } else if (e.key === 'Escape') {
      this._editingDescription = false;
    }
  }

  private _saveDescription() {
    this._editingDescription = false;
    const newDesc = this._editedDescription.trim();
    const originalDesc = (this.method.description || '').trim();
    // No-op if nothing changed
    if (newDesc === originalDesc || (!newDesc && !this.method.description)) return;
    showToast('Description saved', 'success');

    // Dispatch event to parent for persistence
    this.dispatchEvent(
      new CustomEvent('update-metadata', {
        bubbles: true,
        composed: true,
        detail: {
          photonName: this.photonName,
          methodName: this.method.name,
          metadata: { description: newDesc || null },
        },
      })
    );
  }
}
