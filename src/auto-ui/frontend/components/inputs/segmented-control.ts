import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme } from '../../styles/index.js';

@customElement('segmented-control')
export class SegmentedControl extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      /* Segmented (horizontal pill bar) */
      .segmented {
        display: flex;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        padding: 2px;
        gap: 2px;
      }

      .seg-option {
        flex: 1;
        padding: 8px 12px;
        text-align: center;
        font-size: 13px;
        font-weight: 500;
        color: var(--t-muted);
        background: none;
        border: none;
        border-radius: calc(var(--radius-sm) - 2px);
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }

      .seg-option:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.05));
      }

      .seg-option.active {
        background: var(--accent-primary);
        color: #fff;
        font-weight: 600;
      }

      /* Radio (vertical list) */
      .radio-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .radio-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.15s;
        font-size: 13px;
        color: var(--t-primary);
      }

      .radio-option:hover {
        border-color: var(--accent-primary);
      }

      .radio-option.active {
        border-color: var(--accent-primary);
        background: var(--accent-primary) 10;
      }

      .radio-dot {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--border-glass);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.15s;
      }

      .radio-option.active .radio-dot {
        border-color: var(--accent-primary);
      }

      .radio-dot-inner {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent-primary);
        transform: scale(0);
        transition: transform 0.15s;
      }

      .radio-option.active .radio-dot-inner {
        transform: scale(1);
      }

      @media (max-width: 768px) {
        .seg-option {
          padding: 10px 12px;
          font-size: 14px;
        }
        .radio-option {
          min-height: 44px;
          font-size: 14px;
        }
      }
    `,
  ];

  @property({ type: Array }) options: string[] = [];
  @property() value = '';
  @property() variant: 'segmented' | 'radio' = 'segmented';
  @property({ type: Boolean }) hasError = false;

  private _emit(val: string) {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: val }, bubbles: true, composed: true })
    );
  }

  private _capitalize(s: string): string {
    // Short all-letter values (xs, xl, sm, md, lg) → uppercase as abbreviations
    if (s.length <= 3 && /^[a-z]+$/.test(s)) return s.toUpperCase();
    return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  render() {
    if (this.variant === 'radio') {
      return html`
        <div class="radio-group">
          ${this.options.map(
            (opt) => html`
              <div
                class="radio-option ${opt === this.value ? 'active' : ''}"
                @click=${() => this._emit(opt)}
              >
                <div class="radio-dot"><div class="radio-dot-inner"></div></div>
                ${this._capitalize(opt)}
              </div>
            `
          )}
        </div>
      `;
    }

    return html`
      <div class="segmented">
        ${this.options.map(
          (opt) => html`
            <button
              class="seg-option ${opt === this.value ? 'active' : ''}"
              @click=${() => this._emit(opt)}
            >
              ${this._capitalize(opt)}
            </button>
          `
        )}
      </div>
    `;
  }
}
