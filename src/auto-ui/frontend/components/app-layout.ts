import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

/**
 * App-first layout for App photons.
 *
 * The app UI fills the viewport. A labeled divider hints that methods
 * are available below. Fullscreen button lives in the context bar (external).
 */
@customElement('app-layout')
export class AppLayout extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      .app-viewport {
        min-height: calc(100vh - 140px);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .scroll-divider {
        position: relative;
        text-align: center;
        margin: var(--space-lg) 0;
      }

      .scroll-divider::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1px;
        background: var(--border-glass);
      }

      .scroll-divider span {
        position: relative;
        display: inline-block;
        padding: 0 var(--space-md);
        background: var(--bg-app, #0a0a12);
        color: var(--t-muted);
        font-size: var(--text-sm);
        opacity: 0.6;
      }

      .below-fold {
        padding-top: var(--space-lg);
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

      /* Instance selector bar */
      .instance-bar {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: 6px var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md) var(--radius-md) 0 0;
        border-bottom: none;
      }

      .instance-label {
        font-size: var(--text-xs);
        color: var(--t-muted);
        white-space: nowrap;
      }

      .instance-select {
        flex: 1;
        max-width: 220px;
        background: var(--bg-glass-strong);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--t-primary);
        font-size: var(--text-sm);
        padding: 3px 8px;
        cursor: pointer;
        outline: none;
      }

      .instance-select:hover,
      .instance-select:focus {
        border-color: var(--accent-primary);
      }

      .instance-bar ~ .app-viewport {
        border-radius: 0 0 var(--radius-md) var(--radius-md);
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

  @property({ type: Array })
  instances: string[] = [];

  @property({ type: String })
  currentInstance = '';

  @property({ type: String })
  selectorMode: 'auto' | 'manual' = 'auto';

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

  private _handleInstanceChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent('instance-change', { detail: { instance: value }, bubbles: true, composed: true }));
  }

  render() {
    const showInstanceBar = this.instances.length > 0;
    return html`
      ${this._poppedOut ? this._renderPopout() : ''}

      ${showInstanceBar ? html`
        <div class="instance-bar">
          <span class="instance-label">Board</span>
          <select class="instance-select" @change=${this._handleInstanceChange}>
            <option value="__auto__" ?selected=${this.selectorMode === 'auto'}>Auto (most recent)</option>
            ${this.instances.map(name => html`
              <option value=${name} ?selected=${this.selectorMode === 'manual' && name === this.currentInstance}>${name}</option>
            `)}
          </select>
        </div>
      ` : ''}

      <div class="app-viewport">
        <slot name="app"></slot>
      </div>

      <div class="scroll-divider">
        <span>&darr; scroll down for methods, prompts &amp; resources</span>
      </div>

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

  togglePopout() {
    this._poppedOut = !this._poppedOut;
  }

  private _scrollTo(id: string) {
    const el = this.shadowRoot?.getElementById(id) || this.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: 'smooth' });
  }
}
