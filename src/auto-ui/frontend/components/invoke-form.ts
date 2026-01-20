import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

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

      input, textarea, select {
        width: 100%;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        box-sizing: border-box;
      }

      input:focus, textarea:focus {
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
    `
    ];

    @property({ type: Object })
    params: Record<string, MethodParam> = {};

    @state()
    private _values: Record<string, any> = {};

    render() {
        return html`
      <div class="form-container">
        ${Object.entries(this.params).map(([key, schema]) => html`
          <div class="form-group">
            <label>
              ${key}
              ${schema.required ? html`<span style="color: var(--accent-secondary)">*</span>` : ''}
              ${schema.description ? html`<span class="hint">${schema.description}</span>` : ''}
            </label>
            ${this._renderInput(key, schema)}
          </div>
        `)}

        <div class="actions">
          <button class="btn-secondary" @click=${this._handleCancel}>Cancel</button>
          <button class="btn-primary" @click=${this._handleSubmit}>Execute</button>
        </div>
      </div>
    `;
    }

    private _renderInput(key: string, schema: MethodParam) {
        // Basic type mapping for now
        if (schema.type === 'boolean') {
            return html`
        <select @change=${(e: Event) => this._handleChange(key, (e.target as HTMLSelectElement).value === 'true')}>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      `;
        }

        return html`
      <input 
        type=${schema.type === 'number' ? 'number' : 'text'}
        @input=${(e: Event) => this._handleChange(key, (e.target as HTMLInputElement).value)}
      >
    `;
    }

    private _handleChange(key: string, value: any) {
        this._values = { ...this._values, [key]: value };
    }

    private _handleSubmit() {
        this.dispatchEvent(new CustomEvent('submit', { detail: { args: this._values } }));
    }

    private _handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }
}
