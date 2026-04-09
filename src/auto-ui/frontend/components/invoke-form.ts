import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { theme, buttons, forms } from '../styles/index.js';
import { showToast } from './toast-manager.js';
import { confirmElicit } from '../utils/elicit.js';
import { formatLabel } from '../utils/format-label.js';
import { mcpClient } from '../services/mcp-client.js';

/**
 * Capitalize an enum value for display purposes.
 * The submitted value is always the original; this only affects display text.
 * Handles known acronyms (ai → AI, url → URL, etc.) via formatLabel.
 */
function capitalizeEnumValue(val: string): string {
  // Use formatLabel to handle acronyms properly (ai → AI, id → ID, etc.)
  // formatLabel expects camelCase/snake_case but also handles plain lowercase words
  return formatLabel(val);
}

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

/** Determine if a character is valid for a given format */
function isValidCharForFormat(char: string, format?: string, position?: number): boolean {
  if (!format) return true; // No format restriction

  switch (format.toLowerCase()) {
    case 'email':
      // Allow: letters, digits, @, ., -, _, +
      return /[a-zA-Z0-9@.\-_+]/.test(char);

    case 'url':
    case 'uri':
      // Allow: letters, digits, :, /, -, _, ., ?, =, &, #, %, @, +, ~, ;, ,, !
      return /[a-zA-Z0-9:\/\-_.?=&#%@+~;,!]/.test(char);

    case 'uuid':
      // Allow: hex digits (0-9, a-f, A-F) and hyphens
      return /[0-9a-fA-F\-]/.test(char);

    case 'ipv4':
      // Allow: digits and dots
      return /[0-9.]/.test(char);

    case 'ipv6':
      // Allow: hex digits, colons
      return /[0-9a-fA-F:]/.test(char);

    case 'slug':
      // Allow: lowercase letters, digits, hyphens
      return /[a-z0-9\-]/.test(char);

    case 'hex':
      // Allow: hex digits and #
      return position === 0 && char === '#' ? true : /[0-9a-fA-F]/.test(char);

    case 'phone':
      // Allow: digits, +, -, (, ), space
      return /[0-9+\-() ]/.test(char);

    default:
      return true;
  }
}

/** JSON Schema property descriptor used by the form renderer */
interface MethodParam {
  type: string;
  description?: string;
  required?: boolean | string[];
  /** Enum values for select dropdowns */
  enum?: string[];
  /** Default value */
  default?: string | number | boolean | null;
  /** JSON Schema format (date, email, textarea, path, etc.) */
  format?: string;
  /** Regex pattern constraint */
  pattern?: string;
  /** Numeric constraints */
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  /** String constraints */
  minLength?: number;
  maxLength?: number;
  /** File accept filter */
  accept?: string;
  /** Array item schema */
  items?: MethodParam;
  /** Nested object properties */
  properties?: Record<string, MethodParam>;
  /** Extension: choice-from reference */
  'x-choiceFrom'?: string;
}

/** Top-level JSON Schema object with properties and required list */
interface JsonSchemaParams {
  properties?: Record<string, MethodParam>;
  required?: string[];
}

/** MCP tool call result shape */
interface MCPToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
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
        transition: background 0.15s ease;
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

      .hint {
        font-size: var(--text-xs);
        color: var(--t-muted);
        margin-top: 2px;
      }

      /* Slider-First Numeric Input */
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
        /* Default unfilled track — overridden by inline style for fill effect */
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

      /* Clean numeric input — no spinner, mouse wheel support */
      .number-input-clean {
        width: 100%;
        padding: 8px 12px;
        font-size: var(--text-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--t-primary);
        appearance: none;
        -moz-appearance: textfield;
        -webkit-appearance: none;
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .number-input-clean::-webkit-outer-spin-button,
      .number-input-clean::-webkit-inner-spin-button {
        -webkit-appearance: none;
        appearance: none;
        display: none;
        margin: 0;
      }

      .number-input-clean:hover {
        border-color: var(--accent-primary);
      }

      .number-input-clean:focus-visible {
        outline: none;
        border-color: var(--accent-primary);
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

      .date-range-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .date-range-row .date-input {
        flex: 1;
      }

      .date-range-arrow {
        color: var(--t-muted);
        font-size: var(--text-lg);
        flex-shrink: 0;
      }

      select {
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        padding-right: 32px;
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

        .slider-row {
          flex-wrap: wrap;
        }

        .slider-number-input {
          width: 100%;
        }

        .date-range-row {
          flex-direction: column;
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
  params: JsonSchemaParams | Record<string, MethodParam> = {};

  @property({ type: Boolean })
  loading = false;

  @state() private _elapsedMs = 0;
  private _timerInterval: ReturnType<typeof setInterval> | null = null;
  private _loadingStartTime = 0;

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

  /** Render in two-column settings layout */
  @property({ type: Boolean })
  settingsLayout = false;

  @state()
  private _values: Record<string, any> = {};

  private _initialValues: Record<string, any> = {};

  private _passwordVisible: Record<string, boolean> = {};

  @state()
  private _errors: Record<string, string> = {};

  /** Resolved params with x-choiceFrom populated as enum */
  @state()
  private _resolvedParams: Record<string, any> | null = null;

  /** Track which choice-from keys are currently loading */
  @state()
  private _choiceFromLoading = new Set<string>();

  /** Retry timer for unresolved choice-from fields */
  private _choiceFromRetryTimer: number | null = null;

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
    // Resolve x-choiceFrom fields when params change
    if (changedProps.has('params') || changedProps.has('photonName')) {
      void this._resolveChoiceFromFields();
    }
    // Apply shared values from URL (takes priority over persisted values)
    if (
      changedProps.has('sharedValues') &&
      this.sharedValues &&
      Object.keys(this.sharedValues).length > 0
    ) {
      this._values = { ...this._values, ...this.sharedValues };
      showToast('Form pre-filled from shared link', 'info');
    }
    // Execution timer
    if (changedProps.has('loading')) {
      if (this.loading) {
        this._loadingStartTime = Date.now();
        this._elapsedMs = 0;
        this._timerInterval = setInterval(() => {
          this._elapsedMs = Date.now() - this._loadingStartTime;
        }, 100);
      } else if (this._timerInterval) {
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    if (this._choiceFromRetryTimer) {
      clearTimeout(this._choiceFromRetryTimer);
      this._choiceFromRetryTimer = null;
    }
  }

  private _loadPersistedValues() {
    if (!this.photonName || !this.methodName) return;

    // Only load persisted values if remember is enabled
    if (!this.rememberValues) {
      this._values = {};
      this._initialValues = {};
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
    this._initialValues = { ...this._values };
  }

  /**
   * Resolve x-choiceFrom fields by calling the referenced tool via MCP.
   * Populates enum on the resolved params copy so the form renders dropdowns.
   */
  private async _resolveChoiceFromFields() {
    if (!this.photonName || !this.params) {
      this._resolvedParams = null;
      return;
    }

    const props = (this.params as JsonSchemaParams)?.properties;
    if (!props) {
      this._resolvedParams = null;
      return;
    }

    // Check if any fields have x-choiceFrom
    const choiceFromFields = Object.entries(props).filter(
      ([, schema]: [string, any]) => schema['x-choiceFrom']
    );
    if (choiceFromFields.length === 0) {
      this._resolvedParams = null;
      return;
    }

    // Deep clone params to avoid mutating the original
    const resolved = JSON.parse(JSON.stringify(this.params));
    let hasUnresolved = false;

    for (const [key, schema] of choiceFromFields) {
      const choiceFrom = schema['x-choiceFrom'] as string;
      const dotIdx = choiceFrom.indexOf('.');
      const toolName = dotIdx >= 0 ? choiceFrom.substring(0, dotIdx) : choiceFrom;
      const fieldName = dotIdx >= 0 ? choiceFrom.substring(dotIdx + 1) : null;

      this._choiceFromLoading.add(key);
      this._choiceFromLoading = new Set(this._choiceFromLoading);

      try {
        const result = await mcpClient.callTool(`${this.photonName}/${toolName}`, {});
        let values: string[] = [];

        // Parse the MCP tool result — content is an array of { type, text } blocks
        let data: unknown = result;
        const mcpResult = result as MCPToolResult;
        if (result && Array.isArray(mcpResult.content)) {
          // Skip error results (e.g., "Not connected")
          if (mcpResult.isError) {
            hasUnresolved = true;
            continue;
          }
          const textBlock = mcpResult.content.find((c) => c.type === 'text');
          if (textBlock?.text) {
            try {
              data = JSON.parse(textBlock.text);
            } catch {
              data = textBlock.text;
            }
          }
        }

        if (Array.isArray(data)) {
          values = data.map((item: any) => {
            if (typeof item === 'string') return item;
            if (fieldName && item && typeof item === 'object' && item[fieldName] != null) {
              return String(item[fieldName]);
            }
            if (item && typeof item === 'object') {
              for (const k of ['name', 'label', 'value', 'title']) {
                if (typeof item[k] === 'string') return item[k];
              }
            }
            return String(item);
          });
        }

        if (values.length > 0) {
          resolved.properties[key] = { ...resolved.properties[key], enum: values };
        } else {
          hasUnresolved = true;
        }
      } catch {
        hasUnresolved = true;
      } finally {
        this._choiceFromLoading.delete(key);
        this._choiceFromLoading = new Set(this._choiceFromLoading);
      }
    }

    this._resolvedParams = resolved;

    // Retry unresolved fields after a delay (tool might not be ready yet)
    if (hasUnresolved && !this._choiceFromRetryTimer) {
      this._choiceFromRetryTimer = window.setTimeout(() => {
        this._choiceFromRetryTimer = null;
        void this._resolveChoiceFromFields();
      }, 10_000);
    }
  }

  get isDirty(): boolean {
    return JSON.stringify(this._values) !== JSON.stringify(this._initialValues);
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
    const effectiveParams = this._resolvedParams || this.params;
    const properties = (effectiveParams as JsonSchemaParams)?.properties || effectiveParams;
    const hasParams =
      properties && typeof properties === 'object' && Object.keys(properties).length > 0;

    // No-param methods render nothing — parent handles execute/cancel chrome
    if (!hasParams) {
      return html`<div class="form-container"></div>`;
    }

    return html`
      <div
        class="form-container"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.shiftKey && !(e.target as HTMLElement)?.matches('textarea')) {
            e.preventDefault();
            this.handleSubmit();
          }
        }}
      >
        ${this._viewMode === 'form' ? this._renderFields() : this._renderJsonEditor()}
      </div>
    `;
  }

  private _renderFields() {
    // Handle standard JSON Schema 'properties'
    const effectiveParams = this._resolvedParams || this.params;
    const properties = (effectiveParams as JsonSchemaParams).properties || effectiveParams;
    const requiredList = (effectiveParams as JsonSchemaParams).required || [];

    // Check if properties is actual object to avoid crash
    if (!properties || typeof properties !== 'object') {
      return html`<p>No parameters required.</p>`;
    }

    return Object.entries(properties).map(([key, schema]: [string, any]) => {
      const isRequired = Array.isArray(requiredList)
        ? requiredList.includes(key)
        : !!schema.required;
      const error = this._errors[key];

      const inputId = `field-${key}`;

      if (this.settingsLayout) {
        const isBoolean = schema.type === 'boolean' || schema.type === '"boolean"';
        return html`
          <div
            style="display: grid; grid-template-columns: 200px 1fr; border-bottom: 1px solid var(--border-glass); min-height: 48px;"
          >
            <div
              style="padding: 12px var(--space-md); display: flex; flex-direction: column; justify-content: center; background: var(--bg-glass);"
            >
              <label
                for=${inputId}
                style="font-size: var(--text-sm); font-weight: 600; color: var(--t-primary); margin: 0;"
              >
                ${formatLabel(key)}
              </label>
              ${schema.description
                ? html`<span
                    style="font-size: var(--text-2xs); color: var(--t-muted); margin-top: 2px; line-height: 1.3;"
                    >${this._cleanDescription(schema.description, schema)}</span
                  >`
                : ''}
            </div>
            <div
              style="padding: ${isBoolean
                ? '8px'
                : '6px'} var(--space-md); display: flex; align-items: center;"
            >
              ${this._renderInput(key, schema, !!error, inputId)}
              ${error
                ? html`<div
                    class="error-text"
                    style="margin-left: 8px;"
                    id="${inputId}-error"
                    role="alert"
                  >
                    ${error}
                  </div>`
                : ''}
            </div>
          </div>
        `;
      }

      return html`
        <div class="form-group">
          <label for=${inputId}>
            ${formatLabel(key)}
            ${isRequired ? html`<span style="color: var(--accent-secondary)">*</span>` : ''}
            ${schema.description
              ? html`<span class="hint"
                  >${this._cleanDescription(schema.description, schema)}</span
                >`
              : ''}
          </label>
          ${this._renderInput(key, schema, !!error, inputId)}
          ${error
            ? html`<div class="error-text" id="${inputId}-error" role="alert">${error}</div>`
            : ''}
        </div>
      `;
    });
  }

  private _renderInput(key: string, schema: MethodParam, hasError = false, inputId?: string) {
    const isBoolean = schema.type === 'boolean' || schema.type === '"boolean"';
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

    // ── Format-based dispatch (checked BEFORE type-based fallbacks) ──
    const _fmt = schema.format;
    const _lk = key.toLowerCase();

    // Rating (star rating) — must be before number type check
    if (_fmt === 'rating' || _lk === 'rating' || _lk === 'stars') {
      const max = schema.maximum || 5;
      const step = schema.multipleOf || 1;
      return html`
        <star-rating
          .value=${Number(this._values[key]) || 0}
          .max=${max}
          .step=${step}
          .hasError=${hasError}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></star-rating>
      `;
    }

    // Segmented / Radio — must be before enum dropdown check
    if ((_fmt === 'segmented' || _fmt === 'radio') && schema.enum) {
      return html`
        <segmented-control
          .options=${schema.enum}
          .value=${this._values[key] || ''}
          .variant=${_fmt === 'radio' ? 'radio' : 'segmented'}
          .hasError=${hasError}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></segmented-control>
      `;
    }

    // Code input — must be before textarea heuristic check
    if (_fmt === 'code' || (_fmt && _fmt.startsWith('code:'))) {
      const lang = _fmt?.includes(':') ? _fmt.split(':')[1] : '';
      return html`
        <code-input
          .value=${this._values[key] || ''}
          .language=${lang}
          .hasError=${hasError}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></code-input>
      `;
    }

    // Markdown input — must be before textarea heuristic check
    if (_fmt === 'markdown') {
      return html`
        <markdown-input
          .value=${this._values[key] || ''}
          .hasError=${hasError}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></markdown-input>
      `;
    }

    // Handle Array with {@format tags} -> Tag/chip input
    if (
      schema.type === 'array' &&
      (schema.format === 'tags' || (schema.items?.type === 'string' && schema.format === 'tags'))
    ) {
      const currentTags = Array.isArray(this._values[key]) ? this._values[key] : [];
      return html`
        <tag-input
          .value=${currentTags}
          .hasError=${hasError}
          @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
        ></tag-input>
      `;
    }

    // Handle Array of Enums -> Multiselect
    if (schema.type === 'array' && schema.items?.enum) {
      const enumValues = schema.items.enum;
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
                ${capitalizeEnumValue(val)}
              </label>
            `
          )}
        </div>
      `;
    }

    // Handle Array of Objects -> Repeatable Mini-Forms (Swagger-style)
    if (schema.type === 'array' && schema.items?.type === 'object') {
      return this._renderArrayOfObjects(key, schema, hasError);
    }

    // Handle plain Array (string/number items) -> Text input with comma-separated hint
    if (schema.type === 'array') {
      const defaultVal = schema.default;
      const placeholder = defaultVal != null ? String(defaultVal) : 'value1, value2, value3';
      return html`
        <div>
          <input
            id=${ifDefined(inputId)}
            type="text"
            class="${errorClass}"
            placeholder="${placeholder}"
            .value=${Array.isArray(this._values[key])
              ? (this._values[key] as string[]).join(', ')
              : this._values[key] || ''}
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              // Split on commas, trim whitespace, filter empty entries
              const arr = raw
                .split(',')
                .map((s: string) => s.trim())
                .filter((s: string) => s.length > 0);
              this._handleChange(key, arr.length > 0 ? arr : raw);
            }}
          />
          <div class="hint">Comma-separated values</div>
        </div>
      `;
    }

    // Handle Date/Time formats (check before object, since date-range produces objects)
    if (this._isDateTimeFormat(key, schema)) {
      return this._renderDateTimeInput(key, schema, hasError, inputId);
    }

    // Handle Object with Properties -> Nested Sub-Fields
    if (
      schema.type === 'object' &&
      schema.properties &&
      Object.keys(schema.properties).length > 0
    ) {
      return this._renderObjectFields(key, schema, hasError);
    }

    // Handle Enums -> Select Dropdown
    if (schema.enum) {
      const currentValue = this._values[key] || '';
      return html`
        <select
          id=${ifDefined(inputId)}
          class="${errorClass}"
          .value=${currentValue}
          @change=${(e: Event) => this._handleChange(key, (e.target as HTMLSelectElement).value)}
        >
          <option value="">Select...</option>
          ${schema.enum.map(
            (val: string) => html`
              <option value=${val} ?selected=${val === currentValue}>
                ${capitalizeEnumValue(val)}
              </option>
            `
          )}
        </select>
      `;
    }

    // Handle Number/Integer — slider only when BOTH minimum AND maximum are explicitly declared
    if (schema.type === 'number' || schema.type === 'integer') {
      const isInteger = schema.type === 'integer';
      const hasMin = schema.minimum !== undefined;
      const hasMax = schema.maximum !== undefined;

      // Only render a slider when both bounds are present; otherwise use a plain number input
      if (hasMin && hasMax) {
        const min: number = schema.minimum;
        const max: number = schema.maximum;

        // Infer integer step when type is 'number' but bounds are both whole numbers
        const boundsAreIntegers = Number.isInteger(min) && Number.isInteger(max);
        const step =
          isInteger || (boundsAreIntegers && !schema.multipleOf) ? 1 : (schema.multipleOf ?? 0.01);
        const defaultVal = schema.default ?? min;
        const currentValue = this._values[key] ?? defaultVal;
        const effectivelyInteger = isInteger || step === 1;
        const displayValue = effectivelyInteger
          ? String(Math.round(Number(currentValue)))
          : String(currentValue);

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
                  this._handleChange(key, v);
                }}
              />
              <input
                id=${ifDefined(inputId)}
                type="number"
                class="slider-number-input ${errorClass}"
                min="${min}"
                max="${max}"
                step="${step}"
                .value=${displayValue}
                @input=${(e: Event) => {
                  const raw = (e.target as HTMLInputElement).value;
                  if (raw === '' || raw === '-') return;
                  this._handleChange(key, Number(raw));
                }}
                @change=${(e: Event) => {
                  const el = e.target as HTMLInputElement;
                  const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                  el.value = String(v);
                  this._handleChange(key, v);
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

      // No explicit maximum — render a plain number input
      const step = isInteger ? 1 : (schema.multipleOf ?? 0.01);
      const defaultVal = schema.default ?? (hasMin ? schema.minimum : 0);
      const currentValue = this._values[key] ?? defaultVal;
      const displayValue = isInteger
        ? String(Math.round(Number(currentValue)))
        : String(currentValue);
      return html`
        <input
          id=${ifDefined(inputId)}
          type="text"
          class="number-input-clean ${errorClass}"
          inputmode=${isInteger ? 'numeric' : 'decimal'}
          ${hasMin ? `min="${schema.minimum}"` : ''}
          placeholder="${defaultVal}"
          .value=${displayValue}
          @keypress=${(e: KeyboardEvent) => {
            const char = e.key;
            const isDigit = /\d/.test(char);
            const isMinus = char === '-';
            const isDecimal = char === '.' && !isInteger;

            // Allow: digits, minus at start, decimal (for floats)
            if (!isDigit && !isMinus && !isDecimal) {
              e.preventDefault();
            }
          }}
          @input=${(e: Event) => {
            let text = (e.target as HTMLInputElement).value;

            if (isInteger) {
              // Remove all non-digit, non-minus characters for integers
              const cleaned = text.replace(/[^\d-]/g, '');
              // Fix multiple minus signs (only allow at start)
              text = cleaned.match(/-.*-/) ? cleaned.replace(/-/g, '').replace(/^/, '-') : cleaned;
            }

            let v = text === '' || text === '-' ? defaultVal : Number(text);
            // If parsing resulted in NaN, use the default value
            if (isNaN(v)) {
              v = defaultVal;
            }
            this._handleChange(key, v);
          }}
        />
      `;
    }

    // Handle File Paths -> File Picker
    // Primary: JSDoc {@format path|file|directory} and {@accept ...} annotations
    // Fallback: heuristic based on param name (path, file, dir)
    const fmt = schema.format;
    const schemaAccept = schema.accept || '';
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
      const defaultVal = schema.default;
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
    const lowerDesc = (schema.description || '').toLowerCase();
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
      schema.format === 'textarea';

    if (isMultiLine) {
      return html`
        <textarea
          id=${ifDefined(inputId)}
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
      const desc = schema.description || '';
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
              id=${ifDefined(inputId)}
              class="${errorClass}"
              .value=${currentValue}
              @change=${(e: Event) =>
                this._handleChange(key, (e.target as HTMLSelectElement).value)}
            >
              <option value="">Select...</option>
              ${candidates.map(
                (val: string) => html`
                  <option value=${val} ?selected=${val === currentValue}>
                    ${capitalizeEnumValue(val)}
                  </option>
                `
              )}
            </select>
          `;
        }
      }
    }

    // ── Enhanced Input Formats (basic HTML types) ──
    const fmt2 = schema.format;
    const lk2 = key.toLowerCase();

    // Password / Secret
    if (
      fmt2 === 'password' ||
      fmt2 === 'secret' ||
      lk2.includes('password') ||
      lk2.includes('secret') ||
      lk2 === 'token' ||
      lk2 === 'apikey'
    ) {
      const showId = `_pw_${key}`;
      return html`
        <div style="position:relative">
          <input
            id=${ifDefined(inputId)}
            type="${this._passwordVisible?.[key] ? 'text' : 'password'}"
            class="${errorClass}"
            autocomplete="off"
            .value=${this._values[key] || ''}
            @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            tabindex="-1"
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--t-muted);cursor:pointer;font-size:14px;padding:4px"
            @click=${() => {
              if (!this._passwordVisible) this._passwordVisible = {};
              this._passwordVisible[key] = !this._passwordVisible[key];
              this.requestUpdate();
            }}
            title="${this._passwordVisible?.[key] ? 'Hide' : 'Show'}"
          >
            ${this._passwordVisible?.[key] ? '🙈' : '👁'}
          </button>
        </div>
      `;
    }

    // Email
    if (fmt2 === 'email' || lk2 === 'email' || lk2.endsWith('email')) {
      return html`
        <input
          id=${ifDefined(inputId)}
          type="email"
          class="${errorClass}"
          placeholder="name@example.com"
          .value=${this._values[key] || ''}
          @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
        />
      `;
    }

    // URL
    if (
      fmt2 === 'url' ||
      lk2 === 'url' ||
      lk2.endsWith('url') ||
      lk2 === 'website' ||
      lk2 === 'homepage'
    ) {
      return html`
        <div style="position:relative">
          <input
            id=${ifDefined(inputId)}
            type="url"
            class="${errorClass}"
            placeholder="https://"
            .value=${this._values[key] || ''}
            @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
          />
          ${this._values[key] && /^https?:\/\/.+/.test(String(this._values[key]))
            ? html`
                <a
                  href=${this._values[key]}
                  target="_blank"
                  rel="noopener"
                  tabindex="-1"
                  style="position:absolute;right:8px;top:50%;transform:translateY(-50%);color:var(--accent-primary);font-size:14px;text-decoration:none"
                  title="Open URL"
                  >↗</a
                >
              `
            : nothing}
        </div>
      `;
    }

    // Phone / Tel
    if (
      fmt2 === 'phone' ||
      fmt2 === 'tel' ||
      lk2 === 'phone' ||
      lk2 === 'tel' ||
      lk2 === 'mobile' ||
      lk2.endsWith('phone')
    ) {
      return html`
        <input
          id=${ifDefined(inputId)}
          type="tel"
          class="${errorClass}"
          placeholder="+1 (555) 000-0000"
          .value=${this._values[key] || ''}
          @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
        />
      `;
    }

    // Color
    if (
      fmt2 === 'color' ||
      lk2 === 'color' ||
      lk2 === 'colour' ||
      lk2.endsWith('color') ||
      lk2.endsWith('colour')
    ) {
      const colorVal = String(this._values[key] || '#6366f1');
      return html`
        <div style="display:flex;gap:8px;align-items:center">
          <input
            type="color"
            .value=${colorVal}
            style="width:40px;height:34px;padding:2px;border-radius:var(--radius-sm);border:1px solid var(--border-glass);cursor:pointer;background:var(--bg-glass)"
            @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
          />
          <input
            id=${ifDefined(inputId)}
            type="text"
            class="${errorClass}"
            placeholder="#6366f1"
            style="flex:1;font-family:var(--font-mono,monospace)"
            .value=${colorVal}
            @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
          />
        </div>
      `;
    }

    // Search
    if (fmt2 === 'search' || lk2 === 'search' || lk2 === 'query' || lk2 === 'q') {
      return html`
        <div style="position:relative">
          <input
            id=${ifDefined(inputId)}
            type="search"
            class="${errorClass}"
            placeholder="Search..."
            .value=${this._values[key] || ''}
            @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
          />
        </div>
      `;
    }

    // Default -> Text Input
    const defaultVal = schema.default;
    const placeholder = defaultVal != null ? String(defaultVal) : '';
    const format = schema.format;
    const pattern = schema.pattern; // Regex pattern from {@pattern} tag

    return html`
      <input
        id=${ifDefined(inputId)}
        type="text"
        class="${errorClass}"
        placeholder="${placeholder}"
        .value=${this._values[key] || ''}
        @keypress=${(e: KeyboardEvent) => {
          // Apply format-based character restrictions
          if (!isValidCharForFormat(e.key, format)) {
            e.preventDefault();
            return;
          }

          // Apply custom regex pattern if specified
          if (pattern) {
            try {
              const currentValue = (e.target as HTMLInputElement).value;
              const newValue = currentValue + e.key;
              const regex = new RegExp(pattern);
              if (!regex.test(newValue)) {
                e.preventDefault();
              }
            } catch (err) {
              // Invalid regex, skip validation
            }
          }
        }}
        @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  /** Detect if a schema/key should render as a date/time input */
  private _isDateTimeFormat(key: string, schema: MethodParam): boolean {
    const fmt = schema.format;
    if (fmt && ['date', 'date-time', 'time', 'date-range', 'datetime-range'].includes(fmt)) {
      return true;
    }
    // Key name heuristics (only for string type or untyped)
    if (schema.type && schema.type !== 'string') return false;
    const lk = key.toLowerCase();
    const dateKeys = [
      'date',
      'deadline',
      'duedate',
      'createdat',
      'updatedat',
      'startat',
      'endat',
      'startdate',
      'enddate',
      'birthday',
      'birthdate',
      'expiry',
      'expirydate',
      'expiresat',
    ];
    const timeKeys = ['time', 'starttime', 'endtime', 'createtime', 'updatetime'];
    if (dateKeys.includes(lk)) return true;
    if (timeKeys.includes(lk)) return true;
    return false;
  }

  /** Determine the effective date/time format from schema and key heuristics */
  private _getDateTimeFormat(key: string, schema: MethodParam): string {
    const fmt = schema.format;
    if (fmt && ['date', 'date-time', 'time', 'date-range', 'datetime-range'].includes(fmt)) {
      return fmt;
    }
    const lk = key.toLowerCase();
    const timeKeys = ['time', 'starttime', 'endtime', 'createtime', 'updatetime'];
    if (timeKeys.includes(lk)) return 'time';
    return 'date'; // default heuristic
  }

  /** Render date/time input based on format */
  private _renderDateTimeInput(
    key: string,
    schema: MethodParam,
    hasError: boolean,
    _inputId?: string
  ) {
    const fmt = this._getDateTimeFormat(key, schema);

    if (fmt === 'date-range') {
      const currentObj = (this._values[key] as { start?: string; end?: string }) || {};
      return html`
        <div class="date-range-row">
          <date-picker
            .value=${currentObj.start || ''}
            .hasError=${hasError}
            mode="date"
            placeholder="Start date"
            @change=${(e: CustomEvent) => {
              this._handleChange(key, { ...currentObj, start: e.detail.value });
            }}
          ></date-picker>
          <span class="date-range-arrow">→</span>
          <date-picker
            .value=${currentObj.end || ''}
            .hasError=${hasError}
            mode="date"
            placeholder="End date"
            .min=${currentObj.start || ''}
            @change=${(e: CustomEvent) => {
              this._handleChange(key, { ...currentObj, end: e.detail.value });
            }}
          ></date-picker>
        </div>
      `;
    }

    if (fmt === 'datetime-range') {
      const currentObj = (this._values[key] as { start?: string; end?: string }) || {};
      return html`
        <div class="date-range-row">
          <date-picker
            .value=${currentObj.start || ''}
            .hasError=${hasError}
            mode="date-time"
            placeholder="Start"
            @change=${(e: CustomEvent) => {
              this._handleChange(key, { ...currentObj, start: e.detail.value });
            }}
          ></date-picker>
          <span class="date-range-arrow">→</span>
          <date-picker
            .value=${currentObj.end || ''}
            .hasError=${hasError}
            mode="date-time"
            placeholder="End"
            .min=${currentObj.start || ''}
            @change=${(e: CustomEvent) => {
              this._handleChange(key, { ...currentObj, end: e.detail.value });
            }}
          ></date-picker>
        </div>
      `;
    }

    // Single date, date-time, or time
    const mode = fmt === 'date-time' ? 'date-time' : fmt === 'time' ? 'time' : 'date';
    return html`
      <date-picker
        .value=${this._values[key] || ''}
        .hasError=${hasError}
        .paramKey=${key}
        mode=${mode}
        @change=${(e: CustomEvent) => this._handleChange(key, e.detail.value)}
      ></date-picker>
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
  private _cleanDescription(desc: string, schema: MethodParam): string {
    if (!desc) return desc;

    // Remove JSDoc tags that might leak from documentation (@emits, @internal, @deprecated, etc.)
    let cleaned = desc;
    // Remove lines starting with @ tags
    const lines = cleaned.split('\n').filter((line) => !line.trim().startsWith('@'));
    cleaned = lines.join('\n').trim();
    // Remove inline @ tags
    cleaned = cleaned.replace(/\s*@\w+[\s\S]*?(?=[.!?\n]|$)/g, '').trim();

    // Remove quoted-value union patterns with optional parenthetical descriptions:
    // 'a' | 'b' | 'c'  OR  'a' (desc) | 'b' (desc) | 'c' (desc)
    cleaned = cleaned.replace(
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

  private _sliderFillStyle(value: number, min: number, max: number): string {
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    return `background: linear-gradient(to right, var(--accent-primary) ${pct}%, var(--border-glass) ${pct}%)`;
  }

  /** Clamp to [min, max] and round to nearest step (integer-safe). */
  private _sanitizeSliderValue(raw: number, min: number, max: number, step: number): number {
    let v = Number.isFinite(raw) ? raw : min;
    v = Math.min(max, Math.max(min, v));
    // Snap to step grid anchored at min
    if (step > 0) {
      v = min + Math.round((v - min) / step) * step;
      // Guard against floating-point drift pushing past max
      if (v > max) v = max;
    }
    // For integer steps, ensure no fractional residue
    if (Number.isInteger(step) && step >= 1) {
      v = Math.round(v);
    }
    return v;
  }

  private _handleChange(key: string, value: any) {
    this._values = { ...this._values, [key]: value };
    if (this.rememberValues) {
      this._savePersistedValues();
    }
  }

  private _buildCliCommand(): string {
    const parts = [this.photonName, this.methodName];
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
              void navigator.clipboard.writeText(cmd);
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
    const properties = (this.params as JsonSchemaParams)?.properties || this.params;
    if (!properties || typeof properties !== 'object') return false;

    return Object.values(properties).some((schema: MethodParam) => {
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
  private _renderObjectFields(key: string, schema: MethodParam, _hasError: boolean) {
    const properties = schema.properties || {};
    const requiredList = schema.required || [];
    const currentObj = (this._values[key] as Record<string, any>) || {};

    const handleFieldChange = (propKey: string, newValue: string | number | boolean) => {
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
    schema: MethodParam,
    value: string | number | boolean | null | undefined,
    onChange: (key: string, val: string | number | boolean) => void
  ) {
    if (schema.enum) {
      return html`
        <select
          .value=${value || ''}
          @change=${(e: Event) => onChange(propKey, (e.target as HTMLSelectElement).value)}
        >
          <option value="">Select...</option>
          ${schema.enum.map(
            (opt: string) => html`
              <option value=${opt} ?selected=${opt === value}>${capitalizeEnumValue(opt)}</option>
            `
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
      const isInteger = schema.type === 'integer';
      const hasMin = schema.minimum !== undefined;
      const hasMax = schema.maximum !== undefined;

      if (hasMin && hasMax) {
        const min = schema.minimum as number;
        const max = schema.maximum as number;
        const boundsAreIntegers = Number.isInteger(min) && Number.isInteger(max);
        const step =
          isInteger || (boundsAreIntegers && !schema.multipleOf) ? 1 : (schema.multipleOf ?? 0.01);
        const currentVal = value ?? schema.default ?? min;
        const displayVal = isInteger ? String(Math.round(Number(currentVal))) : String(currentVal);

        return html`
          <div class="slider-group">
            <div class="slider-row">
              <input
                type="range"
                min="${min}"
                max="${max}"
                step="${step}"
                style="${this._sliderFillStyle(Number(currentVal), min, max)}"
                .value=${String(currentVal)}
                @input=${(e: Event) => {
                  const el = e.target as HTMLInputElement;
                  const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                  el.style.cssText = this._sliderFillStyle(v, min, max);
                  onChange(propKey, v);
                }}
              />
              <input
                type="number"
                class="slider-number-input"
                min="${min}"
                max="${max}"
                step="${step}"
                .value=${displayVal}
                @input=${(e: Event) => {
                  const raw = (e.target as HTMLInputElement).value;
                  if (raw === '' || raw === '-') return;
                  onChange(propKey, Number(raw));
                }}
                @change=${(e: Event) => {
                  const el = e.target as HTMLInputElement;
                  const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                  el.value = String(v);
                  onChange(propKey, v);
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

      // No explicit maximum — plain number input
      const step = isInteger ? 1 : (schema.multipleOf ?? 0.01);
      const defaultVal = schema.default ?? (hasMin ? schema.minimum : 0);
      const currentVal = value ?? defaultVal;
      const displayVal = isInteger ? String(Math.round(Number(currentVal))) : String(currentVal);
      return html`
        <input
          type="number"
          class="slider-number-input"
          ${hasMin ? `min="${schema.minimum}"` : ''}
          step="${step}"
          placeholder="${defaultVal}"
          .value=${displayVal}
          @input=${(e: Event) => onChange(propKey, Number((e.target as HTMLInputElement).value))}
        />
      `;
    }
    // Date/time formats
    if (this._isDateTimeFormat(propKey, schema)) {
      const fmt = this._getDateTimeFormat(propKey, schema);
      if (fmt === 'date-range' || fmt === 'datetime-range') {
        const mode = fmt === 'datetime-range' ? 'date-time' : 'date';
        const currentObj = (value as { start?: string; end?: string }) || {};
        return html`
          <div class="date-range-row">
            <date-picker
              .value=${currentObj.start || ''}
              mode=${mode}
              placeholder="Start"
              @change=${(e: CustomEvent) =>
                onChange(propKey, { ...currentObj, start: e.detail.value })}
            ></date-picker>
            <span class="date-range-arrow">→</span>
            <date-picker
              .value=${currentObj.end || ''}
              mode=${mode}
              placeholder="End"
              .min=${currentObj.start || ''}
              @change=${(e: CustomEvent) =>
                onChange(propKey, { ...currentObj, end: e.detail.value })}
            ></date-picker>
          </div>
        `;
      }
      const mode = fmt === 'date-time' ? 'date-time' : fmt === 'time' ? 'time' : 'date';
      return html`
        <date-picker
          .value=${value || ''}
          mode=${mode}
          @change=${(e: CustomEvent) => onChange(propKey, e.detail.value)}
        ></date-picker>
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
  private _renderArrayOfObjects(key: string, schema: MethodParam, hasError: boolean) {
    const items = (this._values[key] as Record<string, unknown>[]) || [];
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
    schema: MethodParam,
    value: string | number | boolean | null | undefined
  ) {
    const handleNestedChange = (newValue: string | number | boolean) => {
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
            (opt: string) => html`
              <option value=${opt} ?selected=${opt === value}>${capitalizeEnumValue(opt)}</option>
            `
          )}
        </select>
      `;
    }

    // Handle boolean
    if (schema.type === 'boolean') {
      return html`
        <label class="switch">
          <input
            type="checkbox"
            .checked=${!!value}
            @change=${(e: Event) => handleNestedChange((e.target as HTMLInputElement).checked)}
          />
          <span class="slider"></span>
        </label>
      `;
    }

    // Handle number — slider only when both minimum AND maximum are declared
    if (schema.type === 'number' || schema.type === 'integer') {
      const isInteger = schema.type === 'integer';
      const hasMin = schema.minimum !== undefined;
      const hasMax = schema.maximum !== undefined;

      if (hasMin && hasMax) {
        const min = schema.minimum as number;
        const max = schema.maximum as number;
        const boundsAreIntegers = Number.isInteger(min) && Number.isInteger(max);
        const step =
          isInteger || (boundsAreIntegers && !schema.multipleOf) ? 1 : (schema.multipleOf ?? 0.01);
        const currentVal = value ?? schema.default ?? min;
        const displayVal = isInteger ? String(Math.round(Number(currentVal))) : String(currentVal);

        return html`
          <div class="slider-group">
            <div class="slider-row">
              <input
                type="range"
                min="${min}"
                max="${max}"
                step="${step}"
                style="${this._sliderFillStyle(Number(currentVal), min, max)}"
                .value=${String(currentVal)}
                @input=${(e: Event) => {
                  const el = e.target as HTMLInputElement;
                  const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                  el.style.cssText = this._sliderFillStyle(v, min, max);
                  handleNestedChange(v);
                }}
              />
              <input
                type="number"
                class="slider-number-input"
                min="${min}"
                max="${max}"
                step="${step}"
                .value=${displayVal}
                @input=${(e: Event) => {
                  const raw = (e.target as HTMLInputElement).value;
                  if (raw === '' || raw === '-') return;
                  handleNestedChange(Number(raw));
                }}
                @change=${(e: Event) => {
                  const el = e.target as HTMLInputElement;
                  const v = this._sanitizeSliderValue(Number(el.value), min, max, step);
                  el.value = String(v);
                  handleNestedChange(v);
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

      // No explicit maximum — plain number input
      const step = isInteger ? 1 : (schema.multipleOf ?? 0.01);
      const defaultVal = schema.default ?? (hasMin ? schema.minimum : 0);
      const currentVal = value ?? defaultVal;
      const displayVal = isInteger ? String(Math.round(Number(currentVal))) : String(currentVal);
      return html`
        <input
          type="number"
          class="slider-number-input"
          ${hasMin ? `min="${schema.minimum}"` : ''}
          step="${step}"
          placeholder="${defaultVal}"
          .value=${displayVal}
          @input=${(e: Event) => handleNestedChange(Number((e.target as HTMLInputElement).value))}
        />
      `;
    }

    // Handle date/time
    if (this._isDateTimeFormat(propKey, schema)) {
      const fmt = this._getDateTimeFormat(propKey, schema);
      if (fmt === 'date-range' || fmt === 'datetime-range') {
        const mode = fmt === 'datetime-range' ? 'date-time' : 'date';
        const currentObj = (value as { start?: string; end?: string }) || {};
        return html`
          <div class="date-range-row">
            <date-picker
              .value=${currentObj.start || ''}
              mode=${mode}
              placeholder="Start"
              @change=${(e: CustomEvent) =>
                handleNestedChange({ ...currentObj, start: e.detail.value })}
            ></date-picker>
            <span class="date-range-arrow">→</span>
            <date-picker
              .value=${currentObj.end || ''}
              mode=${mode}
              placeholder="End"
              .min=${currentObj.start || ''}
              @change=${(e: CustomEvent) =>
                handleNestedChange({ ...currentObj, end: e.detail.value })}
            ></date-picker>
          </div>
        `;
      }
      const mode = fmt === 'date-time' ? 'date-time' : fmt === 'time' ? 'time' : 'date';
      return html`
        <date-picker
          .value=${value || ''}
          mode=${mode}
          @change=${(e: CustomEvent) => handleNestedChange(e.detail.value)}
        ></date-picker>
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
    for (const [propKey, propSchema] of Object.entries(itemProperties)) {
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

  /** Validate and submit the form. Called by parent chrome wrapper. */
  handleSubmit() {
    const properties = (this.params as JsonSchemaParams).properties || this.params;
    const requiredList = (this.params as JsonSchemaParams).required || [];
    const errors: Record<string, string> = {};

    if (properties && typeof properties === 'object') {
      for (const [key, schema] of Object.entries(properties)) {
        const s = schema as MethodParam;
        const value = this._values[key];
        const isRequired = Array.isArray(requiredList) ? requiredList.includes(key) : !!s.required;

        // Required check (boolean false is a valid value, not "empty")
        if (
          isRequired &&
          (value === undefined || value === null || value === '') &&
          value !== false
        ) {
          errors[key] = 'This field is required';
          continue;
        }

        // Skip further validation if empty and optional
        if (value === undefined || value === null || value === '') continue;

        // String constraints
        if (typeof value === 'string') {
          if (s.minLength != null && value.length < s.minLength) {
            errors[key] = `Must be at least ${s.minLength} characters`;
          } else if (s.maxLength != null && value.length > s.maxLength) {
            errors[key] = `Must be at most ${s.maxLength} characters`;
          } else if (s.pattern) {
            try {
              if (!new RegExp(s.pattern).test(value)) {
                errors[key] = s.patternDescription || `Must match pattern: ${s.pattern}`;
              }
            } catch {
              // Invalid regex in schema — skip
            }
          }
        }

        // Number constraints
        if (typeof value === 'number') {
          if (s.minimum != null && value < s.minimum) {
            errors[key] = `Must be at least ${s.minimum}`;
          } else if (s.maximum != null && value > s.maximum) {
            errors[key] = `Must be at most ${s.maximum}`;
          } else if (s.exclusiveMinimum != null && value <= s.exclusiveMinimum) {
            errors[key] = `Must be greater than ${s.exclusiveMinimum}`;
          } else if (s.exclusiveMaximum != null && value >= s.exclusiveMaximum) {
            errors[key] = `Must be less than ${s.exclusiveMaximum}`;
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      this._errors = errors;
      showToast('Please fix the validation errors', 'warning');
      // Scroll to first error field
      void this.updateComplete.then(() => {
        const firstError = this.shadowRoot?.querySelector('.error-text');
        firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }

    this._errors = {};
    this.dispatchEvent(new CustomEvent('submit', { detail: { args: this._values } }));
  }

  /** Cancel with dirty check. Called by parent chrome wrapper. */
  async handleCancel() {
    if (
      this.isDirty &&
      !(await confirmElicit('You have unsaved changes. Discard them?', {
        confirm: 'Discard',
        destructive: true,
      }))
    ) {
      return;
    }
    this.dispatchEvent(new CustomEvent('cancel'));
  }
}
