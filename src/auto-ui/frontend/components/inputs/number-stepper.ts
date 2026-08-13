import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme, forms } from '../../styles/index.js';

@customElement('number-stepper')
export class NumberStepper extends LitElement {
  static styles = [
    theme,
    forms,
    css`
      :host {
        display: inline-block;
        min-width: 150px;
      }
      .control {
        display: flex;
        align-items: stretch;
      }
      input {
        min-width: 0;
        flex: 1;
        text-align: center;
        font-variant-numeric: tabular-nums;
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }
      button {
        width: 38px;
        min-height: 38px;
        padding: 0;
        border: 1px solid var(--border-glass);
        background: var(--bg-glass);
        color: var(--t-primary);
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      button:first-child {
        border-radius: var(--radius-sm) 0 0 var(--radius-sm);
      }
      button:last-child {
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      }
      button:hover:not(:disabled) {
        background: var(--bg-glass-strong);
        color: var(--accent-primary);
      }
      button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      input.error {
        border-color: var(--color-error, #ef4444);
      }
    `,
  ];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min?: number;
  @property({ type: Number }) max?: number;
  @property({ type: Number }) step = 1;
  @property({ type: Boolean }) hasError = false;

  private _precision(): number {
    const text = String(this.step);
    return text.includes('.') ? text.split('.')[1].length : 0;
  }

  private _clamp(value: number): number {
    let next = Number.isFinite(value) ? value : (this.min ?? 0);
    if (this.min !== undefined) next = Math.max(this.min, next);
    if (this.max !== undefined) next = Math.min(this.max, next);
    return Number(next.toFixed(this._precision()));
  }

  private _emit(value: number) {
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value: this._clamp(value) },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _step(delta: number) {
    this._emit(this.value + delta * this.step);
  }

  private _onInput = (event: Event) => {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '' || raw === '-') return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) this._emit(parsed);
  };

  render() {
    const atMin = this.min !== undefined && this.value <= this.min;
    const atMax = this.max !== undefined && this.value >= this.max;
    return html`
      <div class="control" role="group" aria-label="Number input">
        <button
          type="button"
          aria-label="Decrease value"
          ?disabled=${atMin}
          @click=${() => this._step(-1)}
        >
          −
        </button>
        <input
          type="text"
          inputmode=${this.step % 1 === 0 ? 'numeric' : 'decimal'}
          class=${this.hasError ? 'error' : ''}
          .value=${String(this.value)}
          aria-label="Value"
          @input=${this._onInput}
          @change=${(event: Event) => this._emit(Number((event.target as HTMLInputElement).value))}
        />
        <button
          type="button"
          aria-label="Increase value"
          ?disabled=${atMax}
          @click=${() => this._step(1)}
        >
          +
        </button>
      </div>
    `;
  }
}
