/**
 * Per-photon Pulse — vital signs surface for the selected photon.
 *
 * Shows two stacked sections:
 *   1. Schedules — active and declared (dormant) `@scheduled` jobs for this
 *      photon. Inline Pause/Disable/Enable buttons mirror the global Pulse
 *      panel actions.
 *   2. Activity — recent method calls and tool fires for this photon, via
 *      the existing <activity-log> component in fullscreen mode.
 *
 * Empty states for both halves so the page never goes blank.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';
import { formatLabel } from '../utils/format-label.js';
import './activity-log.js';

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

interface PsSnapshot {
  active: ActiveRow[];
  declared: DeclaredRow[];
}

interface ActivityItem {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
  count?: number;
  photonName?: string;
  durationMs?: number;
}

const POLL_INTERVAL_MS = 5000;
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

function humanizeCron(cron: string): string {
  const trimmed = cron.trim();
  if (trimmed === '* * * * *') return 'Every minute';
  if (trimmed === '0 * * * *') return 'Hourly';
  if (trimmed === '0 0 * * *') return 'Daily at midnight';
  if (trimmed === '0 12 * * *') return 'Daily at noon';
  if (trimmed === '0 0 1 * *') return 'Monthly';
  let m = trimmed.match(/^(?:\*|0)\/(\d+) \* \* \* \*$/);
  if (m) return `Every ${m[1]} minutes`;
  m = trimmed.match(/^0 (?:\*|0)\/(\d+) \* \* \*$/);
  if (m) return `Every ${m[1]} hours`;
  m = trimmed.match(/^0 (\d{1,2}) \* \* \*$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 0 && h <= 23) return `Daily at ${formatHour(h)}`;
  }
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

@customElement('photon-pulse')
export class PhotonPulse extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        gap: var(--space-lg);
      }

      .section {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        min-height: 0;
      }

      .section.activity {
        flex: 1;
        min-height: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        padding: 0 var(--space-xs);
      }

      .section-title {
        margin: 0;
        font-size: var(--text-sm);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-primary);
        font-weight: 600;
      }

      .section-count {
        color: var(--t-muted);
        font-size: var(--text-xs);
        font-weight: 500;
        letter-spacing: normal;
        text-transform: none;
      }

      .schedule-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }

      .schedule-row {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, auto) auto;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
      }

      .schedule-row.dormant {
        opacity: 0.7;
      }

      .schedule-method {
        color: var(--t-primary);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .manual-badge {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 1px 6px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent-primary) 36%, var(--border-glass));
        color: var(--t-primary);
        font-weight: 600;
      }

      .schedule-cron {
        color: var(--t-muted);
        font-size: var(--text-sm);
        font-family: var(--font-mono);
      }

      .schedule-next {
        color: var(--t-muted);
        font-size: var(--text-sm);
        font-variant-numeric: tabular-nums;
      }

      .schedule-actions {
        display: flex;
        gap: 4px;
        justify-self: end;
      }

      .schedule-actions button {
        font-size: var(--text-xs);
        padding: 3px 10px;
        border: 1px solid var(--border-glass);
        background: transparent;
        color: var(--t-primary);
        cursor: pointer;
        border-radius: var(--radius-xs);
        transition: all 0.15s ease;
      }

      .schedule-actions button:hover {
        background: var(--bg-glass-strong);
        border-color: color-mix(in srgb, var(--accent-primary) 38%, var(--border-glass));
      }

      .schedule-actions button.primary {
        background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-glass));
        border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--border-glass));
      }

      .empty-hint {
        color: var(--t-muted);
        font-size: var(--text-sm);
        padding: var(--space-md) var(--space-md);
        text-align: center;
        border: 1px dashed var(--border-glass);
        border-radius: var(--radius-sm);
        background: color-mix(in srgb, var(--bg-glass) 50%, transparent);
      }

      .add-btn {
        font-size: var(--text-xs);
        padding: 3px 10px;
        border: 1px solid var(--border-glass);
        background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-glass));
        color: var(--t-primary);
        cursor: pointer;
        border-radius: var(--radius-xs);
        transition: all 0.15s ease;
      }

      .add-btn:hover {
        background: color-mix(in srgb, var(--accent-primary) 22%, var(--bg-glass));
        border-color: color-mix(in srgb, var(--accent-primary) 50%, var(--border-glass));
      }

      .add-form {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto auto;
        gap: var(--space-sm);
        align-items: center;
        padding: var(--space-sm) var(--space-md);
        background: color-mix(in srgb, var(--accent-primary) 6%, var(--bg-glass));
        border: 1px solid color-mix(in srgb, var(--accent-primary) 28%, var(--border-glass));
        border-radius: var(--radius-sm);
      }

      .add-form select,
      .add-form input {
        font: inherit;
        font-size: var(--text-sm);
        color: var(--t-primary);
        background: var(--bg-elevated, #0b1018);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-xs);
        padding: 4px 8px;
      }

      .add-form input {
        font-family: var(--font-mono);
      }

      .add-form select:focus,
      .add-form input:focus {
        outline: none;
        border-color: color-mix(in srgb, var(--accent-primary) 60%, var(--border-glass));
      }

      .add-form button {
        font-size: var(--text-xs);
        padding: 4px 10px;
        border: 1px solid var(--border-glass);
        background: transparent;
        color: var(--t-primary);
        cursor: pointer;
        border-radius: var(--radius-xs);
        transition: all 0.15s ease;
      }

      .add-form button.primary {
        background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-glass));
        border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--border-glass));
      }

      .add-form button:hover {
        background: var(--bg-glass-strong);
      }

      .add-form button[disabled] {
        opacity: 0.5;
        cursor: wait;
      }

      .add-hint {
        grid-column: 1 / -1;
        font-size: var(--text-xs);
        color: var(--t-muted);
      }

      .add-hint a {
        color: var(--accent-primary);
        text-decoration: none;
      }

      .add-hint a:hover {
        text-decoration: underline;
      }

      @media (max-width: 640px) {
        .schedule-row {
          grid-template-columns: 1fr;
          gap: var(--space-xs);
        }

        .schedule-actions {
          justify-self: start;
        }
      }
    `,
  ];

  /** Photon name to scope this Pulse view to. Required. */
  @property({ type: String })
  photonName = '';

  /**
   * Method names available on this photon — populated by the parent so the
   * "Add schedule" form can offer them as picker options without re-querying.
   */
  @property({ type: Array })
  availableMethods: string[] = [];

  /** Activity items (already collected by the parent app). */
  @property({ type: Array })
  activity: ActivityItem[] = [];

  @state() private _active: ActiveRow[] = [];
  @state() private _declared: DeclaredRow[] = [];
  @state() private _error: string | null = null;
  @state() private _showAddForm = false;
  @state() private _formMethod = '';
  @state() private _formCron = '0 9 * * *';
  @state() private _formSubmitting = false;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    void this._refresh();
    this._pollTimer = setInterval(() => void this._refresh(), POLL_INTERVAL_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('photonName')) {
      void this._refresh();
    }
  }

  private async _refresh(): Promise<void> {
    if (!this.photonName) return;
    try {
      const res = await fetch('/api/daemon/ps', { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        this._error = `HTTP ${res.status}`;
        return;
      }
      const snap = (await res.json()) as PsSnapshot;
      this._active = (snap.active ?? []).filter((r) => r.photon === this.photonName);
      this._declared = (snap.declared ?? []).filter(
        (r) => r.photon === this.photonName && !r.active
      );
      this._error = null;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private async _addManual(): Promise<void> {
    const method = this._formMethod.trim();
    const cron = this._formCron.trim();
    if (!method) {
      showToast('Pick a method first', 'error');
      return;
    }
    if (!cron) {
      showToast('Cron expression is required', 'error');
      return;
    }
    this._formSubmitting = true;
    try {
      const res = await fetch('/api/daemon/schedules/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Photon-Request': '1',
        },
        body: JSON.stringify({ photon: this.photonName, method, cron }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        showToast(body.error || 'Failed to add schedule', 'error');
        return;
      }
      showToast(`Scheduled ${this.photonName}:${method}`, 'success');
      this._showAddForm = false;
      this._formMethod = '';
      this._formCron = '0 9 * * *';
      await this._refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      this._formSubmitting = false;
    }
  }

  private async _action(
    op: 'enable' | 'disable' | 'pause' | 'resume',
    photon: string,
    method: string
  ): Promise<void> {
    try {
      const res = await fetch(`/api/daemon/schedules/${op}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Photon-Request': '1',
        },
        body: JSON.stringify({ photon, method }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        showToast(body.error || `Action "${op}" failed`, 'error');
        return;
      }
      showToast(`${op}d ${photon}:${method}`, 'success');
      await this._refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  private _renderAddForm() {
    const usedNames = new Set([
      ...this._active.map((r) => r.method),
      ...this._declared.map((r) => r.method),
    ]);
    const candidates = this.availableMethods.filter((m) => !usedNames.has(m));
    if (this._formMethod && !candidates.includes(this._formMethod)) {
      candidates.unshift(this._formMethod);
    }
    return html`
      <div class="add-form" role="group" aria-label="Add schedule">
        <select
          aria-label="Method"
          .value=${this._formMethod}
          @change=${(e: Event) => (this._formMethod = (e.target as HTMLSelectElement).value)}
        >
          <option value="" disabled ?selected=${!this._formMethod}>Pick a method…</option>
          ${candidates.map(
            (m) => html`<option value=${m} ?selected=${m === this._formMethod}>${m}</option>`
          )}
        </select>
        <input
          aria-label="Cron expression"
          type="text"
          placeholder="0 9 * * *"
          .value=${this._formCron}
          @input=${(e: Event) => (this._formCron = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') void this._addManual();
            if (e.key === 'Escape') this._showAddForm = false;
          }}
        />
        <button class="primary" ?disabled=${this._formSubmitting} @click=${() => this._addManual()}>
          ${this._formSubmitting ? 'Saving…' : 'Save'}
        </button>
        <button
          ?disabled=${this._formSubmitting}
          @click=${() => {
            this._showAddForm = false;
          }}
        >
          Cancel
        </button>
        <div class="add-hint">
          Cron: minute hour day month weekday. Examples: <code>0 9 * * *</code> daily 9am,
          <code>*/15 * * * *</code> every 15min.
          <a href="https://crontab.guru/" target="_blank" rel="noopener">crontab.guru</a>
        </div>
      </div>
    `;
  }

  private _renderSchedules() {
    const total = this._active.length + this._declared.length;
    return html`
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">
            Schedules ${total > 0 ? html`<span class="section-count">${total}</span>` : ''}
          </h3>
          ${this._showAddForm
            ? ''
            : html`<button
                class="add-btn"
                title="Add a manual cron schedule for any method"
                @click=${() => {
                  this._showAddForm = true;
                  // Pre-pick first un-scheduled method, if any.
                  if (!this._formMethod) {
                    const used = new Set([
                      ...this._active.map((r) => r.method),
                      ...this._declared.map((r) => r.method),
                    ]);
                    this._formMethod =
                      this.availableMethods.find((m) => !used.has(m)) ??
                      this.availableMethods[0] ??
                      '';
                  }
                }}
              >
                + Add schedule
              </button>`}
        </div>
        ${this._showAddForm ? this._renderAddForm() : ''}
        ${total === 0 && !this._showAddForm
          ? html`<div class="empty-hint" role="status">
              No scheduled work for ${this.photonName}. Add a
              <code>@scheduled &lt;cron&gt;</code> JSDoc tag to a method, or use the "+ Add
              schedule" button above to set one up manually.
            </div>`
          : total === 0
            ? ''
            : html`<div class="schedule-list">
                ${this._active.map(
                  (r) => html`
                    <div class="schedule-row" role="listitem">
                      <span class="schedule-method" title="${r.method}">
                        ${formatLabel(r.method)}
                        ${r.createdBy === 'manual'
                          ? html`<span class="manual-badge" title="Added manually via Pulse"
                              >manual</span
                            >`
                          : ''}
                      </span>
                      <span class="schedule-cron" title="${r.cron}">${humanizeCron(r.cron)}</span>
                      <span class="schedule-next">next: ${formatWhen(r.nextRun)}</span>
                      <span class="schedule-actions">
                        <button @click=${() => this._action('pause', r.photon, r.method)}>
                          Pause
                        </button>
                        <button @click=${() => this._action('disable', r.photon, r.method)}>
                          Disable
                        </button>
                      </span>
                    </div>
                  `
                )}
                ${this._declared.map(
                  (r) => html`
                    <div class="schedule-row dormant" role="listitem">
                      <span class="schedule-method" title="${r.method}"
                        >${formatLabel(r.method)}</span
                      >
                      <span class="schedule-cron" title="${r.cron}">${humanizeCron(r.cron)}</span>
                      <span class="schedule-next">declared, not enrolled</span>
                      <span class="schedule-actions">
                        <button
                          class="primary"
                          @click=${() => this._action('enable', r.photon, r.method)}
                        >
                          Enable
                        </button>
                      </span>
                    </div>
                  `
                )}
              </div>`}
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderSchedules()}
      <div class="section activity">
        <activity-log
          .items=${this.activity}
          .filter=${this.photonName}
          .fullscreen=${true}
          @clear=${() =>
            this.dispatchEvent(
              new CustomEvent('clear-activity', { bubbles: true, composed: true })
            )}
        ></activity-log>
      </div>
    `;
  }
}
