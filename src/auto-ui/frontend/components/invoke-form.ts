import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, buttons, forms } from '../styles/index.js';
import { showToast } from './toast-manager.js';
import { formatLabel } from '../utils/format-label.js';

/** Convert plural field names to singular for button labels */
function singularize(word: string): string {
  // Common irregular plurals
  const irregulars: Record<string, string> = {
    entities: 'entity',
    entries: 'entry',
    indices: 'index',
    matrices: 'matrix',
    vertices: 'vertex',
    analyses: 'analysis',
    criteria: 'criterion',
    phenomena: 'phenomenon',
    children: 'child',
    people: 'person',
  };
  const lower = word.toLowerCase();
  if (irregulars[lower]) return irregulars[lower];
  // Standard rules
  if (lower.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (
    lower.endsWith('es') &&
    (lower.endsWith('sses') ||
      lower.endsWith('xes') ||
      lower.endsWith('ches') ||
      lower.endsWith('shes'))
  ) {
    return word.slice(0, -2);
  }
  if (lower.endsWith('s') && !lower.endsWith('ss')) return word.slice(0, -1);
  return word;
}

interface MethodParam {
  type: string;
  description?: string;
  required?: boolean;
}

@customElement('invoke-form')
export class InvokeForm extends LitElement {
  static styles = [
    theme,
    buttons,
    forms,
    css`
      :host {
        display: block;
      }

      .form-container {
        padding: var(--space-lg);
      }

      .hint {
        font-size: var(--text-sm);
        color: var(--t-muted);
        margin-left: var(--space-xs);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-md);
        margin-top: var(--space-lg);
        padding-top: var(--space-md);
        border-top: 1px solid var(--border-glass);
      }

      .actions.no-params {
        margin-top: 0;
        padding-top: 0;
        border-top: none;
      }

      .cli-preview {
        margin-top: var(--space-md);
        background: var(--cli-bg);
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-sm);
        padding: 12px 16px;
        font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      }

      .cli-preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }

      .cli-preview-label {
        font-size: var(--text-2xs);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--cli-muted);
        font-family: inherit;
      }

      .cli-preview-copy {
        font-size: var(--text-2xs);
        font-family: inherit;
        background: none;
        border: none;
        color: var(--cli-muted);
        cursor: pointer;
        padding: 2px 6px;
        border-radius: var(--radius-xs);
        transition: all 0.15s;
      }

      .cli-preview-copy:hover {
        color: var(--t-muted);
        background: var(--cli-hover-bg);
      }

      .cli-preview-cmd {
        font-family: inherit;
        font-size: var(--text-md);
        color: var(--cli-text);
        word-break: break-all;
        line-height: 1.6;
      }

      .cli-preview-cmd::before {
        content: '$ ';
        color: var(--cli-muted);
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

      /* View Mode Tabs */
      .view-tabs {
        display: flex;
        gap: 0;
        margin-bottom: var(--space-md);
        border-bottom: 1px solid var(--border-glass);
      }

      .view-tab {
        padding: var(--space-sm) var(--space-md);
        background: none;
        border: none;
        color: var(--t-muted);
        cursor: pointer;
        font-size: var(--text-md);
        font-weight: 500;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition: all 0.2s;
      }

      .view-tab:hover {
        color: var(--t-primary);
      }

      .view-tab.active {
        color: var(--accent-primary);
        border-bottom-color: var(--accent-primary);
      }

      /* Array Items */
      .array-container {
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        padding: var(--space-sm);
      }

      .array-item {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        padding: var(--space-md);
        margin-bottom: var(--space-sm);
        position: relative;
      }

      .array-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-sm);
        padding-bottom: var(--space-xs);
        border-bottom: 1px solid var(--border-glass);
      }

      .array-item-title {
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--t-muted);
      }

      .array-item-remove {
        background: none;
        border: none;
        color: var(--color-error);
        cursor: pointer;
        font-size: var(--text-xs);
        padding: 2px 6px;
        border-radius: var(--radius-xs);
      }

      .array-item-remove:hover {
        background: var(--color-error-bg);
      }

      .array-add-btn {
        width: 100%;
        padding: var(--space-sm);
        background: var(--bg-glass);
        border: 1px dashed var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--t-muted);
        cursor: pointer;
        font-size: var(--text-md);
        transition: all 0.2s;
      }

      .array-add-btn:hover {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
      }

      .nested-field {
        margin-bottom: var(--space-sm);
      }

      .nested-field:last-child {
        margin-bottom: 0;
      }

      .nested-label {
        font-size: var(--text-sm);
        color: var(--t-muted);
        margin-bottom: var(--space-xs);
        display: block;
      }

      .nested-hint {
        font-size: var(--text-xs);
        color: var(--t-muted);
        opacity: 0.7;
        margin-left: var(--space-xs);
      }

      /* JSON Editor */
      .json-editor {
        width: 100%;
        min-height: 200px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        font-family: var(--font-mono, monospace);
        font-size: var(--text-md);
        line-height: 1.5;
        resize: vertical;
      }

      .json-editor:focus-visible {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .json-editor.error {
        border-color: var(--color-error);
      }

      .json-error {
        color: var(--color-error);
        font-size: var(--text-xs);
        margin-top: var(--space-xs);
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
        border-radius: var(--radius-xs);
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
        font-size: var(--text-xs);
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
          flex-direction: column-reverse;
          gap: var(--space-sm);
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

  @state()
  private _viewMode: 'form' | 'json' = 'form';

  @state()
  private _jsonText = '';

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
    const properties = (this.params as any)?.properties || this.params;
    const hasParams =
      properties && typeof properties === 'object' && Object.keys(properties).length > 0;

    // For no-param methods, show minimal UI with just a re-execute button
    if (!hasParams) {
      return html`
        <div class="form-container">
          <div class="actions no-params">
            <button class="btn-secondary" @click=${this._handleCancel} ?disabled=${this.loading}>
              Cancel
            </button>
            <button class="btn-primary" @click=${this._handleSubmit} ?disabled=${this.loading}>
              ${this.loading
                ? html`<span class="btn-loading"><span class="spinner"></span>Executing...</span>`
                : 'Re-execute'}
            </button>
          </div>
        </div>
      `;
    }

    // Check if we have complex types that benefit from JSON view
    const hasComplexTypes = this._hasComplexTypes();

    return html`
      <div class="form-container">
        ${hasComplexTypes
          ? html`
              <div class="view-tabs">
                <button
                  class="view-tab ${this._viewMode === 'form' ? 'active' : ''}"
                  @click=${() => this._switchToFormView()}
                >
                  Form
                </button>
                <button
                  class="view-tab ${this._viewMode === 'json' ? 'active' : ''}"
                  @click=${() => this._switchToJsonView()}
                >
                  JSON
                </button>
              </div>
            `
          : ''}
        ${this._viewMode === 'form' ? this._renderFields() : this._renderJsonEditor()}

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
        ${this._renderCliCommand()}
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
            ${formatLabel(key)}
            ${isRequired ? html`<span style="color: var(--accent-secondary)">*</span>` : ''}
            ${schema.description
              ? html`<span class="hint"
                  >${this._cleanDescription(schema.description, schema)}</span
                >`
              : ''}
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

    // Handle Array of Objects -> Repeatable Mini-Forms (Swagger-style)
    if (schema.type === 'array' && (schema as any).items?.type === 'object') {
      return this._renderArrayOfObjects(key, schema, hasError);
    }

    // Handle Object with Properties -> Nested Sub-Fields
    if (
      schema.type === 'object' &&
      (schema as any).properties &&
      Object.keys((schema as any).properties).length > 0
    ) {
      return this._renderObjectFields(key, schema, hasError);
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
      const step =
        schema.type === 'integer' ||
        (Number.isInteger(min) && Number.isInteger(max) && !(schema as any).multipleOf)
          ? 1
          : ((schema as any).multipleOf ?? 0.1);
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
    // Primary: JSDoc {@format path|file|directory} and {@accept ...} annotations
    // Fallback: heuristic based on param name (path, file, dir)
    const fmt = (schema as any).format;
    const schemaAccept = (schema as any).accept || '';
    const isFileBySchema = fmt === 'path' || fmt === 'file' || fmt === 'directory';
    const lk = key.toLowerCase();
    // Heuristic: key must strongly suggest a single file/directory path, not just contain
    // 'file' or 'dir' as part of a broader concept (e.g. fileTypes, profileName).
    // Require 'path' anywhere, OR 'dir'/'folder' anywhere, OR 'file' only as a whole word
    // or at the end of the key (e.g. file, configFile, inputFile — not fileTypes, fileSize).
    const isFileByHeuristic =
      !fmt &&
      (lk.includes('path') ||
        lk.includes('dir') ||
        lk.includes('folder') ||
        lk === 'file' ||
        lk.endsWith('file') ||
        lk.endsWith('_file'));

    if (isFileBySchema || isFileByHeuristic) {
      const isDir = fmt === 'directory' || (!fmt && (lk.includes('dir') || lk.includes('folder')));
      const defaultVal = (schema as any).default;
      const placeholder = defaultVal ? String(defaultVal) : '';
      return html`
        <file-picker
          .value=${this._values[key] || ''}
          .hasError=${hasError}
          .accept=${schemaAccept}
          .mode=${isDir ? 'directory' : 'file'}
          .photonName=${this.photonName}
          .placeholder=${placeholder}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></file-picker>
      `;
    }

    // Heuristic: Use textarea for keys suggesting multi-line content
    const lowerKey = key.toLowerCase();
    const lowerDesc = ((schema as any).description || '').toLowerCase();
    const multiLineKeys = [
      'code',
      'content',
      'body',
      'script',
      'query',
      'sql',
      'html',
      'json',
      'yaml',
      'xml',
      'markdown',
      'template',
      'snippet',
      'source',
    ];
    const isMultiLine =
      multiLineKeys.some(
        (k) =>
          lowerKey === k ||
          lowerKey.endsWith('_' + k) ||
          lowerKey.endsWith(k.charAt(0).toUpperCase() + k.slice(1))
      ) ||
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

    // Heuristic: Detect enum-like values from description pattern "(val1, val2, val3)"
    // This catches cases where the photon author listed valid values in the description
    // but didn't declare an enum in the schema.
    if (schema.type === 'string' || !schema.type) {
      const desc = (schema as any).description || '';
      const enumMatch = desc.match(/\(([^)]+)\)\s*$/);
      if (enumMatch) {
        const candidates = enumMatch[1].split(',').map((s: string) => s.trim());
        // Only use as dropdown if we have 2-10 short, simple values
        if (
          candidates.length >= 2 &&
          candidates.length <= 10 &&
          candidates.every((c: string) => /^[\w-]+$/.test(c) && c.length <= 30)
        ) {
          const currentValue = this._values[key] || '';
          return html`
            <select
              class="${errorClass}"
              .value=${currentValue}
              @change=${(e: Event) =>
                this._handleChange(key, (e.target as HTMLSelectElement).value)}
            >
              <option value="">Select...</option>
              ${candidates.map(
                (val: string) => html`
                  <option value=${val} ?selected=${val === currentValue}>${val}</option>
                `
              )}
            </select>
          `;
        }
      }
    }

    // Default -> Text Input
    const defaultVal = (schema as any).default;
    const placeholder = defaultVal != null ? String(defaultVal) : '';
    return html`
      <input
        type="text"
        class="${errorClass}"
        placeholder="${placeholder}"
        .value=${this._values[key] || ''}
        @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  /**
   * Strip enum values from description when they're already shown in a dropdown.
   * Patterns removed:
   *   'val1' | 'val2' | 'val3'
   *   'val1', 'val2', 'val3'
   *   (val1, val2, val3)  — parenthetical enum list
   *   (default: 'val')
   *   Trailing colon after removal
   */
  private _cleanDescription(desc: string, schema: any): string {
    if (!desc) return desc;
    // Remove quoted-value union patterns with optional parenthetical descriptions:
    // 'a' | 'b' | 'c'  OR  'a' (desc) | 'b' (desc) | 'c' (desc)
    let cleaned = desc.replace(
      /['"][\w-]+['"]\s*(?:\([^)]*\)\s*)?(?:\|\s*['"][\w-]+['"]\s*(?:\([^)]*\)\s*)?)+/g,
      ''
    );
    // Remove quoted comma-separated value lists: 'a', 'b', 'c'
    cleaned = cleaned.replace(/['"][\w-]+['"]\s*(?:,\s*['"][\w-]+['"]\s*)+/g, '');
    // Remove parenthetical enum value lists: (val1, val2, val3)
    if (schema?.enum && schema.enum.length >= 2) {
      // Schema has enum: only strip if contents match declared enum values
      const enumSet = new Set(schema.enum.map((v: string) => String(v).toLowerCase()));
      cleaned = cleaned.replace(/\(([^)]+)\)/g, (match, inner) => {
        const parts = inner.split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
        const isEnumList =
          parts.length >= 2 && parts.every((p: string) => enumSet.has(p.toLowerCase()));
        return isEnumList ? '' : match;
      });
    } else {
      // No schema enum: strip parentheticals that look like enum lists —
      // 3+ simple lowercase terms (no spaces/punctuation within each term)
      cleaned = cleaned.replace(/\(([^)]+)\)/g, (match, inner) => {
        const parts = inner.split(',').map((s: string) => s.trim());
        const looksLikeEnumList =
          parts.length >= 3 && parts.every((p: string) => /^[\w-]+$/.test(p));
        return looksLikeEnumList ? '' : match;
      });
    }
    // Remove standalone (default: 'value') or (default: value)
    cleaned = cleaned.replace(/\(default:\s*['"]?[\w-]+['"]?\)/gi, '');
    // Collapse leftover whitespace and trailing colon/punctuation
    cleaned = cleaned
      .replace(/:\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned;
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

  private _buildCliCommand(): string {
    const parts = ['photon', 'cli', this.photonName, this.methodName];
    for (const [key, value] of Object.entries(this._values)) {
      if (value === undefined || value === null || value === '') continue;
      // Serialize objects and arrays as JSON
      const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
      // Quote values with spaces or special characters
      if (strVal.includes(' ') || strVal.includes('"') || strVal.includes("'")) {
        parts.push(`--${key}`, `'${strVal.replace(/'/g, "\\'")}'`);
      } else {
        parts.push(`--${key}`, strVal);
      }
    }
    return parts.join(' ');
  }

  private _renderCliCommand() {
    const cmd = this._buildCliCommand();
    return html`
      <div class="cli-preview">
        <div class="cli-preview-header">
          <span class="cli-preview-label">CLI</span>
          <button
            class="cli-preview-copy"
            @click=${() => {
              navigator.clipboard.writeText(cmd);
              showToast('Command copied', 'success');
            }}
          >
            Copy
          </button>
        </div>
        <code class="cli-preview-cmd">${cmd}</code>
      </div>
    `;
  }

  /** Check if schema has complex types (array of objects) that benefit from JSON view */
  private _hasComplexTypes(): boolean {
    const properties = (this.params as any)?.properties || this.params;
    if (!properties || typeof properties !== 'object') return false;

    return Object.values(properties).some((schema: any) => {
      return schema.type === 'array' && schema.items?.type === 'object';
    });
  }

  /** Switch to form view, parsing JSON if valid */
  private _switchToFormView() {
    if (this._viewMode === 'json' && this._jsonText) {
      try {
        this._values = JSON.parse(this._jsonText);
      } catch {
        showToast('Invalid JSON - cannot switch to form view', 'error');
        return;
      }
    }
    this._viewMode = 'form';
  }

  /** Switch to JSON view, serializing current values */
  private _switchToJsonView() {
    this._jsonText = JSON.stringify(this._values, null, 2);
    this._viewMode = 'json';
  }

  /** Render JSON editor view */
  private _renderJsonEditor() {
    return html`
      <textarea
        class="json-editor"
        .value=${this._jsonText}
        @input=${(e: Event) => {
          this._jsonText = (e.target as HTMLTextAreaElement).value;
          // Try to parse and sync to _values
          try {
            this._values = JSON.parse(this._jsonText);
            if (this.rememberValues) {
              this._savePersistedValues();
            }
          } catch {
            // Invalid JSON - will show error on submit
          }
        }}
        placeholder="Enter JSON..."
      ></textarea>
    `;
  }

  /** Render an object parameter with sub-fields for each property */
  private _renderObjectFields(key: string, schema: any, _hasError: boolean) {
    const properties = (schema as any).properties || {};
    const requiredList = (schema as any).required || [];
    const currentObj = (this._values[key] as Record<string, any>) || {};

    const handleFieldChange = (propKey: string, newValue: any) => {
      const updated = { ...currentObj, [propKey]: newValue };
      this._values = { ...this._values, [key]: updated };
      if (this.rememberValues) {
        this._savePersistedValues();
      }
    };

    return html`
      <div class="array-container">
        ${Object.entries(properties).map(([propKey, propSchema]: [string, any]) => {
          const isRequired = requiredList.includes(propKey);
          return html`
            <div class="nested-field">
              <label class="nested-label">
                ${formatLabel(propKey)}
                ${isRequired ? html`<span style="color: var(--accent-secondary)">*</span>` : ''}
                ${propSchema.description
                  ? html`<span class="nested-hint"
                      >${this._cleanDescription(propSchema.description, propSchema)}</span
                    >`
                  : ''}
              </label>
              ${this._renderObjectSubInput(
                propKey,
                propSchema,
                currentObj[propKey],
                handleFieldChange
              )}
            </div>
          `;
        })}
      </div>
    `;
  }

  /** Render input for a sub-field within an object parameter */
  private _renderObjectSubInput(
    propKey: string,
    schema: any,
    value: any,
    onChange: (key: string, val: any) => void
  ) {
    if (schema.enum) {
      return html`
        <select
          .value=${value || ''}
          @change=${(e: Event) => onChange(propKey, (e.target as HTMLSelectElement).value)}
        >
          <option value="">Select...</option>
          ${schema.enum.map(
            (opt: string) => html` <option value=${opt} ?selected=${opt === value}>${opt}</option> `
          )}
        </select>
      `;
    }
    if (schema.type === 'boolean') {
      return html`
        <label class="switch">
          <input
            type="checkbox"
            .checked=${!!value}
            @change=${(e: Event) => onChange(propKey, (e.target as HTMLInputElement).checked)}
          />
          <span class="slider"></span>
        </label>
      `;
    }
    if (schema.type === 'number' || schema.type === 'integer') {
      return html`
        <input
          type="number"
          .value=${value !== undefined ? String(value) : ''}
          @input=${(e: Event) => onChange(propKey, Number((e.target as HTMLInputElement).value))}
        />
      `;
    }
    // Default: text input
    return html`
      <input
        type="text"
        .value=${value || ''}
        placeholder=${schema.default != null ? String(schema.default) : ''}
        @input=${(e: Event) => onChange(propKey, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  /** Render array of objects with repeatable mini-forms */
  private _renderArrayOfObjects(key: string, schema: any, hasError: boolean) {
    const items = (this._values[key] as any[]) || [];
    const itemSchema = schema.items;
    const itemProperties = itemSchema?.properties || {};
    const itemRequired = itemSchema?.required || [];

    return html`
      <div class="array-container">
        ${items.map(
          (item, index) => html`
            <div class="array-item">
              <div class="array-item-header">
                <span class="array-item-title">Item ${index + 1}</span>
                <button class="array-item-remove" @click=${() => this._removeArrayItem(key, index)}>
                  ✕ Remove
                </button>
              </div>
              ${Object.entries(itemProperties).map(([propKey, propSchema]: [string, any]) => {
                const isRequired = itemRequired.includes(propKey);
                return html`
                  <div class="nested-field">
                    <label class="nested-label">
                      ${formatLabel(propKey)}
                      ${isRequired
                        ? html`<span style="color: var(--accent-secondary)">*</span>`
                        : ''}
                      ${propSchema.description
                        ? html`<span class="nested-hint"
                            >${this._cleanDescription(propSchema.description, propSchema)}</span
                          >`
                        : ''}
                    </label>
                    ${this._renderNestedInput(key, index, propKey, propSchema, item[propKey])}
                  </div>
                `;
              })}
            </div>
          `
        )}
        <button class="array-add-btn" @click=${() => this._addArrayItem(key, itemProperties)}>
          + Add ${singularize(key)}
        </button>
      </div>
    `;
  }

  /** Render input for nested field within array item */
  private _renderNestedInput(
    arrayKey: string,
    index: number,
    propKey: string,
    schema: any,
    value: any
  ) {
    const handleNestedChange = (newValue: any) => {
      const items = [...(this._values[arrayKey] || [])];
      items[index] = { ...items[index], [propKey]: newValue };
      this._values = { ...this._values, [arrayKey]: items };
      if (this.rememberValues) {
        this._savePersistedValues();
      }
    };

    // Handle array of strings (like observations)
    if (schema.type === 'array' && schema.items?.type === 'string') {
      const arrValue = (value as string[]) || [];
      return html`
        <div class="array-container" style="padding: 4px;">
          ${arrValue.map(
            (item, i) => html`
              <div style="display: flex; gap: 4px; margin-bottom: 4px;">
                <input
                  type="text"
                  style="flex: 1;"
                  .value=${item}
                  @input=${(e: Event) => {
                    const newArr = [...arrValue];
                    newArr[i] = (e.target as HTMLInputElement).value;
                    handleNestedChange(newArr);
                  }}
                />
                <button
                  class="array-item-remove"
                  @click=${() => {
                    const newArr = arrValue.filter((_, idx) => idx !== i);
                    handleNestedChange(newArr);
                  }}
                >
                  ✕
                </button>
              </div>
            `
          )}
          <button
            class="array-add-btn"
            style="padding: 4px; font-size: 0.75rem;"
            @click=${() => handleNestedChange([...arrValue, ''])}
          >
            + Add ${singularize(propKey)}
          </button>
        </div>
      `;
    }

    // Handle enum
    if (schema.enum) {
      return html`
        <select
          .value=${value || ''}
          @change=${(e: Event) => handleNestedChange((e.target as HTMLSelectElement).value)}
        >
          <option value="">Select...</option>
          ${schema.enum.map(
            (opt: string) => html` <option value=${opt} ?selected=${opt === value}>${opt}</option> `
          )}
        </select>
      `;
    }

    // Handle boolean
    if (schema.type === 'boolean') {
      return html`
        <input
          type="checkbox"
          .checked=${!!value}
          @change=${(e: Event) => handleNestedChange((e.target as HTMLInputElement).checked)}
        />
      `;
    }

    // Handle number
    if (schema.type === 'number' || schema.type === 'integer') {
      return html`
        <input
          type="number"
          .value=${value !== undefined ? String(value) : ''}
          @input=${(e: Event) => handleNestedChange(Number((e.target as HTMLInputElement).value))}
        />
      `;
    }

    // Default: text input
    return html`
      <input
        type="text"
        .value=${value || ''}
        @input=${(e: Event) => handleNestedChange((e.target as HTMLInputElement).value)}
      />
    `;
  }

  /** Add empty item to array */
  private _addArrayItem(key: string, itemProperties: Record<string, any>) {
    const items = [...(this._values[key] || [])];
    // Create empty item with default values based on schema
    const newItem: Record<string, any> = {};
    for (const [propKey, propSchema] of Object.entries(itemProperties) as [string, any][]) {
      if (propSchema.type === 'array') {
        newItem[propKey] = [];
      } else if (propSchema.type === 'boolean') {
        newItem[propKey] = false;
      } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
        newItem[propKey] = propSchema.default ?? 0;
      } else {
        newItem[propKey] = propSchema.default ?? '';
      }
    }
    items.push(newItem);
    this._values = { ...this._values, [key]: items };
    if (this.rememberValues) {
      this._savePersistedValues();
    }
  }

  /** Remove item from array */
  private _removeArrayItem(key: string, index: number) {
    const items = [...(this._values[key] || [])];
    items.splice(index, 1);
    this._values = { ...this._values, [key]: items };
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
