import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

@customElement('toast-manager')
export class ToastManager extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        position: fixed;
        bottom: var(--space-lg);
        right: var(--space-lg);
        z-index: 9999;
        display: flex;
        flex-direction: column-reverse;
        gap: var(--space-sm);
        pointer-events: none;
      }

      .toast {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        background: var(--bg-glass-strong);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        font-size: 0.9rem;
        pointer-events: auto;
        animation: slideIn 0.3s ease-out;
        max-width: 350px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }

      .toast.exiting {
        animation: slideOut 0.3s ease-in forwards;
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }

      .icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
      }

      .toast.success .icon {
        color: #4ade80;
      }
      .toast.error .icon {
        color: #f87171;
      }
      .toast.info .icon {
        color: var(--accent-secondary);
      }
      .toast.warning .icon {
        color: #fbbf24;
      }

      .toast.success {
        border-left: 3px solid #4ade80;
      }
      .toast.error {
        border-left: 3px solid #f87171;
      }
      .toast.info {
        border-left: 3px solid var(--accent-secondary);
      }
      .toast.warning {
        border-left: 3px solid #fbbf24;
      }

      .message {
        flex: 1;
        line-height: 1.4;
      }

      .close {
        background: none;
        border: none;
        color: var(--t-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: all 0.2s;
      }

      .close:hover {
        color: var(--t-primary);
        background: hsla(220, 10%, 80%, 0.1);
      }
    `,
  ];

  @state() private _toasts: Toast[] = [];
  private _exitingToasts = new Set<string>();

  static instance: ToastManager | null = null;

  connectedCallback() {
    super.connectedCallback();
    ToastManager.instance = this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (ToastManager.instance === this) {
      ToastManager.instance = null;
    }
  }

  static show(message: string, type: Toast['type'] = 'info', duration = 3000) {
    if (ToastManager.instance) {
      ToastManager.instance.addToast(message, type, duration);
    }
  }

  addToast(message: string, type: Toast['type'] = 'info', duration = 3000) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast: Toast = { id, message, type, duration };

    this._toasts = [...this._toasts, toast];

    if (duration > 0) {
      setTimeout(() => this._dismissToast(id), duration);
    }
  }

  private _dismissToast(id: string) {
    this._exitingToasts.add(id);
    this.requestUpdate();

    setTimeout(() => {
      this._exitingToasts.delete(id);
      this._toasts = this._toasts.filter((t) => t.id !== id);
    }, 300);
  }

  render() {
    return html`
      <div role="status" aria-live="polite" aria-atomic="false">
        ${this._toasts.map(
          (toast) => html`
            <div
              class="toast ${toast.type} ${this._exitingToasts.has(toast.id) ? 'exiting' : ''}"
              role="alert"
              aria-live="${toast.type === 'error' ? 'assertive' : 'polite'}"
            >
              ${this._renderIcon(toast.type)}
              <span class="message">${toast.message}</span>
              <button
                class="close"
                @click=${() => this._dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderIcon(type: Toast['type']) {
    const icons: Record<Toast['type'], string> = {
      success: '<path d="M20 6L9 17l-5-5"/>',
      error: '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
      info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
      warning:
        '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/>',
    };

    return html`
      <svg
        class="icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        ${this._unsafeSvg(icons[type])}
      </svg>
    `;
  }

  private _unsafeSvg(svg: string) {
    const template = document.createElement('template');
    template.innerHTML = svg;
    return html`${template.content}`;
  }
}

export function showToast(message: string, type: Toast['type'] = 'info', duration = 3000) {
  ToastManager.show(message, type, duration);
}
