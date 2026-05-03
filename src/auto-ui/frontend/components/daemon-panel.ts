/**
 * Pulse panel — heartbeat dashboard for the daemon. Mirrors `photon ps`.
 *
 * Sections: a chip strip of loaded photons up top, then schedules,
 * webhooks, and pending (declared-but-dormant) schedules. Schedules and
 * webhooks group rows by working directory. Per-row icon buttons drive
 * enable/disable/pause/resume; a History drawer pulls from
 * `/api/daemon/history`.
 *
 * Polls `/api/daemon/ps` every 3s while mounted.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { theme, forms } from '../styles/index.js';
import { showToast } from './toast-manager.js';

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

function isImminent(ts: number | null | undefined): boolean {
  if (!ts) return false;
  const delta = ts - Date.now();
  return delta >= 0 && delta < 60_000;
}

function groupByLocation<T extends { workingDir?: string }>(rows: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.workingDir ?? '';
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Convert common cron strings to human-readable form. Falls back to the raw
 * string for patterns we don't recognise so power users still see the truth.
 */
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function formatHour(h: number): string {
  return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
}

function describeWeekdays(spec: string): string | null {
  if (spec === '*') return 'every day';
  if (spec === '1-5') return 'weekdays';
  if (spec === '0,6' || spec === '6,0') return 'weekends';
  if (/^\d$/.test(spec)) {
    const n = parseInt(spec, 10);
    if (n >= 0 && n <= 6) return WEEKDAY_NAMES[n];
  }
  return null;
}

/**
 * Convert common cron strings to human-readable form. Falls back to the raw
 * string for patterns we don't recognise so power users still see the truth.
 */
function humanizeCron(cron: string): string {
  const trimmed = cron.trim();
  if (trimmed === '* * * * *') return 'Every minute';
  if (trimmed === '0 * * * *') return 'Hourly';
  if (trimmed === '0 0 * * *') return 'Daily at midnight';
  if (trimmed === '0 12 * * *') return 'Daily at noon';
  if (trimmed === '0 0 1 * *') return 'Monthly';

  // Step minutes: `*/5 * * * *` and `0/5 * * * *` (vixie-cron also accepts
  // start/step where start defaults to 0; both forms appear in the wild).
  let m = trimmed.match(/^(?:\*|0)\/(\d+) \* \* \* \*$/);
  if (m) return `Every ${m[1]} minutes`;

  // Step hours.
  m = trimmed.match(/^0 (?:\*|0)\/(\d+) \* \* \*$/);
  if (m) return `Every ${m[1]} hours`;

  // Daily at <h>: `0 <h> * * *`
  m = trimmed.match(/^0 (\d{1,2}) \* \* \*$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 0 && h <= 23) return `Daily at ${formatHour(h)}`;
  }

  // <weekday(s)> at <h>: `0 <h> * * <dow>` covers `0 8 * * 1-5` (weekdays at 8am),
  // `0 9 * * 0` (Sundays at 9am), `0 17 * * 0,6` (weekends at 5pm).
  m = trimmed.match(/^0 (\d{1,2}) \* \* ([0-9,-]+)$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const dayLabel = describeWeekdays(m[2]);
    if (h >= 0 && h <= 23 && dayLabel) {
      const cap = dayLabel[0].toUpperCase() + dayLabel.slice(1);
      return `${cap} at ${formatHour(h)}`;
    }
  }

  return trimmed;
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

      .pulse-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-md);
        margin-bottom: var(--space-xs);
      }

      h1 {
        font-size: 1.5rem;
        margin: 0;
        color: var(--t-primary);
      }

      p.hint {
        color: var(--t-muted);
        font-size: 0.85rem;
        margin: 0 0 var(--space-lg) 0;
      }

      button.refresh {
        background: var(--bg-glass);
        color: var(--t-primary);
        border: 1px solid var(--border-glass);
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.85rem;
        transition: all 0.15s ease;
      }
      button.refresh:hover {
        background: var(--bg-glass-strong);
        border-color: color-mix(in srgb, var(--accent-primary) 38%, var(--border-glass));
      }
      button.refresh:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      /* Section card */
      section.card {
        background: color-mix(in srgb, var(--bg-glass) 60%, transparent);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-md);
        margin-bottom: var(--space-md);
      }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-md);
        margin-bottom: var(--space-sm);
      }

      .section-title {
        margin: 0;
        font-family: 'Azeret Mono', var(--font-mono);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--t-primary);
        font-weight: 600;
        display: flex;
        align-items: baseline;
        gap: var(--space-xs);
      }

      .section-count {
        color: var(--t-muted);
        font-size: 0.7rem;
        font-weight: 500;
        letter-spacing: 0.04em;
      }

      .section-sub {
        color: var(--t-muted);
        font-size: 0.7rem;
        font-weight: 500;
        letter-spacing: 0.04em;
      }

      .section-hint {
        color: var(--t-muted);
        font-size: 0.78rem;
        margin: 0 0 var(--space-sm) 0;
      }

      .empty-line {
        color: var(--t-muted);
        font-size: 0.85rem;
        font-style: italic;
        margin: var(--space-xs) 0 0 0;
      }

      /* Tables */
      .table-wrap {
        overflow-x: auto;
      }

      table.grouped {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
      }

      table.grouped td {
        padding: 6px 8px;
        border-bottom: 1px solid color-mix(in srgb, var(--border-glass) 50%, transparent);
        vertical-align: middle;
        font-size: 0.85rem;
      }

      table.grouped tbody:last-child tr:last-child td {
        border-bottom: none;
      }

      table.grouped tbody tr:not(.group-header):hover td {
        background: color-mix(in srgb, var(--bg-glass) 60%, transparent);
      }

      /* Group header row (location) — separated by spacing + thin top rule */
      tr.group-header td {
        padding: var(--space-xl) 8px var(--space-xs) 8px;
        background: transparent;
        border-bottom: none;
        border-top: 1px solid var(--border-glass);
      }
      table.grouped tbody:first-child tr.group-header td {
        padding-top: var(--space-2xs);
        border-top: none;
      }
      .location-path {
        font-family: 'Azeret Mono', var(--font-mono);
        font-size: 0.72rem;
        color: var(--t-primary);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 600;
      }
      .location-meta {
        color: var(--t-muted);
        font-size: 0.7rem;
        margin-left: var(--space-sm);
        opacity: 0.7;
        text-transform: lowercase;
        font-weight: 400;
        letter-spacing: 0.02em;
      }

      /* Entity cell — status dot + photon.method */
      td.entity-cell {
        white-space: nowrap;
        width: 1%;
      }
      .entity-row {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
      }
      .status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--color-success);
        box-shadow: 0 0 5px color-mix(in srgb, var(--color-success) 50%, transparent);
        flex-shrink: 0;
      }
      .status-dot.dormant {
        background: var(--t-muted);
        box-shadow: none;
        opacity: 0.45;
      }
      .entity {
        font-family: 'Azeret Mono', var(--font-mono);
        font-size: 0.85rem;
        white-space: nowrap;
      }
      .entity .photon-part {
        color: var(--t-muted);
      }
      .entity .sep {
        color: var(--t-muted);
      }
      .entity .method-part {
        color: var(--t-primary);
        font-weight: 600;
      }

      /* Timing line */
      td.timing {
        color: var(--t-muted);
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
      }
      .timing .schedule {
        color: var(--t-primary);
      }
      .timing .timing-sep {
        margin: 0 var(--space-xs);
        opacity: 0.4;
      }
      .timing .imminent {
        color: var(--accent-primary);
      }

      /* Runs */
      td.runs {
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--t-primary);
        font-size: 0.82rem;
        white-space: nowrap;
        width: 1%;
      }
      .runs-label {
        color: var(--t-muted);
        margin-left: 4px;
        font-size: 0.72rem;
      }

      /* Webhook route cell */
      .route-cell {
        font-family: 'Azeret Mono', var(--font-mono);
        font-size: 0.83rem;
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        white-space: nowrap;
      }
      .route-photon {
        color: var(--t-muted);
      }
      .route-verb {
        color: var(--accent-secondary);
        font-weight: 600;
        font-size: 0.7rem;
        padding: 1px 5px;
        border-radius: var(--radius-xs);
        background: color-mix(in srgb, var(--accent-secondary) 12%, transparent);
        letter-spacing: 0.04em;
      }
      .route-path {
        color: var(--t-primary);
      }
      .route-arrow {
        color: var(--t-muted);
        opacity: 0.5;
        margin: 0 4px;
      }
      .route-handler {
        color: var(--t-primary);
        font-weight: 600;
      }

      /* Action icons */
      td.actions {
        text-align: right;
        white-space: nowrap;
        width: 1%;
      }
      .icon-bar {
        display: inline-flex;
        gap: 2px;
        justify-content: flex-end;
        opacity: 0.65;
        transition: opacity 0.15s ease;
      }
      tr:hover .icon-bar,
      .icon-bar:focus-within {
        opacity: 1;
      }
      .icon-btn svg {
        width: 14px;
        height: 14px;
      }
      .icon-btn {
        width: 26px;
        height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        color: var(--t-muted);
        border-radius: var(--radius-xs);
        cursor: pointer;
        padding: 0;
        transition: all 0.15s ease;
      }
      .icon-btn:hover {
        background: var(--bg-glass-strong);
        color: var(--t-primary);
        border-color: var(--border-glass);
      }
      .icon-btn.danger:hover {
        color: var(--color-error);
      }
      .icon-btn.primary {
        background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
        color: var(--accent-primary);
        border-color: color-mix(in srgb, var(--accent-primary) 30%, var(--border-glass));
      }
      .icon-btn.primary:hover {
        background: color-mix(in srgb, var(--accent-primary) 24%, transparent);
      }
      /* Loaded photons chip strip */
      .chip-strip {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
      }
      .chip {
        font-family: 'Azeret Mono', var(--font-mono);
        font-size: 0.78rem;
        background: color-mix(in srgb, var(--bg-glass) 70%, transparent);
        color: var(--t-primary);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-full);
        padding: 3px 10px 3px 8px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .chip.idle {
        color: var(--t-muted);
      }
      .chip-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-success);
        box-shadow: 0 0 4px color-mix(in srgb, var(--color-success) 40%, transparent);
      }
      .chip.idle .chip-dot {
        background: var(--t-muted);
        opacity: 0.4;
        box-shadow: none;
      }
      .conn-badge {
        background: var(--accent-primary);
        color: var(--bg-app);
        font-weight: 700;
        font-size: 0.66rem;
        padding: 1px 7px;
        border-radius: var(--radius-full);
        letter-spacing: 0.02em;
      }

      /* Status colors (history drawer) */
      .status-success {
        color: var(--color-success);
      }
      .status-error {
        color: var(--color-error);
      }
      .status-timeout {
        color: var(--color-warning);
      }

      .error {
        background: color-mix(in srgb, var(--color-error) 12%, transparent);
        color: var(--color-error);
        border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        font-size: 0.85rem;
        margin-bottom: var(--space-md);
      }

      /* History drawer */
      .drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(520px, 100vw);
        background: var(--bg-elevated, #111);
        border-left: 1px solid var(--border-glass);
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
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: 4px 10px;
        cursor: pointer;
        border-radius: var(--radius-xs);
      }
      .drawer table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 0.85rem;
      }
      .drawer th,
      .drawer td {
        padding: 8px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border-glass);
      }
      .drawer th {
        font-weight: 600;
        color: var(--t-muted);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
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

  private _sectionHead(title: string, count: number, sub?: string) {
    return html`
      <div class="section-head">
        <h2 class="section-title">
          ${title} ${count > 0 ? html`<span class="section-count">· ${count}</span>` : ''}
        </h2>
        ${sub ? html`<span class="section-sub">${sub}</span>` : ''}
      </div>
    `;
  }

  private _entity(photon: string, method: string, dormant = false) {
    return html`
      <span class="entity-row">
        <span class="status-dot ${dormant ? 'dormant' : ''}"></span>
        <span class="entity"
          ><span class="photon-part">${photon}</span><span class="sep">.</span
          ><span class="method-part">${method}</span></span
        >
      </span>
    `;
  }

  private _timingLine(cron: string, nextRun: number | null, lastRun: number | null) {
    const imminent = isImminent(nextRun);
    return html`
      <span class="schedule" title="${cron}">${humanizeCron(cron)}</span>
      <span class="timing-sep">·</span>
      <span class="${imminent ? 'imminent' : ''}">next ${formatWhen(nextRun)}</span>
      <span class="timing-sep">·</span>
      <span>last ${formatWhen(lastRun)}</span>
    `;
  }

  private _groupHeader(loc: string, count: number, label: string) {
    return html`
      <tr class="group-header">
        <td colspan="4">
          <span class="location-path" title="${loc || '(no working dir)'}">${tilde(loc)}</span>
          <span class="location-meta">${count} ${count === 1 ? label : label + 's'}</span>
        </td>
      </tr>
    `;
  }

  private _iconBtn(opts: {
    icon: 'history' | 'pause' | 'disable' | 'play';
    title: string;
    onClick: () => unknown;
    variant?: 'danger' | 'primary';
  }) {
    const cls = opts.variant ? `icon-btn ${opts.variant}` : 'icon-btn';
    return html`
      <button
        class="${cls}"
        title="${opts.title}"
        aria-label="${opts.title}"
        @click=${opts.onClick}
      >
        ${opts.icon === 'history'
          ? html`<svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l3 2" />
            </svg>`
          : opts.icon === 'pause'
            ? html`<svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>`
            : opts.icon === 'disable'
              ? html`<svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                  <line x1="12" y1="2" x2="12" y2="12" />
                </svg>`
              : html`<svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="6 3 20 12 6 21" />
                </svg>`}
      </button>
    `;
  }

  private _renderLoaded() {
    const rows = this._snap?.sessions ?? [];
    if (rows.length === 0) return '';
    const sorted = [...rows].sort((a, b) => a.photon.localeCompare(b.photon));
    const totalConn = sorted.reduce((acc, r) => acc + r.instanceCount, 0);
    const sub = `${totalConn} ${totalConn === 1 ? 'connection' : 'connections'}`;
    return html`
      <section class="card">
        ${this._sectionHead('Loaded photons', rows.length, sub)}
        <div class="chip-strip">
          ${sorted.map(
            (r) => html`
              <span
                class="chip ${r.instanceCount === 0 ? 'idle' : ''}"
                title="${r.workingDir ?? ''}"
              >
                <span class="chip-dot"></span>
                <span>${r.photon}</span>
                ${r.instanceCount > 0
                  ? html`<span class="conn-badge">${r.instanceCount}</span>`
                  : ''}
              </span>
            `
          )}
        </div>
      </section>
    `;
  }

  private _renderActive() {
    const rows = this._snap?.active ?? [];
    const groups = groupByLocation(rows);
    for (const [, list] of groups) {
      list.sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity));
    }
    return html`
      <section class="card">
        ${this._sectionHead('Schedules', rows.length)}
        ${rows.length === 0
          ? html`<p class="empty-line">No active schedules.</p>`
          : html`<div class="table-wrap">
              <table class="grouped">
                ${groups.map(
                  ([loc, items]) => html`
                    <tbody>
                      ${this._groupHeader(loc, items.length, 'schedule')}
                      ${items.map(
                        (r) => html`
                          <tr>
                            <td class="entity-cell">${this._entity(r.photon, r.method)}</td>
                            <td class="timing">
                              ${this._timingLine(r.cron, r.nextRun, r.lastRun)}
                            </td>
                            <td class="runs">
                              ${r.runCount.toLocaleString()}<span class="runs-label"
                                >${r.runCount === 1 ? 'run' : 'runs'}</span
                              >
                            </td>
                            <td class="actions">
                              <span class="icon-bar">
                                ${this._iconBtn({
                                  icon: 'history',
                                  title: 'History',
                                  onClick: () => this._openHistory(r.photon, r.method),
                                })}
                                ${this._iconBtn({
                                  icon: 'pause',
                                  title: 'Pause',
                                  onClick: () => this._scheduleAction('pause', r.photon, r.method),
                                })}
                                ${this._iconBtn({
                                  icon: 'disable',
                                  title: 'Disable',
                                  onClick: () =>
                                    this._scheduleAction('disable', r.photon, r.method),
                                  variant: 'danger',
                                })}
                              </span>
                            </td>
                          </tr>
                        `
                      )}
                    </tbody>
                  `
                )}
              </table>
            </div>`}
      </section>
    `;
  }

  private _renderDeclared() {
    const rows = (this._snap?.declared ?? []).filter((d) => !d.active);
    if (rows.length === 0) return '';
    const groups = groupByLocation(rows);
    return html`
      <section class="card">
        ${this._sectionHead('Pending', rows.length)}
        <p class="section-hint"><code>@scheduled</code> methods discovered but not yet enrolled.</p>
        <div class="table-wrap">
          <table class="grouped">
            ${groups.map(
              ([loc, items]) => html`
                <tbody>
                  ${this._groupHeader(loc, items.length, 'pending')}
                  ${items.map(
                    (r) => html`
                      <tr>
                        <td class="entity-cell">${this._entity(r.photon, r.method, true)}</td>
                        <td class="timing">
                          <span class="schedule" title="${r.cron}">${humanizeCron(r.cron)}</span>
                        </td>
                        <td></td>
                        <td class="actions">
                          <span class="icon-bar">
                            ${this._iconBtn({
                              icon: 'play',
                              title: 'Enable',
                              onClick: () => this._scheduleAction('enable', r.photon, r.method),
                              variant: 'primary',
                            })}
                          </span>
                        </td>
                      </tr>
                    `
                  )}
                </tbody>
              `
            )}
          </table>
        </div>
      </section>
    `;
  }

  private _renderWebhooks() {
    const rows = this._snap?.webhooks ?? [];
    if (rows.length === 0) return '';
    const groups = groupByLocation(rows);
    return html`
      <section class="card">
        ${this._sectionHead('Webhooks', rows.length)}
        <div class="table-wrap">
          <table class="grouped">
            ${groups.map(
              ([loc, items]) => html`
                <tbody>
                  ${this._groupHeader(loc, items.length, 'route')}
                  ${items.map((r) => {
                    const m = r.route.match(/^([A-Z]+)\s+(.+)$/);
                    const verb = m?.[1] ?? '';
                    const path = m?.[2] ?? r.route;
                    return html`
                      <tr>
                        <td>
                          <span class="route-cell">
                            <span class="route-photon">${r.photon}</span>
                            ${verb ? html`<span class="route-verb">${verb}</span>` : ''}
                            <span class="route-path">${path}</span>
                            <span class="route-arrow">→</span>
                            <span class="route-handler">${r.method}</span>
                          </span>
                        </td>
                      </tr>
                    `;
                  })}
                </tbody>
              `
            )}
          </table>
        </div>
      </section>
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
      <div class="pulse-header">
        <h1>Pulse</h1>
        <button class="refresh" @click=${() => this._refresh()} ?disabled=${this._loading}>
          ${this._loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p class="hint">
        Heartbeat of the daemon: loaded photons, schedules, and webhooks. Mirrors
        <code>photon ps</code>. Auto-refresh every ${POLL_INTERVAL_MS / 1000}s.
      </p>

      ${this._error ? html`<div class="error">${this._error}</div>` : ''} ${this._renderLoaded()}
      ${this._renderActive()} ${this._renderWebhooks()} ${this._renderDeclared()}
      ${this._renderHistoryDrawer()}
    `;
  }
}
