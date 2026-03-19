import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../../styles/index.js';

@customElement('star-rating')
export class StarRating extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      .container {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .stars {
        display: flex;
        gap: 4px;
      }

      .star {
        font-size: 24px;
        cursor: pointer;
        background: none;
        border: none;
        padding: 2px;
        transition: transform 0.1s;
        line-height: 1;
      }

      .star:hover {
        transform: scale(1.2);
      }

      .star.filled {
        filter: none;
      }

      .star.empty {
        opacity: 0.3;
      }

      .value-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--t-primary);
        min-width: 24px;
      }

      .value-input {
        width: 48px;
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        padding: 4px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--t-primary);
      }

      @media (max-width: 768px) {
        .star {
          font-size: 32px;
          padding: 4px;
        }
      }
    `,
  ];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) max = 5;
  @property({ type: Number }) step = 1; // 0.5 for half-stars
  @property({ type: Boolean }) hasError = false;

  @state() private _hoverValue = 0;

  private _emit(val: number) {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: val }, bubbles: true, composed: true })
    );
  }

  private _getStarDisplay(starIndex: number, value: number): string {
    if (value >= starIndex + 1) return '★';
    if (this.step <= 0.5 && value >= starIndex + 0.5) return '★'; // half-filled shown as full with opacity
    return '☆';
  }

  private _handleClick = (starIndex: number, e: MouseEvent) => {
    if (this.step <= 0.5) {
      // Half-star support: left half = x.5, right half = x+1
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const isLeftHalf = e.clientX - rect.left < rect.width / 2;
      this._emit(isLeftHalf ? starIndex + 0.5 : starIndex + 1);
    } else {
      this._emit(starIndex + 1);
    }
  };

  render() {
    const displayValue = this._hoverValue || this.value;
    const stars = [];
    for (let i = 0; i < this.max; i++) {
      const filled = displayValue >= i + 1;
      const halfFilled = this.step <= 0.5 && displayValue >= i + 0.5 && displayValue < i + 1;
      stars.push(html`
        <button
          class="star ${filled || halfFilled ? 'filled' : 'empty'}"
          style="${halfFilled ? 'opacity:0.6' : ''}"
          @click=${(e: MouseEvent) => this._handleClick(i, e)}
          @mouseenter=${() => {
            this._hoverValue = i + 1;
          }}
          @mouseleave=${() => {
            this._hoverValue = 0;
          }}
        >
          ${filled || halfFilled ? '★' : '☆'}
        </button>
      `);
    }

    return html`
      <div class="container">
        <div class="stars">${stars}</div>
        <input
          class="value-input"
          type="number"
          min="0"
          max=${this.max}
          step=${this.step}
          .value=${String(this.value)}
          @input=${(e: Event) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(v) && v >= 0 && v <= this.max) this._emit(v);
          }}
        />
      </div>
    `;
  }
}
