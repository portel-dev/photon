/**
 * Themed confirmation dialog — replaces native window.confirm()
 *
 * Usage: const ok = await confirmDialog('Delete this item?');
 * Optional: await confirmDialog('Delete?', { confirm: 'Delete', destructive: true });
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { theme } from '../styles/index.js';

@customElement('confirm-dialog')
export class ConfirmDialog extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: none;
      }

      @keyframes backdrop-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes content-in {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(8px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      :host([open]) {
        display: flex;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 10001;
        align-items: center;
        justify-content: center;
        animation: backdrop-in 0.15s ease-out both;
      }

      .dialog {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md, 12px);
        padding: 24px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
        animation: content-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
        animation-delay: 0.05s;
      }

      .message {
        font-size: 14px;
        line-height: 1.5;
        color: var(--t-primary);
        margin-bottom: 20px;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      button {
        padding: 8px 16px;
        border-radius: var(--radius-sm, 6px);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        border: none;
      }

      .btn-cancel {
        background: var(--bg-glass);
        color: var(--t-primary);
        border: 1px solid var(--border-glass);
      }

      .btn-cancel:hover {
        background: var(--bg-glass-strong);
      }

      .btn-confirm {
        background: var(--accent);
        color: #fff;
      }

      .btn-confirm:hover {
        opacity: 0.9;
      }

      .btn-confirm.destructive {
        background: hsl(0, 60%, 50%);
      }

      .btn-confirm.destructive:hover {
        background: hsl(0, 60%, 45%);
      }

      .prompt-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm, 6px);
        background: var(--bg-glass);
        color: var(--t-primary);
        font-size: 13px;
        font-family: inherit;
        margin-bottom: 16px;
        box-sizing: border-box;
      }

      .prompt-input:focus {
        outline: none;
        border-color: var(--accent);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) message = '';
  @property({ type: String }) confirmLabel = 'OK';
  @property({ type: String }) cancelLabel = 'Cancel';
  @property({ type: Boolean }) destructive = false;

  private _resolve?: (value: boolean) => void;
  private _promptResolve?: (value: string | null) => void;
  private _promptMode = false;
  private _promptDefault = '';

  show(
    message: string,
    options?: { confirm?: string; cancel?: string; destructive?: boolean }
  ): Promise<boolean> {
    this.message = message;
    this.confirmLabel = options?.confirm ?? 'OK';
    this.cancelLabel = options?.cancel ?? 'Cancel';
    this.destructive = options?.destructive ?? false;
    this._promptMode = false;
    this.open = true;

    return new Promise<boolean>((resolve) => {
      this._resolve = resolve;
    });
  }

  showPrompt(
    message: string,
    defaultValue = '',
    options?: { confirm?: string; cancel?: string }
  ): Promise<string | null> {
    this.message = message;
    this.confirmLabel = options?.confirm ?? 'OK';
    this.cancelLabel = options?.cancel ?? 'Cancel';
    this.destructive = false;
    this._promptMode = true;
    this._promptDefault = defaultValue;
    this.open = true;

    // Focus the input after rendering
    this.updateComplete
      .then(() => {
        const input = this.shadowRoot?.querySelector('.prompt-input') as HTMLInputElement;
        if (input) {
          input.value = defaultValue;
          input.focus();
          input.select();
        }
      })
      .catch(() => {
        /* ignore */
      });

    return new Promise<string | null>((resolve) => {
      this._promptResolve = resolve;
    });
  }

  private _handleConfirm() {
    this.open = false;
    if (this._promptMode) {
      const input = this.shadowRoot?.querySelector('.prompt-input') as HTMLInputElement;
      this._promptResolve?.(input?.value ?? null);
    } else {
      this._resolve?.(true);
    }
  }

  private _handleCancel() {
    this.open = false;
    if (this._promptMode) {
      this._promptResolve?.(null);
    } else {
      this._resolve?.(false);
    }
  }

  private _handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') this._handleCancel();
    if (e.key === 'Enter') this._handleConfirm();
  }

  render() {
    return html`
      <div class="dialog" @keydown=${(e: KeyboardEvent) => this._handleKeydown(e)}>
        <div class="message">${this.message}</div>
        ${this._promptMode
          ? html`<input class="prompt-input" type="text" .value=${this._promptDefault} />`
          : ''}
        <div class="actions">
          <button class="btn-cancel" @click=${() => this._handleCancel()}>
            ${this.cancelLabel}
          </button>
          <button
            class="btn-confirm ${this.destructive ? 'destructive' : ''}"
            @click=${() => this._handleConfirm()}
          >
            ${this.confirmLabel}
          </button>
        </div>
      </div>
    `;
  }
}

function getOrCreateDialog(): ConfirmDialog {
  const beamApp = document.querySelector('beam-app');
  const root = beamApp?.shadowRoot ?? document.body;
  let dialog = root.querySelector('confirm-dialog') as ConfirmDialog;
  if (!dialog) {
    dialog = document.createElement('confirm-dialog') as ConfirmDialog;
    root.appendChild(dialog);
  }
  return dialog;
}

/** Global themed confirm dialog — drop-in replacement for window.confirm() */
export async function confirmDialog(
  message: string,
  options?: { confirm?: string; cancel?: string; destructive?: boolean }
): Promise<boolean> {
  return getOrCreateDialog().show(message, options);
}

/** Global themed prompt dialog — drop-in replacement for window.prompt() */
export async function promptDialog(
  message: string,
  defaultValue = '',
  options?: { confirm?: string; cancel?: string }
): Promise<string | null> {
  return getOrCreateDialog().showPrompt(message, defaultValue, options);
}
