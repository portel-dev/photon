import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, buttons, forms } from '../styles/index.js';
import { trapFocus } from '../utils/focus-trap.js';

export interface ElicitationData {
  ask: 'text' | 'password' | 'select' | 'confirm' | 'number' | 'oauth' | 'url' | 'form';
  message?: string;
  placeholder?: string;
  default?: any;
  options?: ElicitationOption[];
  multi?: boolean;
  min?: number;
  max?: number;
  step?: number;
  // OAuth specific
  provider?: string;
  scopes?: string[];
  url?: string;
  elicitationUrl?: string;
  elicitationId?: string;
  // Form specific
  schema?: any;
  fields?: FormField[];
}

export interface ElicitationOption {
  value: string;
  label: string;
  description?: string;
  image?: string;
  disabled?: boolean;
  selected?: boolean;
}

export interface FormField {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: any;
  placeholder?: string;
  // Rich input support
  enum?: string[];
  min?: number;
  max?: number;
  step?: number;
  format?: string; // date, date-time, time
}

@customElement('elicitation-modal')
export class ElicitationModal extends LitElement {
  static styles = [
    theme,
    buttons,
    forms,
    css`
      :host {
        display: none;
      }

      @keyframes modal-backdrop-in {
        from {
          opacity: 0;
          backdrop-filter: blur(0);
        }
        to {
          opacity: 1;
          backdrop-filter: blur(4px);
        }
      }

      @keyframes modal-content-in {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(8px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      :host([open]) {
        display: flex;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 10000;
        align-items: center;
        justify-content: center;
        animation: modal-backdrop-in 0.2s ease-out both;
      }

      .modal-content {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-xl);
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        animation: modal-content-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
        animation-delay: 0.05s;
      }

      h3 {
        margin: 0 0 var(--space-lg) 0;
        font-size: var(--text-xl);
        font-weight: 600;
        color: var(--t-primary);
      }

      .actions {
        display: flex;
        gap: var(--space-sm);
        justify-content: flex-end;
        margin-top: var(--space-lg);
      }

      .btn-success {
        background: var(--color-success);
        color: white;
      }

      .btn-success:hover {
        filter: brightness(1.1);
      }

      .btn-danger {
        background: var(--color-error);
        color: white;
      }

      .btn-danger:hover {
        filter: brightness(1.1);
      }

      /* Confirm buttons */
      .confirm-actions {
        display: flex;
        gap: var(--space-md);
      }

      .confirm-actions button {
        flex: 1;
      }

      /* Select options */
      .select-options {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        max-height: 300px;
        overflow-y: auto;
      }

      .select-option {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.2s;
      }

      .select-option:hover {
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .select-option.selected {
        border-color: var(--accent-primary);
        background: var(--glow-primary);
      }

      .select-option.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .select-option input[type='radio'],
      .select-option input[type='checkbox'] {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }

      .option-content {
        flex: 1;
        min-width: 0;
      }

      .option-label {
        font-weight: 500;
        color: var(--t-primary);
      }

      .option-description {
        font-size: var(--text-md);
        color: var(--t-muted);
        margin-top: 2px;
      }

      .option-image {
        width: 48px;
        height: 48px;
        object-fit: cover;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      /* Native select dropdown */
      select {
        appearance: none;
        -webkit-appearance: none;
        padding: 10px 32px 10px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-glass);
        background: var(--bg-glass);
        color: var(--t-primary);
        font-size: var(--text-lg);
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
      }

      /* OAuth */
      .oauth-content {
        text-align: center;
      }

      .oauth-icon {
        font-size: var(--text-3xl);
        margin-bottom: var(--space-md);
      }

      .oauth-message {
        color: var(--t-muted);
        margin-bottom: var(--space-lg);
      }

      .oauth-scopes {
        font-size: var(--text-md);
        color: var(--t-muted);
        margin-bottom: var(--space-lg);
      }

      /* Form fields */
      .form-fields {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }

      /* Slider */
      .slider-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .slider-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .slider-row input[type='range'] {
        flex: 1;
        height: 4px;
        border-radius: var(--radius-full, 9999px);
        -webkit-appearance: none;
        cursor: pointer;
        margin: 8px 0;
        border: none;
        outline: none;
        background: var(--border-glass);
      }

      .slider-row input[type='range']::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: var(--accent-primary);
        border: 2px solid var(--bg-panel, var(--bg-glass));
        border-radius: 50%;
        cursor: pointer;
        box-shadow:
          0 0 0 2px var(--accent-primary),
          0 1px 4px rgba(0, 0, 0, 0.3);
        transition:
          box-shadow 0.15s ease,
          transform 0.15s ease;
      }

      .slider-row input[type='range']::-webkit-slider-thumb:hover {
        box-shadow:
          0 0 0 3px var(--accent-primary),
          0 0 8px var(--glow-primary);
        transform: scale(1.1);
      }

      .slider-row input[type='range']:active::-webkit-slider-thumb {
        transform: scale(0.95);
      }

      .slider-row input[type='range']::-moz-range-track {
        height: 4px;
        background: var(--border-glass);
        border-radius: var(--radius-full, 9999px);
        border: none;
      }

      .slider-row input[type='range']::-moz-range-progress {
        height: 4px;
        background: var(--accent-primary);
        border-radius: var(--radius-full, 9999px);
      }

      .slider-row input[type='range']::-moz-range-thumb {
        width: 12px;
        height: 12px;
        background: var(--accent-primary);
        border: 2px solid var(--bg-panel, var(--bg-glass));
        border-radius: 50%;
        cursor: pointer;
        box-shadow:
          0 0 0 2px var(--accent-primary),
          0 1px 4px rgba(0, 0, 0, 0.3);
        transition:
          box-shadow 0.15s ease,
          transform 0.15s ease;
      }

      .slider-row input[type='range']::-moz-range-thumb:hover {
        box-shadow:
          0 0 0 3px var(--accent-primary),
          0 0 8px var(--glow-primary);
      }

      .slider-number-input {
        width: 64px;
        text-align: center;
        font-size: var(--text-sm);
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        padding: 4px 6px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass) !important;
        border-radius: var(--radius-sm);
        color: var(--t-primary);
        -moz-appearance: textfield;
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .slider-number-input::-webkit-outer-spin-button,
      .slider-number-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      .slider-number-input:focus-visible {
        outline: none;
        border-color: var(--accent-primary) !important;
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .range-labels {
        display: flex;
        justify-content: space-between;
        font-size: var(--text-xs);
        color: var(--t-muted);
        padding: 0 2px;
      }

      /* Date/Time Inputs */
      .date-input {
        width: 100%;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        font-size: var(--text-md);
      }

      .date-input:focus-visible {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .date-input::-webkit-calendar-picker-indicator {
        filter: invert(0.7);
        cursor: pointer;
      }

      /* Toggle Switch */
      .toggle-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .toggle-switch {
        position: relative;
        width: 44px;
        height: 24px;
        flex-shrink: 0;
      }

      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-track {
        position: absolute;
        inset: 0;
        background: var(--bg-glass-strong);
        border-radius: 12px;
        cursor: pointer;
        transition:
          background 0.2s,
          box-shadow 0.2s;
      }

      .toggle-track:hover {
        background: var(--bg-glass);
      }

      .toggle-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
      }

      .toggle-switch input:checked + .toggle-track {
        background: var(--accent-primary);
      }

      .toggle-switch input:checked + .toggle-track:hover {
        background: var(--accent-secondary);
      }

      .toggle-switch input:focus-visible + .toggle-track {
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .toggle-switch input:checked + .toggle-track::after {
        transform: translateX(20px);
      }

      .toggle-label {
        font-size: var(--text-md);
        color: var(--t-muted);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .modal-content {
          padding: var(--space-lg);
          margin: var(--space-md);
        }

        input[type='text'],
        input[type='password'],
        input[type='number'],
        textarea,
        select {
          min-height: 44px;
          font-size: 16px; /* Prevent iOS zoom */
        }

        button {
          min-height: 44px;
        }

        .actions {
          flex-direction: column;
        }

        .actions button {
          width: 100%;
        }

        .confirm-actions {
          flex-direction: column;
        }

        .confirm-actions button {
          flex: none;
          width: 100%;
        }

        .select-options {
          max-height: 250px;
        }

        .select-option {
          padding: var(--space-md);
        }

        .slider-row {
          flex-wrap: wrap;
        }

        .slider-number-input {
          width: 100%;
        }
      }

      @media (max-width: 480px) {
        .modal-content {
          padding: var(--space-md);
          border-radius: var(--radius-sm);
          max-height: 95vh;
        }

        h3 {
          font-size: 1.1rem;
        }

        .oauth-icon {
          font-size: 2.5rem;
        }

        .option-image {
          width: 40px;
          height: 40px;
        }
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Object }) data: ElicitationData | null = null;

  @state() private _inputValue: any = '';
  @state() private _selectedValues: string[] = [];
  @state() private _formValues: Record<string, any> = {};

  private _oauthPopup: Window | null = null;
  private _oauthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _boundGlobalKeydown: ((e: KeyboardEvent) => void) | null = null;
  private _releaseFocusTrap: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._boundGlobalKeydown = (e: KeyboardEvent) => {
      if (this.open && e.key === 'Escape') {
        e.preventDefault();
        this._cancel();
      }
    };
    document.addEventListener('keydown', this._boundGlobalKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._boundGlobalKeydown) {
      document.removeEventListener('keydown', this._boundGlobalKeydown);
      this._boundGlobalKeydown = null;
    }
    if (this._oauthCheckInterval) {
      clearInterval(this._oauthCheckInterval);
      this._oauthCheckInterval = null;
    }
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('data') && this.data) {
      this._resetState();
    }
    if (changedProperties.has('open')) {
      if (this.open) {
        void this.updateComplete.then(() => {
          const content = this.shadowRoot?.querySelector('.modal-content') as HTMLElement;
          if (content) {
            this._releaseFocusTrap = trapFocus(content);
          }
        });
      } else if (this._releaseFocusTrap) {
        this._releaseFocusTrap();
        this._releaseFocusTrap = null;
      }
    }
  }

  private _resetState() {
    if (!this.data) return;

    this._inputValue =
      this.data.default ?? (this.data.ask === 'number' ? (this.data.min ?? 0) : '');
    this._selectedValues = [];
    this._formValues = {};

    // Pre-select options if specified
    if (this.data.options) {
      this._selectedValues = this.data.options
        .filter((opt) => opt.selected)
        .map((opt) => opt.value);
    }

    // Initialize form values
    if (this.data.fields) {
      this.data.fields.forEach((field) => {
        this._formValues[field.name] = field.default ?? '';
      });
    }
  }

  render() {
    if (!this.data) return nothing;

    return html`
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="${this.data?.message || 'Input required'}"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <h3>${this.data.message || 'Input Required'}</h3>
        ${this._renderContent()}
      </div>
    `;
  }

  private _renderContent() {
    if (!this.data) return nothing;

    switch (this.data.ask) {
      case 'text':
      case 'password':
        return this._renderTextInput();
      case 'number':
        return this._renderNumberInput();
      case 'select':
        return this._renderSelect();
      case 'confirm':
        return this._renderConfirm();
      case 'oauth':
      case 'url':
        return this._renderOAuth();
      case 'form':
        return this._renderForm();
      default:
        return html`<p>Unknown elicitation type: ${this.data.ask}</p>`;
    }
  }

  private _renderTextInput() {
    const type = this.data?.ask === 'password' ? 'password' : 'text';
    return html`
      <div class="form-group">
        <input
          type=${type}
          .value=${this._inputValue}
          placeholder=${this.data?.placeholder || ''}
          @input=${(e: Event) => (this._inputValue = (e.target as HTMLInputElement).value)}
          @keydown=${(e: Event) => this._handleKeydown(e as KeyboardEvent)}
          autofocus
        />
      </div>
      <div class="actions">
        <button class="btn-secondary" @click=${() => this._cancel()}>Cancel</button>
        <button class="btn-primary" @click=${() => this._submit()}>Submit</button>
      </div>
    `;
  }

  private _renderNumberInput() {
    const hasMin = this.data?.min != null;
    const hasMax = this.data?.max != null;
    const isFloat = this.data?.step != null && this.data.step % 1 !== 0;

    let min: number, max: number;
    if (hasMin && hasMax) {
      min = this.data!.min!;
      max = this.data!.max!;
    } else if (hasMin && !hasMax) {
      min = this.data!.min!;
      max = min <= 0 ? 100 : min * 2;
    } else if (!hasMin && hasMax) {
      min = 0;
      max = this.data!.max!;
    } else {
      min = isFloat ? 0 : 0;
      max = isFloat ? 1 : 100;
    }

    const step = this.data?.step ?? (isFloat ? 0.01 : 1);
    const currentValue = this._inputValue ?? min;

    return html`
      <div class="form-group">
        <div class="slider-group">
          <div class="slider-row">
            <input
              type="range"
              min="${min}"
              max="${max}"
              step="${step}"
              style="${this._sliderFillStyle(Number(currentValue), min, max)}"
              .value=${String(currentValue)}
              @input=${(e: Event) => {
                const el = e.target as HTMLInputElement;
                const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                el.style.cssText = this._sliderFillStyle(v, min, max);
                this._inputValue = v;
              }}
            />
            <input
              type="number"
              class="slider-number-input"
              min="${min}"
              max="${max}"
              step="${step}"
              .value=${String(currentValue)}
              @input=${(e: Event) => {
                const raw = (e.target as HTMLInputElement).value;
                if (raw === '' || raw === '-') return;
                this._inputValue = Number(raw);
              }}
              @change=${(e: Event) => {
                const el = e.target as HTMLInputElement;
                const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                el.value = String(v);
                this._inputValue = v;
              }}
              @keydown=${(e: Event) => this._handleKeydown(e as KeyboardEvent)}
              autofocus
            />
          </div>
          <div class="range-labels">
            <span>${min}</span>
            <span>${max}</span>
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-secondary" @click=${() => this._cancel()}>Cancel</button>
        <button class="btn-primary" @click=${() => this._submit()}>Submit</button>
      </div>
    `;
  }

  private _renderSelect() {
    const options = this.data?.options || [];
    const isMulti = this.data?.multi === true;

    if (options.length <= 5 && !options.some((o) => o.image || o.description)) {
      // Simple dropdown for small option sets
      return html`
        <div class="form-group">
          <select
            @change=${(e: Event) => (this._inputValue = (e.target as HTMLSelectElement).value)}
          >
            ${options.map(
              (opt) => html`
                <option value=${opt.value} ?selected=${opt.selected}>${opt.label}</option>
              `
            )}
          </select>
        </div>
        <div class="actions">
          <button class="btn-secondary" @click=${() => this._cancel()}>Cancel</button>
          <button class="btn-primary" @click=${() => this._submit()}>Submit</button>
        </div>
      `;
    }

    // Rich select with cards
    return html`
      <div class="select-options">
        ${options.map(
          (opt) => html`
            <label
              class="select-option ${opt.disabled ? 'disabled' : ''} ${this._isSelected(opt.value)
                ? 'selected'
                : ''}"
            >
              <input
                type=${isMulti ? 'checkbox' : 'radio'}
                name="select-option"
                .value=${opt.value}
                .checked=${this._isSelected(opt.value)}
                ?disabled=${opt.disabled}
                @change=${() => this._toggleOption(opt.value, isMulti)}
              />
              ${opt.image
                ? html`<img class="option-image" src=${opt.image} alt=${opt.label} />`
                : nothing}
              <div class="option-content">
                <div class="option-label">${opt.label}</div>
                ${opt.description
                  ? html`<div class="option-description">${opt.description}</div>`
                  : nothing}
              </div>
            </label>
          `
        )}
      </div>
      <div class="actions">
        <button class="btn-secondary" @click=${() => this._cancel()}>Cancel</button>
        <button class="btn-primary" @click=${() => this._submitSelect()}>Submit</button>
      </div>
    `;
  }

  private _isSelected(value: string): boolean {
    return this._selectedValues.includes(value);
  }

  private _toggleOption(value: string, isMulti: boolean) {
    if (isMulti) {
      if (this._selectedValues.includes(value)) {
        this._selectedValues = this._selectedValues.filter((v) => v !== value);
      } else {
        this._selectedValues = [...this._selectedValues, value];
      }
    } else {
      this._selectedValues = [value];
    }
    this.requestUpdate();
  }

  private _renderConfirm() {
    return html`
      <div class="confirm-actions">
        <button class="btn-danger" @click=${() => this._submitValue(false)}>No</button>
        <button class="btn-success" @click=${() => this._submitValue(true)}>Yes</button>
      </div>
    `;
  }

  private _renderOAuth() {
    const providerIcons: Record<string, string> = {
      google: '🔵',
      github: '⚫',
      microsoft: '🟦',
      slack: '💜',
      notion: '⬛',
      default: '🔐',
    };
    const provider = this.data?.provider || 'OAuth';
    const icon = providerIcons[provider.toLowerCase()] || providerIcons.default;
    const scopes = (this.data?.scopes || []).join(', ');
    const customMessage = this.data?.message;
    const buttonLabel = customMessage ? 'Open' : `Authorize ${provider}`;

    return html`
      <div class="oauth-content">
        <div class="oauth-icon">${icon}</div>
        <p class="oauth-message">
          ${customMessage || `Authorization is required to access ${provider}.`}
        </p>
        ${scopes ? html`<p class="oauth-scopes">Requested permissions: ${scopes}</p>` : ''}
        <div class="actions" style="justify-content: center;">
          <button class="btn-secondary" @click=${() => this._cancel()}>Cancel</button>
          <button class="btn-primary" @click=${() => this._startOAuth()}>${buttonLabel}</button>
        </div>
      </div>
    `;
  }

  private _renderForm() {
    // Support both direct fields array and JSON Schema format
    let fields = this.data?.fields || [];

    // Convert JSON Schema to fields array if schema is provided
    if (fields.length === 0 && this.data?.schema?.properties) {
      const schema = this.data.schema;
      const required = new Set(schema.required || []);
      fields = Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
        name,
        label: prop.title || name,
        type:
          prop.type === 'boolean'
            ? 'boolean'
            : prop.type === 'integer'
              ? 'integer'
              : prop.type === 'number'
                ? 'number'
                : 'text',
        required: required.has(name),
        default: prop.default,
        placeholder: prop.description,
        enum: prop.enum,
        min: prop.minimum,
        max: prop.maximum,
        step: prop.multipleOf,
        format: prop.format,
      }));

      // Initialize form values with defaults
      if (Object.keys(this._formValues).length === 0) {
        const defaults: Record<string, any> = {};
        for (const field of fields) {
          if (field.default !== undefined) {
            defaults[field.name] = field.default;
          }
        }
        this._formValues = defaults;
      }
    }

    return html`
      <div class="form-fields">
        ${fields.map(
          (field: any) => html`
            <div class="form-group">
              <label>${field.label || field.name}${field.required ? ' *' : ''}</label>
              ${this._renderFormField(field)}
            </div>
          `
        )}
      </div>
      <div class="actions">
        <button class="btn-secondary" @click=${() => this._cancel()}>Cancel</button>
        <button class="btn-primary" @click=${() => this._submitForm()}>Submit</button>
      </div>
    `;
  }

  private _renderFormField(field: FormField) {
    const type = field.type || 'text';
    const value = this._formValues[field.name] ?? '';

    if (type === 'textarea') {
      return html`
        <textarea
          rows="3"
          .value=${value}
          placeholder=${field.placeholder || ''}
          @input=${(e: Event) =>
            this._updateFormValue(field.name, (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      `;
    }

    // Boolean → toggle switch
    if (type === 'boolean') {
      const checked = !!this._formValues[field.name];
      return html`
        <div class="toggle-row">
          <label class="toggle-switch">
            <input
              type="checkbox"
              .checked=${checked}
              @change=${(e: Event) =>
                this._updateFormValue(field.name, (e.target as HTMLInputElement).checked)}
            />
            <span class="toggle-track"></span>
          </label>
          <span class="toggle-label">${checked ? 'Yes' : 'No'}</span>
        </div>
      `;
    }

    // String with enum → dropdown
    if (field.enum && field.enum.length > 0) {
      return html`
        <select
          @change=${(e: Event) =>
            this._updateFormValue(field.name, (e.target as HTMLSelectElement).value)}
        >
          ${field.enum.map(
            (opt) => html`<option value=${opt} ?selected=${value === opt}>${opt}</option>`
          )}
        </select>
      `;
    }

    // String with date/time format
    if (field.format === 'date' || field.format === 'date-time' || field.format === 'time') {
      const inputType = field.format === 'date-time' ? 'datetime-local' : field.format;
      return html`
        <input
          type=${inputType}
          class="date-input"
          .value=${value}
          @input=${(e: Event) =>
            this._updateFormValue(field.name, (e.target as HTMLInputElement).value)}
        />
      `;
    }

    // Number/Integer → slider + number input
    if (type === 'number' || type === 'integer') {
      const isInteger = type === 'integer';
      const isFloat = !isInteger && (field.step == null || field.step % 1 !== 0);
      const hasMin = field.min != null;
      const hasMax = field.max != null;

      let min: number, max: number;
      if (hasMin && hasMax) {
        min = field.min!;
        max = field.max!;
      } else if (hasMin && !hasMax) {
        min = field.min!;
        max = min <= 0 ? 100 : min * 2;
      } else if (!hasMin && hasMax) {
        min = 0;
        max = field.max!;
      } else {
        min = 0;
        max = isFloat ? 1 : 100;
      }

      const step = field.step ?? (isInteger ? 1 : isFloat ? 0.01 : 1);
      const currentValue = this._formValues[field.name] ?? field.default ?? min;

      return html`
        <div class="slider-group">
          <div class="slider-row">
            <input
              type="range"
              min="${min}"
              max="${max}"
              step="${step}"
              style="${this._sliderFillStyle(Number(currentValue), min, max)}"
              .value=${String(currentValue)}
              @input=${(e: Event) => {
                const el = e.target as HTMLInputElement;
                const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                el.style.cssText = this._sliderFillStyle(v, min, max);
                this._updateFormValue(field.name, v);
              }}
            />
            <input
              type="number"
              class="slider-number-input"
              min="${min}"
              max="${max}"
              step="${step}"
              .value=${String(currentValue)}
              @input=${(e: Event) => {
                const raw = (e.target as HTMLInputElement).value;
                if (raw === '' || raw === '-') return;
                this._updateFormValue(field.name, Number(raw));
              }}
              @change=${(e: Event) => {
                const el = e.target as HTMLInputElement;
                const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                el.value = String(v);
                this._updateFormValue(field.name, v);
              }}
            />
          </div>
          <div class="range-labels">
            <span>${min}</span>
            <span>${max}</span>
          </div>
        </div>
      `;
    }

    // Default: text input
    return html`
      <input
        type=${type}
        .value=${value}
        placeholder=${field.placeholder || ''}
        ?required=${field.required}
        @input=${(e: Event) =>
          this._updateFormValue(field.name, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  private _sliderFillStyle(value: number, min: number, max: number): string {
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    return `background: linear-gradient(to right, var(--accent-primary) ${pct}%, var(--border-glass) ${pct}%)`;
  }

  /** Clamp to [min, max] and round to nearest step (integer-safe). */
  private _sanitizeSliderValue(raw: number, min: number, max: number, step: number): number {
    let v = Number.isFinite(raw) ? raw : min;
    v = Math.min(max, Math.max(min, v));
    if (step > 0) {
      v = min + Math.round((v - min) / step) * step;
      if (v > max) v = max;
    }
    if (Number.isInteger(step) && step >= 1) {
      v = Math.round(v);
    }
    return v;
  }

  private _updateFormValue(name: string, value: any) {
    this._formValues = { ...this._formValues, [name]: value };
  }

  private _handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this._submit();
    } else if (e.key === 'Escape') {
      this._cancel();
    }
  }

  private _submit() {
    this._submitValue(this._inputValue);
  }

  private _submitSelect() {
    const value = this.data?.multi ? this._selectedValues : this._selectedValues[0];
    this._submitValue(value);
  }

  private _submitForm() {
    this._submitValue(this._formValues);
  }

  private _submitValue(value: any) {
    this.dispatchEvent(
      new CustomEvent('submit', {
        detail: { value },
        bubbles: true,
        composed: true,
      })
    );
    this.open = false;
  }

  private _cancel() {
    this.dispatchEvent(
      new CustomEvent('cancel', {
        bubbles: true,
        composed: true,
      })
    );
    this.open = false;
  }

  private _startOAuth() {
    const url = this.data?.url || this.data?.elicitationUrl;
    if (!url) {
      console.error('No OAuth URL provided');
      return;
    }

    // Open OAuth popup
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    this._oauthPopup = window.open(
      url,
      'oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    );

    // Listen for OAuth completion — store handle so disconnectedCallback can clear it
    this._oauthCheckInterval = setInterval(() => {
      if (this._oauthPopup?.closed) {
        clearInterval(this._oauthCheckInterval!);
        this._oauthCheckInterval = null;
        // Assume success when popup closes
        this.dispatchEvent(
          new CustomEvent('oauth-complete', {
            detail: {
              elicitationId: this.data?.elicitationId,
              success: true,
            },
            bubbles: true,
            composed: true,
          })
        );
        this.open = false;
      }
    }, 500);
  }
}
