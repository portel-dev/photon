/**
 * Daemon Panel — Beam UI surface mirroring `photon ps`.
 *
 * Fetches `/api/daemon/ps` and renders four tables: active schedules,
 * declared-but-dormant schedules, webhook routes, and active sessions.
 * Per-row action buttons drive the enable/disable/pause/resume POST
 * endpoints. A History drawer per active-schedule row pulls from
 * `/api/daemon/history`.
 *
 * Refresh strategy: polling every 3s while mounted. SSE auto-refresh
 * (photon-reloaded / job-fired) is a follow-up.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { theme, forms } from '../styles/index.js';
import { showToast } from './toast-manager.js';
import { formatLabel } from '../utils/format-label.js';

interface ActiveRow {
  id: string;
  photon: string;
  method: string;
  cron: string;
  nextRun: number | null;
  lastRun: number | null;
  runCount: number;
  workingDir?: string;
  createdBy?: string;
}

interface DeclaredRow {
  key: string;
  photon: string;
  method: string;
  cron: string;
  photonPath: string;
  workingDir?: string;
  active: boolean;
}

interface WebhookRow {
  photon: string;
  route: string;
  method: string;
  workingDir?: string;
}

interface SessionRow {
  photon: string;
  workingDir?: string;
  key: string;
  instanceCount: number;
}

interface PsSnapshot {
  active: ActiveRow[];
  declared: DeclaredRow[];
  webhooks: WebhookRow[];
  sessions: SessionRow[];
}

interface ExecutionRow {
  ts: number;
  jobId: string;
  method: string;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  outputPreview?: string;
}

interface HistoryResponse {
  photon: string;
  method: string;
  entries: ExecutionRow[];
}

const POLL_INTERVAL_MS = 3000;

function formatWhen(ts: number | null | undefined): string {
  if (!ts) return '-';
  const delta = ts - Date.now();
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  const hrs = Math.round(mins / 60);
  if (abs < 60_000) return delta < 0 ? 'just now' : 'in <1m';
  if (mins < 90) return delta < 0 ? `${mins}m ago` : `in ${mins}m`;
  if (hrs < 48) return delta < 0 ? `${hrs}h ago` : `in ${hrs}h`;
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
}

function tilde(p: string | undefined): string {
  if (!p) return '-';
  // Client side can't read $HOME; strip leading path down to its leaf + parent.
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '…/' + parts.slice(-2).join('/');
}

@customElement('daemon-panel')
export class DaemonPanel extends LitElement {
  static styles = [
    theme,
    forms,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
      }

      h1 {
        font-size: 1.5rem;
        margin: 0 0 var(--space-sm) 0;
      }

      h2 {
        font-size: 1rem;
        margin: var(--space-lg) 0 var(--space-xs) 0;
        color: var(--t-primary);
      }

      p.hint {
        color: var(--t-muted);
        font-size: 0.85rem;
        margin: 0 0 var(--space-md) 0;
      }

      .refresh-bar {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        margin-bottom: var(--space-md);
      }

      button.refresh {
        background: var(--surface-secondary, #222);
        color: var(--t-primary);
        border: 1px solid var(--border, #333);
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
      }
      button.refresh:hover {
        background: var(--surface-hover, #2a2a2a);
      }

      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--border, #333);
        border-radius: 4px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }

      th,
      td {
        padding: 6px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border, #2a2a2a);
      }

      th {
        background: var(--surface-secondary, #1a1a1a);
        font-weight: 600;
        color: var(--t-muted);
      }

      tr.empty td {
        text-align: center;
        color: var(--t-muted);
        padding: var(--space-md);
      }

      .actions {
        display: flex;
        gap: 4px;
      }

      .actions button {
        font-size: 0.75rem;
        padding: 2px 8px;
        border: 1px solid var(--border, #333);
        background: transparent;
        color: var(--t-primary);
        cursor: pointer;
        border-radius: 3px;
      }

      .actions button:hover {
        background: var(--surface-hover, #2a2a2a);
      }

      .status-success {
        color: var(--success, #4ade80);
      }
      .status-error {
        color: var(--danger, #f87171);
      }
      .status-timeout {
        color: var(--warning, #fbbf24);
      }

      .error {
        background: var(--danger-bg, #3a1b1b);
        color: var(--danger, #f87171);
        padding: var(--space-sm);
        border-radius: 4px;
        font-size: 0.85rem;
        margin-bottom: var(--space-md);
      }

      .drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(520px, 100vw);
        background: var(--surface-primary, #111);
        border-left: 1px solid var(--border, #333);
        padding: var(--space-md);
        overflow-y: auto;
        z-index: 9999;
        box-shadow: -4px 0 12px rgba(0, 0, 0, 0.4);
      }

      .drawer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-md);
      }

      .drawer-header button {
        background: transparent;
        border: 1px solid var(--border, #333);
        color: var(--t-primary);
        padding: 4px 10px;
        cursor: pointer;
        border-radius: 3px;
      }
    `,
  ];

  @state() private _snap: PsSnapshot | null = null;
  @state() private _error: string | null = null;
  @state() private _loading = false;
  @state() private _history: HistoryResponse | null = null;
  @state() private _historyLoading = false;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    void this._refresh();
    this._pollTimer = setInterval(() => void this._refresh(true), POLL_INTERVAL_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _refresh(silent = false): Promise<void> {
    if (!silent) this._loading = true;
    try {
      const res = await fetch('/api/daemon/ps', {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        this._error = err.error || `HTTP ${res.status}`;
        return;
      }
      this._snap = (await res.json()) as PsSnapshot;
      this._error = null;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _scheduleAction(
    action: 'enable' | 'disable' | 'pause' | 'resume',
    photon: string,
    method: string
  ): Promise<void> {
    try {
      const res = await fetch(`/api/daemon/schedules/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Photon-Request': '1',
        },
        body: JSON.stringify({ photon, method }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error || `Action "${action}" failed`, 'error');
        return;
      }
      showToast(`${action}d ${photon}:${method}`, 'success');
      await this._refresh(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  private async _openHistory(photon: string, method: string): Promise<void> {
    this._history = { photon, method, entries: [] };
    this._historyLoading = true;
    try {
      const res = await fetch(
        `/api/daemon/history?photon=${encodeURIComponent(photon)}&method=${encodeURIComponent(
          method
        )}&limit=50`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        showToast(err.error || `History load failed`, 'error');
        this._history = null;
        return;
      }
      this._history = (await res.json()) as HistoryResponse;
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
      this._history = null;
    } finally {
      this._historyLoading = false;
    }
  }

  private _closeHistory(): void {
    this._history = null;
  }

  private _renderActive() {
    const rows = this._snap?.active ?? [];
    return html`
      <h2>Active schedules (${rows.length})</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Photon</th>
              <th>Method</th>
              <th>Cron</th>
              <th>Next run</th>
              <th>Last run</th>
              <th>Runs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr class="empty">
                  <td colspan="8">no active schedules</td>
                </tr>`
              : rows.map(
                  (r) => html`
                    <tr>
                      <td>${tilde(r.workingDir)}</td>
                      <td>${r.photon}</td>
                      <td>${formatLabel(r.method)}</td>
                      <td><code>${r.cron}</code></td>
                      <td>${formatWhen(r.nextRun)}</td>
                      <td>${formatWhen(r.lastRun)}</td>
                      <td>${r.runCount}</td>
                      <td class="actions">
                        <button @click=${() => this._openHistory(r.photon, r.method)}>
                          History
                        </button>
                        <button @click=${() => this._scheduleAction('pause', r.photon, r.method)}>
                          Pause
                        </button>
                        <button @click=${() => this._scheduleAction('disable', r.photon, r.method)}>
                          Disable
                        </button>
                      </td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderDeclared() {
    const rows = (this._snap?.declared ?? []).filter((d) => !d.active);
    return html`
      <h2>Declared but not enrolled (${rows.length})</h2>
      <p class="hint">
        These photons declare <code>@scheduled</code> methods that haven't been enrolled yet.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Photon</th>
              <th>Method</th>
              <th>Cron</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr class="empty">
                  <td colspan="5">no dormant declarations</td>
                </tr>`
              : rows.map(
                  (r) => html`
                    <tr>
                      <td>${tilde(r.workingDir)}</td>
                      <td>${r.photon}</td>
                      <td>${formatLabel(r.method)}</td>
                      <td><code>${r.cron}</code></td>
                      <td class="actions">
                        <button @click=${() => this._scheduleAction('enable', r.photon, r.method)}>
                          Enable
                        </button>
                      </td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderWebhooks() {
    const rows = this._snap?.webhooks ?? [];
    return html`
      <h2>Webhooks (${rows.length})</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Photon</th>
              <th>Route</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr class="empty">
                  <td colspan="4">no webhook routes</td>
                </tr>`
              : rows.map(
                  (r) => html`
                    <tr>
                      <td>${tilde(r.workingDir)}</td>
                      <td>${r.photon}</td>
                      <td><code>${r.route}</code></td>
                      <td>${formatLabel(r.method)}</td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderSessions() {
    const rows = this._snap?.sessions ?? [];
    return html`
      <h2>Active sessions (${rows.length})</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Photon</th>
              <th>Instances</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr class="empty">
                  <td colspan="3">no loaded sessions</td>
                </tr>`
              : rows.map(
                  (r) => html`
                    <tr>
                      <td>${tilde(r.workingDir)}</td>
                      <td>${r.photon}</td>
                      <td>${r.instanceCount}</td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderHistoryDrawer() {
    if (!this._history) return '';
    const { photon, method, entries } = this._history;
    return html`
      <div class="drawer">
        <div class="drawer-header">
          <h2>History for ${photon}:${method}</h2>
          <button @click=${() => this._closeHistory()}>Close</button>
        </div>
        ${this._historyLoading
          ? html`<p class="hint">Loading…</p>`
          : entries.length === 0
            ? html`<p class="hint">No firings recorded.</p>`
            : html`
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${entries.map(
                        (e) => html`
                          <tr>
                            <td>${formatWhen(e.ts)}</td>
                            <td class="status-${e.status}">${e.status.toUpperCase()}</td>
                            <td>${e.durationMs}ms</td>
                            <td>
                              ${e.status === 'success'
                                ? (e.outputPreview ?? '').slice(0, 120)
                                : (e.errorMessage ?? '').slice(0, 120)}
                            </td>
                          </tr>
                        `
                      )}
                    </tbody>
                  </table>
                </div>
              `}
      </div>
    `;
  }

  render() {
    return html`
      <h1>Daemon</h1>
      <p class="hint">
        Observability for scheduled work, webhook routes, and loaded sessions. Mirrors
        <code>photon ps</code>.
      </p>

      <div class="refresh-bar">
        <button class="refresh" @click=${() => this._refresh()} ?disabled=${this._loading}>
          ${this._loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <span class="hint">auto-refresh every ${POLL_INTERVAL_MS / 1000}s</span>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : ''} ${this._renderActive()}
      ${this._renderDeclared()} ${this._renderWebhooks()} ${this._renderSessions()}
      ${this._renderHistoryDrawer()}
    `;
  }
}
