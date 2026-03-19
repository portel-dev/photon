import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, forms } from '../../styles/index.js';

type ViewMode = 'days' | 'months' | 'years';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

@customElement('date-picker')
export class DatePicker extends LitElement {
  static styles = [
    theme,
    forms,
    css`
      :host {
        display: block;
        position: relative;
      }

      .input-row {
        display: flex;
        gap: 0;
      }

      .input-row input {
        flex: 1;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: none;
        font-family: var(--font-mono, monospace);
        font-size: var(--text-md);
      }

      .input-row input.error {
        border-color: var(--color-error, #ef4444);
      }

      .toggle-btn {
        padding: 0 10px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-top-right-radius: var(--radius-sm);
        border-bottom-right-radius: var(--radius-sm);
        color: var(--t-muted);
        cursor: pointer;
        font-size: 16px;
        transition: all 0.15s;
        display: flex;
        align-items: center;
      }

      .toggle-btn:hover {
        color: var(--accent-primary);
        border-color: var(--accent-primary);
      }

      .toggle-btn.active {
        background: var(--accent-primary);
        color: #fff;
        border-color: var(--accent-primary);
      }

      /* Dropdown panel */
      .panel {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 100;
        background: var(--bg-panel, var(--bg-glass));
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md, 8px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        padding: 12px;
        width: 280px;
        user-select: none;
      }

      /* Header: nav arrows + clickable month/year */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .nav-btn {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        background: none;
        border: 1px solid transparent;
        color: var(--t-muted);
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.1s;
      }

      .nav-btn:hover {
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.1));
        border-color: var(--border-glass);
        color: var(--t-primary);
      }

      .header-title {
        display: flex;
        gap: 4px;
        align-items: center;
      }

      .header-title button {
        background: none;
        border: none;
        color: var(--t-primary);
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        transition: all 0.1s;
      }

      .header-title button:hover {
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.1));
        color: var(--accent-primary);
      }

      /* Day grid */
      .day-labels {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        color: var(--t-muted);
        margin-bottom: 4px;
      }

      .days {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
      }

      .day {
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        font-size: 13px;
        cursor: pointer;
        border: none;
        background: none;
        color: var(--t-primary);
        transition: all 0.1s;
      }

      .day:hover {
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.1));
      }

      .day.other-month {
        color: var(--t-muted);
        opacity: 0.4;
      }

      .day.today {
        border: 1px solid var(--accent-primary);
        font-weight: 600;
      }

      .day.selected {
        background: var(--accent-primary);
        color: #fff;
        font-weight: 600;
      }

      .day.selected.today {
        border-color: transparent;
      }

      /* Month/Year grid */
      .grid-4x3 {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }

      .grid-cell {
        padding: 10px 4px;
        text-align: center;
        border-radius: var(--radius-sm);
        font-size: 13px;
        cursor: pointer;
        border: none;
        background: none;
        color: var(--t-primary);
        transition: all 0.1s;
      }

      .grid-cell:hover {
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.1));
      }

      .grid-cell.current {
        border: 1px solid var(--accent-primary);
        font-weight: 600;
      }

      .grid-cell.selected {
        background: var(--accent-primary);
        color: #fff;
        font-weight: 600;
      }

      /* Footer */
      .footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--border-glass);
      }

      .footer-btn {
        font-size: 12px;
        color: var(--accent-primary);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        transition: all 0.1s;
      }

      .footer-btn:hover {
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.1));
      }

      /* Time inputs */
      .time-row {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--border-glass);
      }

      .time-input {
        width: 48px !important;
        text-align: center;
        font-family: var(--font-mono, monospace);
        font-size: 14px;
        padding: 4px !important;
      }

      .time-sep {
        color: var(--t-muted);
        font-weight: 600;
      }

      /* Responsive */
      @media (max-width: 768px) {
        input {
          min-height: 44px;
          font-size: 16px;
        }
        .toggle-btn {
          min-height: 44px;
          padding: 0 14px;
        }
        .panel {
          width: calc(100vw - 32px);
          max-width: 320px;
        }
      }
    `,
  ];

  @property() value = '';
  @property({ type: Boolean }) hasError = false;
  @property() mode: 'date' | 'date-time' | 'time' = 'date';
  @property() placeholder = '';
  @property() min = '';
  @property() max = '';

  @state() private _open = false;
  @state() private _viewMode: ViewMode = 'days';
  @state() private _viewYear = new Date().getFullYear();
  @state() private _viewMonth = new Date().getMonth();
  @state() private _yearRangeStart = Math.floor(new Date().getFullYear() / 12) * 12;
  @state() private _textValue = '';
  @state() private _hours = '12';
  @state() private _minutes = '00';

  private _onDocClick = (e: Event) => {
    if (this._open && !this.contains(e.target as Node)) {
      this._open = false;
    }
  };

  connectedCallback() {
    super.connectedCallback();
    this._syncFromValue();
    document.addEventListener('click', this._onDocClick, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick, true);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('value')) {
      this._syncFromValue();
    }
  }

  private _syncFromValue() {
    if (!this.value) {
      this._textValue = '';
      return;
    }
    const v = String(this.value);
    this._textValue = v;

    // Parse date to set view position
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      this._viewYear = d.getFullYear();
      this._viewMonth = d.getMonth();
      this._yearRangeStart = Math.floor(d.getFullYear() / 12) * 12;
      if (this.mode === 'date-time' || this.mode === 'time') {
        this._hours = String(d.getHours()).padStart(2, '0');
        this._minutes = String(d.getMinutes()).padStart(2, '0');
      }
    }
  }

  private _emit(val: string) {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: val }, bubbles: true, composed: true })
    );
  }

  private _formatDate(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  private _selectDay(y: number, m: number, d: number) {
    const dateStr = this._formatDate(y, m, d);
    if (this.mode === 'date-time') {
      this._emit(`${dateStr}T${this._hours}:${this._minutes}`);
    } else {
      this._emit(dateStr);
    }
    this._viewYear = y;
    this._viewMonth = m;
    if (this.mode === 'date') {
      this._open = false;
    }
  }

  private _selectMonth(m: number) {
    this._viewMonth = m;
    this._viewMode = 'days';
  }

  private _selectYear(y: number) {
    this._viewYear = y;
    this._viewMode = 'months';
  }

  private _selectToday = () => {
    const now = new Date();
    this._selectDay(now.getFullYear(), now.getMonth(), now.getDate());
  };

  private _clear = () => {
    this._textValue = '';
    this._emit('');
    this._open = false;
  };

  private _handleTextInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    this._textValue = val;
  };

  private _handleTextBlur = () => {
    const val = this._textValue.trim();
    if (!val) {
      this._emit('');
      return;
    }
    // Try parsing various formats
    const parsed = this._parseDate(val);
    if (parsed) {
      const dateStr = this._formatDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      if (this.mode === 'date-time') {
        const h = String(parsed.getHours()).padStart(2, '0');
        const m = String(parsed.getMinutes()).padStart(2, '0');
        this._emit(`${dateStr}T${h}:${m}`);
      } else {
        this._emit(dateStr);
      }
      this._viewYear = parsed.getFullYear();
      this._viewMonth = parsed.getMonth();
    }
  };

  private _handleTextKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      this._handleTextBlur();
      this._open = false;
    } else if (e.key === 'Escape') {
      this._open = false;
    }
  };

  private _parseDate(str: string): Date | null {
    // Try ISO format first: 2026-03-20 or 2026-03-20T14:30
    const iso = new Date(str);
    if (!isNaN(iso.getTime()) && str.match(/\d{4}/)) return iso;

    // Try natural formats: "Mar 20 2026", "March 20, 2026", "20 Mar 2026"
    const natural = Date.parse(str);
    if (!isNaN(natural)) return new Date(natural);

    // Try MM/DD/YYYY or DD/MM/YYYY
    const slashMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (slashMatch) {
      let [, a, b, y] = slashMatch;
      let year = parseInt(y);
      if (year < 100) year += 2000;
      // Assume MM/DD/YYYY (US format)
      const d = new Date(year, parseInt(a) - 1, parseInt(b));
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  }

  private _handleTimeChange = () => {
    if (!this.value) return;
    const d = new Date(this.value);
    if (isNaN(d.getTime())) return;
    const dateStr = this._formatDate(d.getFullYear(), d.getMonth(), d.getDate());
    this._emit(`${dateStr}T${this._hours}:${this._minutes}`);
  };

  private _prevNav = () => {
    if (this._viewMode === 'days') {
      if (this._viewMonth === 0) {
        this._viewMonth = 11;
        this._viewYear--;
      } else this._viewMonth--;
    } else if (this._viewMode === 'months') {
      this._viewYear--;
    } else {
      this._yearRangeStart -= 12;
    }
  };

  private _nextNav = () => {
    if (this._viewMode === 'days') {
      if (this._viewMonth === 11) {
        this._viewMonth = 0;
        this._viewYear++;
      } else this._viewMonth++;
    } else if (this._viewMode === 'months') {
      this._viewYear++;
    } else {
      this._yearRangeStart += 12;
    }
  };

  // ─── Render ───

  render() {
    if (this.mode === 'time') {
      return this._renderTimeOnly();
    }

    const displayPlaceholder =
      this.placeholder || (this.mode === 'date-time' ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD');

    return html`
      <div class="input-row">
        <input
          type="text"
          class="${this.hasError ? 'error' : ''}"
          .value=${this._textValue}
          placeholder=${displayPlaceholder}
          @input=${this._handleTextInput}
          @blur=${this._handleTextBlur}
          @keydown=${this._handleTextKeydown}
          @focus=${() => {
            this._open = true;
            this._viewMode = 'days';
          }}
        />
        <button
          class="toggle-btn ${this._open ? 'active' : ''}"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._open = !this._open;
            this._viewMode = 'days';
          }}
          title="Open calendar"
          tabindex="-1"
        >
          📅
        </button>
      </div>
      ${this._open ? this._renderPanel() : nothing}
    `;
  }

  private _renderTimeOnly() {
    return html`
      <div class="input-row">
        <input
          type="text"
          class="${this.hasError ? 'error' : ''}"
          .value=${this._textValue}
          placeholder=${this.placeholder || 'HH:MM'}
          @input=${this._handleTextInput}
          @blur=${() => {
            const m = this._textValue.match(/^(\d{1,2}):(\d{2})$/);
            if (m) this._emit(`${m[1].padStart(2, '0')}:${m[2]}`);
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              const m = this._textValue.match(/^(\d{1,2}):(\d{2})$/);
              if (m) this._emit(`${m[1].padStart(2, '0')}:${m[2]}`);
            }
          }}
        />
      </div>
    `;
  }

  private _renderPanel() {
    return html`
      <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
        ${this._renderHeader()}
        ${this._viewMode === 'days'
          ? this._renderDays()
          : this._viewMode === 'months'
            ? this._renderMonths()
            : this._renderYears()}
        ${this.mode === 'date-time' ? this._renderTimeInputs() : nothing}
        <div class="footer">
          <button class="footer-btn" @click=${this._selectToday}>Today</button>
          ${this.value
            ? html`<button class="footer-btn" @click=${this._clear}>Clear</button>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderHeader() {
    let title;
    if (this._viewMode === 'days') {
      title = html`
        <button
          @click=${() => {
            this._viewMode = 'months';
          }}
        >
          ${MONTH_NAMES[this._viewMonth]}
        </button>
        <button
          @click=${() => {
            this._viewMode = 'years';
            this._yearRangeStart = Math.floor(this._viewYear / 12) * 12;
          }}
        >
          ${this._viewYear}
        </button>
      `;
    } else if (this._viewMode === 'months') {
      title = html`<button
        @click=${() => {
          this._viewMode = 'years';
          this._yearRangeStart = Math.floor(this._viewYear / 12) * 12;
        }}
      >
        ${this._viewYear}
      </button>`;
    } else {
      title = html`<span style="font-size:14px;font-weight:600;color:var(--t-primary)"
        >${this._yearRangeStart} – ${this._yearRangeStart + 11}</span
      >`;
    }

    return html`
      <div class="header">
        <button class="nav-btn" @click=${this._prevNav}>‹</button>
        <div class="header-title">${title}</div>
        <button class="nav-btn" @click=${this._nextNav}>›</button>
      </div>
    `;
  }

  private _renderDays() {
    const y = this._viewYear;
    const m = this._viewMonth;
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrevMonth = new Date(y, m, 0).getDate();

    const today = new Date();
    const todayStr = this._formatDate(today.getFullYear(), today.getMonth(), today.getDate());
    const selectedStr = this.value ? this.value.slice(0, 10) : '';

    const cells = [];

    // Previous month's trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      cells.push({ day: d, month: pm, year: py, otherMonth: true });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, month: m, year: y, otherMonth: false });
    }

    // Next month's leading days
    const remaining = 42 - cells.length; // 6 rows
    for (let d = 1; d <= remaining; d++) {
      const nm = m === 11 ? 0 : m + 1;
      const ny = m === 11 ? y + 1 : y;
      cells.push({ day: d, month: nm, year: ny, otherMonth: true });
    }

    return html`
      <div class="day-labels">${DAY_NAMES.map((d) => html`<div>${d}</div>`)}</div>
      <div class="days">
        ${cells.map((c) => {
          const dateStr = this._formatDate(c.year, c.month, c.day);
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedStr;
          return html`
            <button
              class="day ${c.otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected
                ? 'selected'
                : ''}"
              @click=${() => this._selectDay(c.year, c.month, c.day)}
            >
              ${c.day}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderMonths() {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const selectedDate = this.value ? new Date(this.value) : null;

    return html`
      <div class="grid-4x3">
        ${MONTH_SHORT.map((name, i) => {
          const isCurrent = i === currentMonth && this._viewYear === currentYear;
          const isSelected =
            selectedDate &&
            i === selectedDate.getMonth() &&
            this._viewYear === selectedDate.getFullYear();
          return html`
            <button
              class="grid-cell ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}"
              @click=${() => this._selectMonth(i)}
            >
              ${name}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderYears() {
    const currentYear = new Date().getFullYear();
    const selectedDate = this.value ? new Date(this.value) : null;
    const years = [];
    for (let i = 0; i < 12; i++) {
      years.push(this._yearRangeStart + i);
    }

    return html`
      <div class="grid-4x3">
        ${years.map((y) => {
          const isCurrent = y === currentYear;
          const isSelected = selectedDate && y === selectedDate.getFullYear();
          return html`
            <button
              class="grid-cell ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}"
              @click=${() => this._selectYear(y)}
            >
              ${y}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderTimeInputs() {
    return html`
      <div class="time-row">
        <span style="font-size:12px;color:var(--t-muted);margin-right:auto">Time</span>
        <input
          class="time-input"
          type="text"
          maxlength="2"
          .value=${this._hours}
          @input=${(e: Event) => {
            let v = (e.target as HTMLInputElement).value.replace(/\D/g, '');
            if (parseInt(v) > 23) v = '23';
            this._hours = v;
          }}
          @blur=${() => {
            this._hours = this._hours.padStart(2, '0');
            this._handleTimeChange();
          }}
        />
        <span class="time-sep">:</span>
        <input
          class="time-input"
          type="text"
          maxlength="2"
          .value=${this._minutes}
          @input=${(e: Event) => {
            let v = (e.target as HTMLInputElement).value.replace(/\D/g, '');
            if (parseInt(v) > 59) v = '59';
            this._minutes = v;
          }}
          @blur=${() => {
            this._minutes = this._minutes.padStart(2, '0');
            this._handleTimeChange();
          }}
        />
      </div>
    `;
  }
}
