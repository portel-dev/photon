import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, buttons } from '../styles/index.js';
import { shieldCheck, xMark, check, warning } from '../icons.js';

export interface ApprovalItem {
  id: string;
  photon: string;
  method: string;
  message: string;
  preview?: unknown;
  destructive?: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
}

@customElement('pending-approvals')
export class PendingApprovals extends LitElement {
  static styles = [
    theme,
    buttons,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        color: var(--t-primary);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-sm) var(--space-md);
        border-bottom: 1px solid var(--t-border);
      }

      .header-title {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        font-weight: 600;
        font-size: var(--text-sm);
      }

      .close-btn {
        background: none;
        border: none;
        color: var(--t-secondary);
        cursor: pointer;
        padding: var(--space-xs);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
      }

      .close-btn:hover {
        background: var(--t-hover);
      }

      .content {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-sm);
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-xl);
        text-align: center;
        color: var(--t-secondary);
      }

      .empty svg {
        opacity: 0.4;
        margin-bottom: var(--space-sm);
        width: 32px;
        height: 32px;
      }

      .approval-card {
        border: 1px solid var(--t-border);
        border-radius: var(--radius-md);
        padding: var(--space-sm) var(--space-md);
        margin-bottom: var(--space-sm);
        background: var(--t-surface);
      }

      .approval-card.destructive {
        border-color: hsl(0, 60%, 50%);
      }

      .approval-meta {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        font-size: var(--text-xs);
        color: var(--t-secondary);
        margin-bottom: var(--space-xs);
      }

      .approval-message {
        font-size: var(--text-sm);
        margin-bottom: var(--space-sm);
      }

      .preview {
        font-size: var(--text-xs);
        color: var(--t-secondary);
        background: var(--t-bg);
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-sm);
        margin-bottom: var(--space-sm);
        max-height: 80px;
        overflow-y: auto;
        font-family: var(--font-mono);
        white-space: pre-wrap;
      }

      .expiry {
        font-size: var(--text-xs);
        color: var(--t-secondary);
      }

      .actions {
        display: flex;
        gap: var(--space-xs);
        margin-top: var(--space-sm);
      }

      .btn {
        flex: 1;
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--t-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-xs);
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-xs);
        transition: all 0.15s;
      }

      .btn-approve {
        background: hsl(142, 60%, 45%);
        color: white;
        border-color: hsl(142, 60%, 40%);
      }

      .btn-approve:hover {
        background: hsl(142, 60%, 40%);
      }

      .btn-reject {
        background: var(--t-surface);
        color: var(--t-primary);
      }

      .btn-reject:hover {
        background: var(--t-hover);
      }

      .destructive-label {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        color: hsl(0, 70%, 55%);
        font-size: var(--text-2xs);
        font-weight: 600;
      }
    `,
  ];

  @property({ type: Array })
  approvals: ApprovalItem[] = [];

  @state()
  private _resolving = new Set<string>();

  render() {
    return html`
      <div class="header">
        <span class="header-title">${shieldCheck} Pending Approvals</span>
        <button
          class="close-btn"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}
          aria-label="Close"
        >
          ${xMark}
        </button>
      </div>

      <div class="content">
        ${this.approvals.length === 0
          ? html`
              <div class="empty">
                ${shieldCheck}
                <div>No pending approvals</div>
              </div>
            `
          : this.approvals.map((a) => this._renderApproval(a))}
      </div>
    `;
  }

  private _renderApproval(approval: ApprovalItem) {
    const isResolving = this._resolving.has(approval.id);
    const timeLeft = this._formatTimeLeft(approval.expiresAt);

    return html`
      <div class="approval-card ${approval.destructive ? 'destructive' : ''}">
        <div class="approval-meta">
          <span>${approval.photon}.${approval.method}</span>
          ${approval.destructive
            ? html`<span class="destructive-label">${warning} destructive</span>`
            : nothing}
        </div>
        <div class="approval-message">${approval.message}</div>
        ${approval.preview
          ? html`<div class="preview">
              ${typeof approval.preview === 'string'
                ? approval.preview
                : JSON.stringify(approval.preview, null, 2)}
            </div>`
          : nothing}
        <div class="expiry">Expires ${timeLeft}</div>
        <div class="actions">
          <button
            class="btn btn-reject"
            ?disabled=${isResolving}
            @click=${() => this._respond(approval, false)}
          >
            ${xMark} Reject
          </button>
          <button
            class="btn btn-approve"
            ?disabled=${isResolving}
            @click=${() => this._respond(approval, true)}
          >
            ${check} Approve
          </button>
        </div>
      </div>
    `;
  }

  private _respond(approval: ApprovalItem, approved: boolean) {
    this._resolving.add(approval.id);
    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent('approval-response', {
        detail: { approvalId: approval.id, photon: approval.photon, approved },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _formatTimeLeft(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `in ${hours}h ${minutes}m`;
    return `in ${minutes}m`;
  }
}
