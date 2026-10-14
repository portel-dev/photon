import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme, buttons, forms } from '../../styles/index.js';
import type { FieldAction } from '../../utils/semantic-actions.js';

@customElement('semantic-action-input')
export class SemanticActionInput extends LitElement {
  static styles = [
    theme,
    buttons,
    forms,
    css`
      :host {
        display: block;
      }

      .input-wrapper {
        display: flex;
        gap: 0;
        align-items: stretch;
      }

      input {
        flex: 1;
        min-width: 0;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: none;
      }

      input.error {
        border-color: var(--color-error, #ef4444);
      }

      .action-button {
        flex: 0 0 auto;
        min-width: 42px;
        padding: 0 10px;
        border: 1px solid var(--border-glass);
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        background: var(--bg-glass);
        color: var(--t-muted);
        cursor: pointer;
        font: inherit;
        transition: all 0.15s ease;
      }

      .action-button:hover:not(:disabled),
      .action-button:focus-visible {
        color: var(--accent-primary);
        border-color: var(--accent-primary);
        background: var(--bg-glass-strong);
      }

      .action-button:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      .status {
        margin-top: 4px;
        color: var(--t-muted);
        font-size: var(--text-xs);
      }

      .status.error {
        color: var(--color-error, #ef4444);
      }

      @media (max-width: 480px) {
        .input-wrapper {
          flex-wrap: wrap;
          gap: var(--space-xs);
        }

        input {
          min-width: 160px;
          border-right: 1px solid var(--border-glass);
          border-radius: var(--radius-sm);
        }

        .action-button {
          min-height: 38px;
          border-radius: var(--radius-sm);
        }
      }
    `,
  ];

  @property({ type: String }) value = '';
  @property({ type: String }) inputType = 'text';
  @property({ type: String }) inputMode = '';
  @property({ type: String }) placeholder = '';
  @property({ type: String }) min = '';
  @property({ type: String }) max = '';
  @property({ type: String }) step = '';
  @property({ type: String }) actionLabel = '';
  @property({ type: String }) actionTitle = '';
  @property({ type: String }) status = '';
  @property({ type: Boolean }) actionBusy = false;
  @property({ type: Boolean }) hasError = false;
  @property({ type: Boolean }) required = false;
  @property({ type: String }) inputId = '';
  @property({ type: String }) action = '';

  render() {
    const label = this.actionLabel || this.actionTitle || 'Use value';
    return html`
      <div class="input-wrapper">
        <input
          id=${this.inputId || nothing}
          type=${this.inputType}
          inputmode=${this.inputMode || nothing}
          min=${this.min || nothing}
          max=${this.max || nothing}
          step=${this.step || nothing}
          placeholder=${this.placeholder}
          class=${this.hasError ? 'error' : ''}
          .value=${this.value}
          ?required=${this.required}
          aria-invalid=${this.hasError ? 'true' : 'false'}
          @input=${this._onInput}
        />
        <button
          class="action-button"
          type="button"
          title=${this.actionTitle || label}
          aria-label=${label}
          aria-busy=${this.actionBusy ? 'true' : 'false'}
          ?disabled=${this.actionBusy}
          @click=${this._onAction}
        >
          ${this.actionBusy ? '…' : '⌖'}
        </button>
      </div>
      ${this.status
        ? html`<div
            class="status ${this.hasError ? 'error' : ''}"
            role=${this.hasError ? 'alert' : 'status'}
          >
            ${this.status}
          </div>`
        : nothing}
    `;
  }

  private _onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: input.value }, bubbles: true, composed: true })
    );
  };

  private _onAction = () => {
    this.dispatchEvent(
      new CustomEvent('action', {
        detail: { action: this.action },
        bubbles: true,
        composed: true,
      })
    );
  };
}
