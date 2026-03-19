import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, forms } from '../../styles/index.js';

@customElement('tag-input')
export class TagInput extends LitElement {
  static styles = [
    theme,
    forms,
    css`
      :host {
        display: block;
      }

      .container {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px 8px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        min-height: 36px;
        cursor: text;
        transition: border-color 0.15s;
      }

      .container:focus-within {
        border-color: var(--accent-primary);
      }

      .container.error {
        border-color: var(--color-error, #ef4444);
      }

      .tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--accent-primary);
        color: #fff;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
        max-width: 200px;
        overflow: hidden;
      }

      .tag-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tag-remove {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        font-size: 14px;
        padding: 0;
        line-height: 1;
        display: flex;
        align-items: center;
      }

      .tag-remove:hover {
        color: #fff;
      }

      .input {
        flex: 1;
        min-width: 80px;
        border: none;
        background: none;
        color: var(--t-primary);
        font-size: var(--text-md);
        outline: none;
        padding: 2px 0;
      }

      .input::placeholder {
        color: var(--t-muted);
        opacity: 0.6;
      }

      .hint {
        font-size: 11px;
        color: var(--t-muted);
        margin-top: 4px;
      }

      @media (max-width: 768px) {
        .container {
          min-height: 44px;
        }
        .input {
          font-size: 16px;
        }
      }
    `,
  ];

  @property({ type: Array }) value: string[] = [];
  @property({ type: Boolean }) hasError = false;
  @property() placeholder = 'Type and press Enter';

  @state() private _inputValue = '';

  private _emit(tags: string[]) {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: tags }, bubbles: true, composed: true })
    );
  }

  private _addTag = () => {
    const val = this._inputValue.trim();
    if (!val) return;
    // Support comma-separated input
    const newTags = val
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !this.value.includes(t));
    if (newTags.length > 0) {
      this._emit([...this.value, ...newTags]);
    }
    this._inputValue = '';
  };

  private _removeTag = (index: number) => {
    const tags = [...this.value];
    tags.splice(index, 1);
    this._emit(tags);
  };

  private _handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this._addTag();
    } else if (e.key === 'Backspace' && !this._inputValue && this.value.length > 0) {
      this._removeTag(this.value.length - 1);
    }
  };

  render() {
    return html`
      <div
        class="container ${this.hasError ? 'error' : ''}"
        @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('.input')?.focus()}
      >
        ${(this.value || []).map(
          (tag, i) => html`
            <span class="tag">
              <span class="tag-text">${tag}</span>
              <button
                class="tag-remove"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._removeTag(i);
                }}
              >
                ×
              </button>
            </span>
          `
        )}
        <input
          class="input"
          type="text"
          .value=${this._inputValue}
          placeholder=${this.value.length === 0 ? this.placeholder : ''}
          @input=${(e: Event) => {
            this._inputValue = (e.target as HTMLInputElement).value;
          }}
          @keydown=${this._handleKeydown}
          @blur=${this._addTag}
        />
      </div>
      <div class="hint">Press Enter or comma to add</div>
    `;
  }
}
