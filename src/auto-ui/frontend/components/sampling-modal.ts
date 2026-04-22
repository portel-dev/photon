/**
 * Sampling modal — human-in-the-loop LLM for Beam.
 *
 * ──────────────────────────────────────────────────────────────────────
 * The idea
 * ──────────────────────────────────────────────────────────────────────
 * MCP's `sampling/createMessage` lets a server ask the client's LLM to
 * generate text. The normal path assumes the client is an agent
 * (Claude Desktop, Cursor, Claude Code) with a model behind it. Beam
 * is a browser UI — no model. But there's a human sitting at it.
 *
 * Instead of requiring Beam to wire up an external LLM endpoint, this
 * modal routes the sampling request to the human: show the prompt,
 * take their response, return it as the assistant message. The
 * person watching what AI is doing IS the LLM for that turn.
 *
 * That turns `this.sample(...)` into a "please draft this for me"
 * primitive any photon can use, with the human as the on-demand
 * generator — perfect for Beam's role as the fine-tuning surface
 * between agents and outcomes.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Wire-in from beam-app
 * ──────────────────────────────────────────────────────────────────────
 *
 *   import { openSamplingModal } from './components/sampling-modal.js';
 *
 *   mcpClient.setRequestHandler('sampling/createMessage', async (params) => {
 *     const text = await openSamplingModal(params);
 *     return {
 *       role: 'assistant',
 *       content: { type: 'text', text },
 *       model: 'human@beam',
 *       stopReason: 'endTurn',
 *     };
 *   });
 *
 * The handler never resolves with a null — cancelling the modal
 * rejects the handler so the server's `server.createMessage()`
 * promise rejects cleanly, and the photon's `this.sample()` falls
 * through to its try/catch (or the default fallback path the photon
 * author wired up).
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Lit component style imports — best-effort, optional to keep the
// modal self-contained if the style modules aren't available at
// import time in certain test environments.
import { theme, buttons, forms } from '../styles/index.js';

// MCP SamplingMessage shape — trimmed to the fields the modal cares
// about. The full spec allows image/audio content blocks; we show a
// short placeholder for non-text content and let the human decide
// whether/how to respond.
interface TextContent {
  type: 'text';
  text: string;
}
interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}
interface AudioContent {
  type: 'audio';
  data: string;
  mimeType: string;
}
type SamplingContent = TextContent | ImageContent | AudioContent;

interface SamplingMessage {
  role: 'user' | 'assistant';
  content: SamplingContent;
}

/** MCP `sampling/createMessage` params passed to the handler. */
interface SamplingRequestParams {
  messages: SamplingMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  modelPreferences?: {
    hints?: Array<{ name: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };
  stopSequences?: string[];
  includeContext?: 'none' | 'thisServer' | 'allServers';
  _meta?: {
    /** Photon identity to display in the modal header, if provided. */
    photonName?: string;
    toolName?: string;
  };
}

@customElement('sampling-modal')
export class SamplingModal extends LitElement {
  @property({ type: Object }) request: SamplingRequestParams | null = null;

  @state() private response = '';
  @state() private submitting = false;

  private resolver: ((text: string) => void) | null = null;
  private rejecter: ((err: Error) => void) | null = null;

  static styles = [
    theme,
    buttons,
    forms,
    css`
      :host {
        display: contents;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
      }

      .modal {
        background: var(--color-surface, #fff);
        border-radius: 8px;
        padding: 20px;
        max-width: 680px;
        width: 90vw;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      h2 {
        margin: 0;
        font-size: 18px;
      }

      .subtitle {
        color: var(--color-text-muted, #666);
        font-size: 13px;
      }

      .message-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--color-border, #eee);
        border-radius: 6px;
        padding: 8px;
        background: var(--color-surface-alt, #fafafa);
      }

      .msg {
        font-size: 13px;
        line-height: 1.4;
      }

      .role {
        font-weight: 600;
        text-transform: uppercase;
        font-size: 11px;
        color: var(--color-text-muted, #888);
        margin-right: 6px;
      }

      .system {
        padding: 6px 8px;
        background: var(--color-info-bg, #eef4ff);
        border-left: 3px solid var(--color-info, #4a90e2);
        font-size: 13px;
        border-radius: 4px;
      }

      textarea {
        width: 100%;
        min-height: 140px;
        padding: 8px;
        font: inherit;
        border: 1px solid var(--color-border, #ccc);
        border-radius: 4px;
        resize: vertical;
        box-sizing: border-box;
      }

      .meta {
        font-size: 12px;
        color: var(--color-text-muted, #888);
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }

      .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 4px;
      }
    `,
  ];

  // Public: called by openSamplingModal(). Stores the promise
  // callbacks so submit/cancel can resolve/reject from UI events.
  beginRequest(
    request: SamplingRequestParams,
    resolve: (text: string) => void,
    reject: (err: Error) => void
  ): void {
    this.request = request;
    this.response = '';
    this.submitting = false;
    this.resolver = resolve;
    this.rejecter = reject;
    this.requestUpdate();
  }

  private handleInput(e: Event): void {
    this.response = (e.target as HTMLTextAreaElement).value;
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Cmd/Ctrl + Enter submits — standard text-area shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    }
  }

  private submit(): void {
    if (!this.response.trim() || this.submitting) return;
    this.submitting = true;
    const text = this.response;
    const resolve = this.resolver;
    this.teardown();
    resolve?.(text);
  }

  private cancel(): void {
    const reject = this.rejecter;
    this.teardown();
    reject?.(new Error('User cancelled sampling request'));
  }

  private teardown(): void {
    this.resolver = null;
    this.rejecter = null;
    this.request = null;
    this.response = '';
    this.submitting = false;
  }

  private renderContent(content: SamplingContent) {
    if (content.type === 'text') {
      return html`<span>${content.text}</span>`;
    }
    if (content.type === 'image') {
      return html`<span class="subtitle">[image: ${content.mimeType}]</span>`;
    }
    if (content.type === 'audio') {
      return html`<span class="subtitle">[audio: ${content.mimeType}]</span>`;
    }
    return html`<span class="subtitle">[unknown content]</span>`;
  }

  render() {
    if (!this.request) return nothing;
    const req = this.request;
    const photon = req._meta?.photonName;
    const tool = req._meta?.toolName;
    const title = photon
      ? `${photon} wants you to generate text`
      : 'A photon wants you to generate text';

    return html`
      <div
        class="backdrop"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.cancel();
        }}
      >
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          @keydown=${(e: KeyboardEvent) => this.handleKeydown(e)}
        >
          <h2>${title}</h2>
          ${tool
            ? html`<div class="subtitle">From <code>${tool}</code>. Respond as the assistant.</div>`
            : html`<div class="subtitle">
                Respond as the assistant. Your text becomes the sampling result.
              </div>`}
          ${req.systemPrompt
            ? html`<div class="system"><strong>System:</strong> ${req.systemPrompt}</div>`
            : nothing}
          ${req.messages?.length
            ? html`
                <div class="message-list">
                  ${req.messages.map(
                    (m) => html`
                      <div class="msg">
                        <span class="role">${m.role}</span>${this.renderContent(m.content)}
                      </div>
                    `
                  )}
                </div>
              `
            : nothing}

          <textarea
            .value=${this.response}
            @input=${(e: Event) => this.handleInput(e)}
            placeholder="Type your response here. Cmd/Ctrl+Enter to submit, Esc to cancel."
            autofocus
          ></textarea>

          <div class="meta">
            ${req.maxTokens ? html`<span>max tokens: ${req.maxTokens}</span>` : nothing}
            ${req.modelPreferences?.hints?.length
              ? html`<span
                  >hints: ${req.modelPreferences.hints.map((h) => h.name).join(', ')}</span
                >`
              : nothing}
            ${req.stopSequences?.length
              ? html`<span>stops: ${req.stopSequences.join(', ')}</span>`
              : nothing}
          </div>

          <div class="actions">
            <button class="btn btn-secondary" @click=${() => this.cancel()}>Cancel</button>
            <button
              class="btn btn-primary"
              ?disabled=${!this.response.trim() || this.submitting}
              @click=${() => this.submit()}
            >
              ${this.submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sampling-modal': SamplingModal;
  }
}

/**
 * Open a sampling modal and resolve with the user's typed response.
 * Rejects if the user cancels (Escape, clicks outside, or Cancel).
 *
 * The caller wires this into `mcpClient.setRequestHandler(
 * 'sampling/createMessage', openSamplingModal)` at beam-app init.
 * Lazily creates a single modal element and reuses it; concurrent
 * sampling requests serialize on it (the second one waits until the
 * first resolves or cancels — same pattern the elicitation modal uses).
 */
let modalEl: SamplingModal | null = null;
let inFlight: Promise<void> = Promise.resolve();

export async function openSamplingModal(params: SamplingRequestParams): Promise<string> {
  // Serialize: if another sampling request is already on screen, wait
  // for it to finish before showing this one.
  const prev = inFlight;

  let release!: () => void;
  inFlight = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await prev;

    if (!modalEl) {
      modalEl = document.createElement('sampling-modal');
      document.body.appendChild(modalEl);
    }

    return await new Promise<string>((resolve, reject) => {
      modalEl!.beginRequest(params, resolve, reject);
    });
  } finally {
    release();
  }
}
