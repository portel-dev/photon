import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, forms } from '../../styles/index.js';

@customElement('code-input')
export class CodeInput extends LitElement {
  static styles = [
    theme,
    forms,
    css`
      :host {
        display: block;
      }

      .container {
        position: relative;
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--bg-glass);
      }

      .container:focus-within {
        border-color: var(--accent-primary);
      }

      .editor-wrapper {
        display: flex;
        position: relative;
      }

      .line-numbers {
        padding: 10px 0;
        background: rgba(0, 0, 0, 0.15);
        text-align: right;
        user-select: none;
        min-width: 36px;
        flex-shrink: 0;
      }

      .line-num {
        display: block;
        padding: 0 8px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--t-muted);
        opacity: 0.5;
      }

      textarea {
        flex: 1;
        border: none;
        background: none;
        color: var(--t-primary);
        font-family: var(--font-mono, monospace);
        font-size: 13px;
        line-height: 1.6;
        padding: 10px 12px;
        resize: vertical;
        min-height: 120px;
        tab-size: 2;
        outline: none;
        width: 100%;
      }

      textarea::placeholder {
        color: var(--t-muted);
        opacity: 0.5;
      }

      .footer {
        display: flex;
        justify-content: space-between;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.1);
        font-size: 11px;
        color: var(--t-muted);
        border-top: 1px solid var(--border-glass);
      }

      @media (max-width: 768px) {
        textarea {
          font-size: 14px;
          min-height: 150px;
        }
      }
    `,
  ];

  @property() value = '';
  @property() language = '';
  @property() placeholder = '';
  @property({ type: Boolean }) hasError = false;

  @state() private _lineCount = 1;

  private _emit(val: string) {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: val }, bubbles: true, composed: true })
    );
  }

  private _handleInput = (e: Event) => {
    const val = (e.target as HTMLTextAreaElement).value;
    this._lineCount = Math.max(1, val.split('\n').length);
    this._emit(val);
  };

  private _handleKeydown = (e: KeyboardEvent) => {
    // Tab inserts 2 spaces instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      ta.value = val.substring(0, start) + '  ' + val.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      this._emit(ta.value);
    }
  };

  updated(changed: Map<string, unknown>) {
    if (changed.has('value')) {
      this._lineCount = Math.max(1, (this.value || '').split('\n').length);
    }
  }

  render() {
    const lines = [];
    for (let i = 1; i <= this._lineCount; i++) {
      lines.push(html`<span class="line-num">${i}</span>`);
    }

    const charCount = (this.value || '').length;
    const lang = this.language || 'plain text';

    return html`
      <div class="container">
        <div class="editor-wrapper">
          <div class="line-numbers">${lines}</div>
          <textarea
            .value=${this.value || ''}
            placeholder=${this.placeholder || 'Enter code...'}
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
          ></textarea>
        </div>
        <div class="footer">
          <span>${lang}</span>
          <span
            >${this._lineCount} ${this._lineCount === 1 ? 'line' : 'lines'}, ${charCount}
            ${charCount === 1 ? 'char' : 'chars'}</span
          >
        </div>
      </div>
    `;
  }
}
