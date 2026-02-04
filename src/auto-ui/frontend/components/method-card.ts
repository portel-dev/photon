import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface MethodInfo {
  name: string;
  description: string;
  params: Record<string, any>;
  icon?: string;
  isTemplate?: boolean;
}

@customElement('method-card')
export class MethodCard extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .card {
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        cursor: pointer;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
        height: 100%;
        box-sizing: border-box;
        position: relative;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 32px -4px rgba(0, 0, 0, 0.3);
        border-color: var(--accent-secondary);
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
        border-radius: 8px;
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

      .method-icon.placeholder {
        color: var(--t-muted);
        font-size: 12px;
      }

      .title {
        font-weight: 600;
        font-size: 1.1rem;
        margin: 0;
        color: var(--t-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .description {
        font-size: 0.9rem;
        color: var(--t-muted);
        line-height: 1.5;
        margin-bottom: var(--space-md);
        flex: 1;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        cursor: text;
        padding: 4px 6px;
        margin: -4px -6px;
        margin-bottom: calc(var(--space-md) - 4px);
        border-radius: var(--radius-sm);
        transition: background 0.15s ease;
      }

      .description:hover {
        background: var(--bg-glass);
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

      .description-input::placeholder {
        color: var(--t-muted);
        font-style: italic;
      }

      .badge {
        font-size: 0.75rem;
        padding: 2px 8px;
        border-radius: 12px;
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-muted);
        flex-shrink: 0;
      }

      .badge.prompt {
        background: hsla(45, 80%, 50%, 0.15);
        color: hsl(45, 80%, 60%);
      }

      .run-btn {
        align-self: flex-start;
        background: transparent;
        border: 1px solid var(--accent-primary);
        padding: var(--space-sm) var(--space-lg);
        border-radius: var(--radius-sm);
        color: var(--accent-primary);
        font-weight: 500;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .card:hover .run-btn,
      .run-btn:hover {
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        border-color: transparent;
        color: white;
      }

      /* Emoji Picker */
      .emoji-picker {
        position: absolute;
        top: 50px;
        left: var(--space-md);
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-sm);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 100;
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 2px;
        max-width: 200px;
      }

      .emoji-picker button {
        background: none;
        border: none;
        font-size: 1.2rem;
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
        font-size: 0.7rem;
        color: var(--t-muted);
        grid-column: span 6;
        padding: 6px;
        margin-top: 4px;
        border-top: 1px solid var(--border-glass);
      }

      .emoji-picker .remove-btn:hover {
        color: #f87171;
        background: hsla(0, 80%, 60%, 0.1);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .card {
          padding: var(--space-md);
          min-height: 44px;
        }

        .run-btn {
          width: 100%;
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
      this.method.description && this.method.description !== 'No description provided.';
    const initials = this.method.name.substring(0, 2).toUpperCase();

    return html`
      <div class="card glass-panel" @click=${this._handleCardClick}>
        <div>
          <div class="header">
            <div class="title-row">
              <div
                class="method-icon ${hasIcon ? '' : 'placeholder'}"
                @click=${this._handleIconClick}
                title="Click to set icon"
              >
                ${hasIcon ? this.method.icon : initials}
              </div>
              <h3 class="title">${this.method.name}</h3>
            </div>
            ${this.method.isTemplate
              ? html`<span class="badge prompt">Prompt</span>`
              : Object.keys(this.method.params || {}).length > 0
                ? html`<span class="badge">Params</span>`
                : html`<span
                    class="badge"
                    style="background: hsla(150, 50%, 40%, 0.2); color: #4ade80;"
                    >Ready</span
                  >`}
          </div>
          ${this._editingDescription
            ? html`
                <div class="description editing" @click=${(e: Event) => e.stopPropagation()}>
                  <textarea
                    class="description-input"
                    .value=${this._editedDescription}
                    placeholder="Add a description..."
                    rows="3"
                    @input=${(e: Event) =>
                      (this._editedDescription = (e.target as HTMLTextAreaElement).value)}
                    @blur=${this._saveDescription}
                    @keydown=${this._handleDescriptionKeydown}
                    @click=${(e: Event) => e.stopPropagation()}
                  ></textarea>
                </div>
              `
            : html`
                <p
                  class="description ${hasDescription ? '' : 'placeholder'}"
                  @click=${this._handleDescriptionClick}
                  title="Click to edit description"
                >
                  ${hasDescription ? this.method.description : 'Click to add description...'}
                </p>
              `}
        </div>
        <button class="run-btn" @click=${this._handleRunClick}>Run ▸</button>
        ${this._editingIcon ? this._renderEmojiPicker() : ''}
      </div>
    `;
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
      <div class="emoji-picker" @click=${(e: Event) => e.stopPropagation()}>
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

  private _handleIconClick(e: Event) {
    e.stopPropagation();
    this._editingIcon = !this._editingIcon;
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

  private _handleDescriptionClick(e: Event) {
    e.stopPropagation();
    this._editedDescription = this.method.description || '';
    this._editingDescription = true;

    // Focus the textarea after render
    this.updateComplete.then(() => {
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
