import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

/**
 * App-first layout for App photons.
 *
 * The app UI fills the viewport with a small floating fullscreen button.
 * Scrolling down reveals the standard photon interface (methods, prompts, resources).
 * Fullscreen button opens a full-screen overlay.
 */
@customElement('app-layout')
export class AppLayout extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      .app-toolbar {
        display: flex;
        justify-content: flex-end;
        padding: var(--space-xs) var(--space-sm);
      }

      .fullscreen-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        cursor: pointer;
        font-size: var(--text-md);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .fullscreen-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .app-viewport {
        min-height: calc(100vh - 140px);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .scroll-hint {
        text-align: center;
        padding: var(--space-lg) 0;
        color: var(--t-muted);
        font-size: var(--text-sm);
      }

      .below-fold {
        padding-top: var(--space-lg);
        border-top: 1px solid var(--border-glass);
        margin-top: var(--space-lg);
      }

      /* Pop-out overlay */
      .popout-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--bg-app, #0a0a12);
        z-index: 9999;
        display: flex;
        flex-direction: column;
      }

      .popout-header {
        display: flex;
        align-items: center;
        padding: var(--space-sm) var(--space-md);
        border-bottom: 1px solid var(--border-glass);
        background: var(--bg-glass);
        flex-shrink: 0;
      }

      .popout-header .app-name {
        font-weight: 600;
        font-size: var(--text-md);
        color: var(--t-primary);
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .popout-close {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-md);
        transition: all 0.2s ease;
      }

      .popout-close:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .popout-body {
        flex: 1;
        overflow: auto;
      }

      /* Anchor navigation links */
      .anchor-nav {
        display: flex;
        gap: var(--space-md);
        margin-bottom: var(--space-lg);
      }

      .anchor-link {
        color: var(--accent-secondary);
        font-size: var(--text-sm);
        font-weight: 500;
        cursor: pointer;
        text-decoration: none;
        padding: 4px 0;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;
      }

      .anchor-link:hover {
        border-bottom-color: var(--accent-secondary);
      }
    `,
  ];

  @property({ type: String })
  photonName = '';

  @property({ type: String })
  photonIcon = '';

  @state()
  private _poppedOut = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._handleKeydown);
  }

  private _handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._poppedOut) {
      this._poppedOut = false;
    }
  };

  render() {
    return html`
      ${this._poppedOut ? this._renderPopout() : ''}

      <div class="app-toolbar">
        <button class="fullscreen-btn" @click=${() => (this._poppedOut = true)} title="Full screen">
          ⛶
        </button>
      </div>

      <div class="app-viewport">
        <slot name="app"></slot>
      </div>

      <div class="scroll-hint">↓ scroll down for methods, prompts & resources</div>

      <div class="below-fold">
        <div class="anchor-nav" id="methods">
          <span class="anchor-link" @click=${() => this._scrollTo('methods')}>Methods</span>
          <span class="anchor-link" @click=${() => this._scrollTo('prompts')}>Prompts</span>
          <span class="anchor-link" @click=${() => this._scrollTo('resources')}>Resources</span>
        </div>
        <slot name="below-fold"></slot>
      </div>
    `;
  }

  private _renderPopout() {
    return html`
      <div class="popout-overlay">
        <div class="popout-header">
          <span class="app-name"
            >${this.photonIcon ? html`${this.photonIcon} ` : ''}${this.photonName}</span
          >
          <button class="popout-close" @click=${() => (this._poppedOut = false)}>
            ✕ Close <kbd>Esc</kbd>
          </button>
        </div>
        <div class="popout-body">
          <slot name="popout"></slot>
        </div>
      </div>
    `;
  }

  private _scrollTo(id: string) {
    const el = this.shadowRoot?.getElementById(id) || this.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: 'smooth' });
  }
}
