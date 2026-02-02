import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

interface MethodParam {
  type: string;
  description?: string;
  required?: boolean;
}

@customElement('invoke-form')
export class InvokeForm extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      .form-container {
        padding: var(--space-lg);
      }

      .form-group {
        margin-bottom: var(--space-md);
      }

      label {
        display: block;
        margin-bottom: var(--space-xs);
        font-weight: 500;
        font-size: 0.9rem;
      }

      .hint {
        font-size: 0.8rem;
        color: var(--t-muted);
        margin-left: var(--space-xs);
      }

      input,
      textarea,
      select {
        width: 100%;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        box-sizing: border-box;
      }

      input:focus,
      textarea:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-md);
        margin-top: var(--space-lg);
        padding-top: var(--space-md);
        border-top: 1px solid var(--border-glass);
      }

      button {
        padding: var(--space-sm) var(--space-lg);
        border-radius: var(--radius-sm);
        font-weight: 500;
        cursor: pointer;
        border: none;
        font-family: var(--font-sans);
        transition: all 0.2s;
      }

      .btn-primary {
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        color: white;
      }

      .btn-primary:hover {
        opacity: 0.9;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px var(--glow-primary);
      }

      .btn-secondary {
        background: transparent;
        color: var(--t-muted);
        border: 1px solid var(--border-glass);
      }

      .btn-secondary:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }

      .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      .btn-loading {
        display: inline-flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .error-text {
        color: #f87171;
        font-size: 0.75rem;
        margin-top: var(--space-xs);
      }

      input.error,
      textarea.error,
      select.error {
        border-color: #f87171;
      }

      input.error:focus,
      textarea.error:focus {
        box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.3);
      }

      /* Multiselect Styles */
      .multiselect-container {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
      }

      .multiselect-option {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.2s;
        user-select: none;
      }

      .multiselect-option:hover {
        border-color: var(--accent-secondary);
      }

      .multiselect-option.selected {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .multiselect-option input {
        width: auto;
        margin: 0;
        cursor: pointer;
      }

      /* Number Input with Range Slider */
      .number-with-range {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }

      .number-with-range input[type='range'] {
        width: 100%;
        height: 6px;
        background: var(--bg-glass);
        border-radius: 3px;
        border: none;
        -webkit-appearance: none;
      }

      .number-with-range input[type='range']::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: var(--accent-primary);
        border-radius: 50%;
        cursor: pointer;
      }

      .number-input-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .number-input-row input[type='number'] {
        width: 100px;
      }

      .range-labels {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--t-muted);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .form-container {
          padding: var(--space-md);
        }

        input,
        textarea,
        select {
          min-height: 44px;
          font-size: 16px; /* Prevent iOS zoom */
        }

        button {
          min-height: 44px;
          padding: var(--space-sm) var(--space-md);
        }

        .actions {
          flex-direction: column;
        }

        .actions button {
          width: 100%;
        }
      }

      @media (max-width: 480px) {
        .form-container {
          padding: var(--space-sm);
        }

        .number-input-row {
          flex-direction: column;
          align-items: stretch;
        }

        .number-input-row input[type='number'] {
          width: 100%;
        }

        .multiselect-container {
          flex-direction: column;
        }

        .multiselect-option {
          width: 100%;
          justify-content: center;
        }
      }
    `,
  ];

  @property({ type: Object })
  params: Record<string, MethodParam> = {};

  @property({ type: Boolean })
  loading = false;

  /** Photon name for localStorage key */
  @property({ type: String })
  photonName = '';

  /** Method name for localStorage key */
  @property({ type: String })
  methodName = '';

  /** Whether to remember form values (controlled by parent settings menu) */
  @property({ type: Boolean })
  rememberValues = false;

  /** Pre-populated values from shared link */
  @property({ type: Object })
  sharedValues: Record<string, any> | null = null;

  @state()
  private _values: Record<string, any> = {};

  @state()
  private _errors: Record<string, string> = {};

  private get _storageKey(): string {
    return `beam-form:${this.photonName}:${this.methodName}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadPersistedValues();
  }

  updated(changedProps: Map<string, unknown>) {
    // Reload persisted values when photon/method or remember setting changes
    if (
      changedProps.has('photonName') ||
      changedProps.has('methodName') ||
      changedProps.has('rememberValues')
    ) {
      this._loadPersistedValues();
    }
    // Apply shared values from URL (takes priority over persisted values)
    if (changedProps.has('sharedValues') && this.sharedValues) {
      this._values = { ...this._values, ...this.sharedValues };
      showToast('Form pre-filled from shared link', 'info');
    }
  }

  private _loadPersistedValues() {
    if (!this.photonName || !this.methodName) return;

    // Only load persisted values if remember is enabled
    if (!this.rememberValues) {
      this._values = {};
      return;
    }

    try {
      const stored = localStorage.getItem(this._storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        this._values = data.values || {};
      }
    } catch (e) {
      console.warn('Failed to load persisted form values:', e);
    }
  }

  private _savePersistedValues() {
    if (!this.photonName || !this.methodName) return;

    try {
      if (this.rememberValues) {
        localStorage.setItem(
          this._storageKey,
          JSON.stringify({
            values: this._values,
          })
        );
      }
    } catch (e) {
      console.warn('Failed to save form values:', e);
    }
  }

  private _clearPersistedValues() {
    if (!this.photonName || !this.methodName) return;

    localStorage.removeItem(this._storageKey);
    this._values = {};
    showToast('Form values cleared', 'info');
    this.requestUpdate();
  }

  render() {
    return html`
      <div class="form-container">
        ${this._renderFields()}

        <div class="actions">
          <button class="btn-secondary" @click=${this._handleCancel} ?disabled=${this.loading}>
            Cancel
          </button>
          <button class="btn-primary" @click=${this._handleSubmit} ?disabled=${this.loading}>
            ${this.loading
              ? html`<span class="btn-loading"><span class="spinner"></span>Executing...</span>`
              : 'Execute'}
          </button>
        </div>
      </div>
    `;
  }

  private _renderFields() {
    // Handle standard JSON Schema 'properties'
    const properties = (this.params as any).properties || this.params;
    const requiredList = (this.params as any).required || [];

    // Check if properties is actual object to avoid crash
    if (!properties || typeof properties !== 'object') {
      return html`<p>No parameters required.</p>`;
    }

    return Object.entries(properties).map(([key, schema]: [string, any]) => {
      const isRequired = Array.isArray(requiredList)
        ? requiredList.includes(key)
        : !!schema.required;
      const error = this._errors[key];

      return html`
        <div class="form-group">
          <label>
            ${key} ${isRequired ? html`<span style="color: var(--accent-secondary)">*</span>` : ''}
            ${schema.description ? html`<span class="hint">${schema.description}</span>` : ''}
          </label>
          ${this._renderInput(key, schema, !!error)}
          ${error ? html`<div class="error-text">${error}</div>` : ''}
        </div>
      `;
    });
  }

  private _renderInput(key: string, schema: MethodParam, hasError = false) {
    const isBoolean = schema.type === 'boolean' || (schema as any).type === '"boolean"';
    const errorClass = hasError ? 'error' : '';

    // Handle Boolean -> Toggle Switch
    if (isBoolean) {
      return html`
        <label class="switch">
          <input
            type="checkbox"
            .checked=${!!this._values[key]}
            @change=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).checked)}
          />
          <span class="slider"></span>
        </label>
      `;
    }

    // Handle Array of Enums -> Multiselect
    if (schema.type === 'array' && (schema as any).items?.enum) {
      const enumValues = (schema as any).items.enum as string[];
      const selectedValues = (this._values[key] as string[]) || [];

      return html`
        <div class="multiselect-container">
          ${enumValues.map(
            (val) => html`
              <label
                class="multiselect-option ${selectedValues.includes(val) ? 'selected' : ''}"
                @click=${() => this._toggleMultiselect(key, val)}
              >
                <input
                  type="checkbox"
                  .checked=${selectedValues.includes(val)}
                  @click=${(e: Event) => e.stopPropagation()}
                  @change=${() => this._toggleMultiselect(key, val)}
                />
                ${val}
              </label>
            `
          )}
        </div>
      `;
    }

    // Handle Enums -> Select Dropdown
    if ((schema as any).enum) {
      const currentValue = this._values[key] || '';
      return html`
        <select
          class="${errorClass}"
          .value=${currentValue}
          @change=${(e: Event) => this._handleChange(key, (e.target as HTMLSelectElement).value)}
        >
          <option value="">Select...</option>
          ${(schema as any).enum.map(
            (val: string) => html`
              <option value=${val} ?selected=${val === currentValue}>${val}</option>
            `
          )}
        </select>
      `;
    }

    // Handle Number with min/max -> Number Input with Range Slider
    if (schema.type === 'number' || schema.type === 'integer') {
      const hasRange =
        (schema as any).minimum !== undefined && (schema as any).maximum !== undefined;
      const min = (schema as any).minimum ?? 0;
      const max = (schema as any).maximum ?? 100;
      const step = schema.type === 'integer' ? 1 : 0.1;
      const currentValue = this._values[key] ?? (schema as any).default ?? min;

      if (hasRange) {
        return html`
          <div class="number-with-range">
            <div class="number-input-row">
              <input
                type="number"
                class="${errorClass}"
                min="${min}"
                max="${max}"
                step="${step}"
                .value=${String(currentValue)}
                @input=${(e: Event) =>
                  this._handleChange(key, Number((e.target as HTMLInputElement).value))}
              />
              <input
                type="range"
                min="${min}"
                max="${max}"
                step="${step}"
                .value=${String(currentValue)}
                @input=${(e: Event) =>
                  this._handleChange(key, Number((e.target as HTMLInputElement).value))}
              />
            </div>
            <div class="range-labels">
              <span>${min}</span>
              <span>${max}</span>
            </div>
          </div>
        `;
      }

      return html`
        <input
          type="number"
          class="${errorClass}"
          .value=${this._values[key] !== undefined ? String(this._values[key]) : ''}
          @input=${(e: Event) =>
            this._handleChange(key, Number((e.target as HTMLInputElement).value))}
        />
      `;
    }

    // Handle File Paths -> File Picker
    // Heuristic: Key contains "path", "file", "dir" or schema.format matches
    const isFile =
      key.toLowerCase().includes('path') ||
      key.toLowerCase().includes('file') ||
      (schema as any).format === 'path' ||
      (schema as any).format === 'file';

    if (isFile) {
      // Support @accept filter from schema (e.g., ".ts,.js" or "*.photon.ts")
      const acceptFilter = (schema as any).accept || '';
      return html`
        <file-picker
          .value=${this._values[key] || ''}
          .hasError=${hasError}
          .accept=${acceptFilter}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></file-picker>
      `;
    }

    // Heuristic: Use textarea for keys suggesting multi-line content
    const lowerKey = key.toLowerCase();
    const lowerDesc = ((schema as any).description || '').toLowerCase();
    const multiLineKeys = ['code', 'content', 'body', 'script', 'query', 'sql',
      'html', 'json', 'yaml', 'xml', 'markdown', 'template', 'snippet', 'source'];
    const isMultiLine =
      multiLineKeys.some(k => lowerKey === k || lowerKey.endsWith('_' + k) || lowerKey.endsWith(k.charAt(0).toUpperCase() + k.slice(1))) ||
      lowerDesc.includes('multi-line') ||
      lowerDesc.includes('multiline') ||
      (schema as any).format === 'textarea';

    if (isMultiLine) {
      return html`
        <textarea
          class="${errorClass}"
          rows="6"
          .value=${this._values[key] || ''}
          @input=${(e: Event) => this._handleChange(key, (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      `;
    }

    // Default -> Text Input
    return html`
      <input
        type="text"
        class="${errorClass}"
        .value=${this._values[key] || ''}
        @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  private _toggleMultiselect(key: string, value: string) {
    const currentValues = (this._values[key] as string[]) || [];
    let newValues: string[];

    if (currentValues.includes(value)) {
      newValues = currentValues.filter((v) => v !== value);
    } else {
      newValues = [...currentValues, value];
    }

    this._values = { ...this._values, [key]: newValues };
    if (this.rememberValues) {
      this._savePersistedValues();
    }
  }

  private _handleChange(key: string, value: any) {
    this._values = { ...this._values, [key]: value };
    if (this.rememberValues) {
      this._savePersistedValues();
    }
  }

  private _handleSubmit() {
    // Validate required fields
    const properties = (this.params as any).properties || this.params;
    const requiredList = (this.params as any).required || [];
    const errors: Record<string, string> = {};

    if (properties && typeof properties === 'object') {
      for (const [key, schema] of Object.entries(properties)) {
        const isRequired = Array.isArray(requiredList)
          ? requiredList.includes(key)
          : !!(schema as any).required;

        if (isRequired) {
          const value = this._values[key];
          if (value === undefined || value === null || value === '') {
            errors[key] = 'This field is required';
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      this._errors = errors;
      showToast('Please fill in all required fields', 'warning');
      return;
    }

    this._errors = {};
    this.dispatchEvent(new CustomEvent('submit', { detail: { args: this._values } }));
  }

  private _handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }
}
