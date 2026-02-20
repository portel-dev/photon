import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, buttons } from '../styles/index.js';

@customElement('fork-dialog')
export class ForkDialog extends LitElement {
  static styles = [
    theme,
    buttons,
    css`
      :host {
        display: flex;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 10000;
        align-items: center;
        justify-content: center;
      }

      .modal-content {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-xl);
        max-width: 480px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      }

      h3 {
        margin: 0 0 var(--space-xs) 0;
        font-size: var(--text-xl);
        font-weight: 600;
        color: var(--t-primary);
      }

      .origin-info {
        font-size: var(--text-sm);
        color: var(--t-secondary);
        margin-bottom: var(--space-lg);
      }

      .target-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }

      .target-card {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-md);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition:
          border-color 0.15s,
          background 0.15s;
      }

      .target-card:hover {
        border-color: var(--color-primary);
        background: var(--bg-surface);
      }

      .target-card.selected {
        border-color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      }

      .target-radio {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--border-glass);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .target-card.selected .target-radio {
        border-color: var(--color-primary);
      }

      .target-card.selected .target-radio::after {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-primary);
      }

      .target-info {
        flex: 1;
        min-width: 0;
      }

      .target-name {
        font-weight: 500;
        color: var(--t-primary);
      }

      .target-repo {
        font-size: var(--text-sm);
        color: var(--t-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .target-icon {
        font-size: 1.2em;
        flex-shrink: 0;
      }

      .create-repo-input {
        margin-top: var(--space-sm);
        width: 100%;
        padding: var(--space-sm) var(--space-md);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--t-primary);
        font-size: var(--text-sm);
        box-sizing: border-box;
      }

      .create-repo-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .actions {
        display: flex;
        gap: var(--space-sm);
        justify-content: flex-end;
        margin-top: var(--space-lg);
      }
    `,
  ];

  @property() photonName = '';
  @property() originRepo = '';
  @property({ type: Array }) targets: Array<{
    name: string;
    repo: string;
    sourceType: string;
  }> = [];

  @state() private _selectedTarget = 'local';
  @state() private _newRepoName = '';

  render() {
    return html`
      <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
        <h3>Fork ${this.photonName}</h3>
        ${this.originRepo ? html`<div class="origin-info">From ${this.originRepo}</div>` : ''}

        <div class="target-list">
          ${this.targets.map(
            (t) => html`
              <div
                class="target-card ${this._selectedTarget === t.repo ? 'selected' : ''}"
                @click=${() => {
                  this._selectedTarget = t.repo;
                }}
              >
                <div class="target-radio"></div>
                <div class="target-info">
                  <div class="target-name">${t.name}</div>
                  <div class="target-repo">${t.repo}</div>
                </div>
              </div>
            `
          )}

          <div
            class="target-card ${this._selectedTarget === 'create' ? 'selected' : ''}"
            @click=${() => {
              this._selectedTarget = 'create';
            }}
          >
            <div class="target-radio"></div>
            <div class="target-info">
              <div class="target-name">Create new repository</div>
              <div class="target-repo">Push to a new GitHub repository</div>
              ${this._selectedTarget === 'create'
                ? html`<input
                    class="create-repo-input"
                    type="text"
                    placeholder="owner/repo-name"
                    .value=${this._newRepoName}
                    @input=${(e: Event) => {
                      this._newRepoName = (e.target as HTMLInputElement).value;
                    }}
                    @click=${(e: Event) => e.stopPropagation()}
                  />`
                : ''}
            </div>
          </div>

          <div
            class="target-card ${this._selectedTarget === 'local' ? 'selected' : ''}"
            @click=${() => {
              this._selectedTarget = 'local';
            }}
          >
            <div class="target-radio"></div>
            <div class="target-info">
              <div class="target-name">Local only</div>
              <div class="target-repo">Remove marketplace tracking, keep file as-is</div>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn" @click=${this._cancel}>Cancel</button>
          <button
            class="btn btn-primary"
            ?disabled=${this._selectedTarget === 'create' && !this._newRepoName.trim()}
            @click=${this._confirm}
          >
            Fork
          </button>
        </div>
      </div>
    `;
  }

  private _confirm() {
    let target: string;
    if (this._selectedTarget === 'create') {
      target = `create:${this._newRepoName.trim()}`;
    } else {
      target = this._selectedTarget;
    }

    this.dispatchEvent(
      new CustomEvent('fork-confirm', {
        detail: { target },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _cancel() {
    this.dispatchEvent(
      new CustomEvent('fork-cancel', {
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fork-dialog': ForkDialog;
  }
}
