import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

interface ConfigParam {
  name: string;
  envVar: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
}

interface UnconfiguredPhoton {
  name: string;
  configured: false;
  requiredParams: ConfigParam[];
  errorMessage?: string;
}

@customElement('photon-config')
export class PhotonConfig extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
      }

      .config-header {
        margin-bottom: var(--space-lg);
      }

      .config-title {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0 0 var(--space-sm) 0;
      }

      .config-description {
        color: var(--t-muted);
        font-size: 0.9rem;
      }

      .config-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }

      .form-group label {
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .form-group label .required {
        color: #f87171;
      }

      .form-group label .hint {
        font-size: 0.75rem;
        color: var(--t-muted);
        font-family: var(--font-mono);
        background: var(--bg-glass);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .form-group input {
        width: 100%;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        font-size: 0.95rem;
        box-sizing: border-box;
      }

      .form-group input:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .form-group input::placeholder {
        color: var(--t-muted);
        opacity: 0.6;
      }

      /* Mask secret fields without type="password" to avoid browser credential autofill */
      .form-group input.secret-field {
        -webkit-text-security: disc;
      }

      .toggle-switch {
        display: flex;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        overflow: hidden;
        width: fit-content;
      }

      .toggle-btn {
        padding: var(--space-sm) var(--space-md);
        background: transparent;
        border: none;
        color: var(--t-muted);
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
      }

      .toggle-btn.active {
        background: var(--accent-primary);
        color: white;
      }

      .toggle-btn:hover:not(.active) {
        background: var(--bg-glass-strong);
      }

      .submit-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-sm);
        padding: var(--space-md);
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        border: none;
        color: white;
        font-weight: 600;
        font-size: 1rem;
        border-radius: var(--radius-sm);
        cursor: pointer;
        margin-top: var(--space-md);
        transition: all 0.2s;
      }

      .submit-btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }

      .submit-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .submit-btn svg {
        width: 18px;
        height: 18px;
      }

      .error-banner {
        background: hsla(0, 70%, 50%, 0.15);
        border: 1px solid hsla(0, 70%, 50%, 0.3);
        color: #f87171;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        font-size: 0.85rem;
        margin-bottom: var(--space-md);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .form-group input {
          min-height: 44px;
          font-size: 16px; /* Prevent iOS zoom */
        }

        .submit-btn {
          min-height: 44px;
          width: 100%;
        }

        .toggle-switch {
          width: 100%;
        }

        .toggle-btn {
          flex: 1;
          min-height: 44px;
        }
      }

      @media (max-width: 480px) {
        .config-title {
          font-size: 1.25rem;
        }

        .form-group label {
          flex-direction: column;
          align-items: flex-start;
          gap: var(--space-xs);
        }

        .form-group label .hint {
          font-size: 0.7rem;
        }
      }
    `,
  ];

  @property({ type: Object })
  photon: UnconfiguredPhoton | null = null;

  @property({ type: String })
  mode: 'initial' | 'edit' = 'initial';

  @state()
  private _loading = false;

  @state()
  private _formData: Record<string, string> = {};

  render() {
    if (!this.photon) return html``;

    const params = this.photon.requiredParams || [];

    return html`
      <div class="config-header">
        <h2 class="config-title text-gradient">${this.photon.name}</h2>
        <p class="config-description">
          ${this.mode === 'edit'
            ? 'Edit configuration values. Only changed fields will be updated.'
            : this.photon.errorMessage || 'Configure this photon to enable its features'}
        </p>
      </div>

      ${this.mode === 'initial' && this.photon.errorMessage
        ? html` <div class="error-banner">${this.photon.errorMessage}</div> `
        : ''}

      <div class="config-form" role="presentation">
        ${params.map((param) => this._renderField(param))}

        <button type="button" class="submit-btn" ?disabled=${this._loading} @click=${this._handleSubmit}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
            />
          </svg>
          ${this._loading
            ? 'Saving...'
            : this.mode === 'edit'
              ? 'Save Changes'
              : 'Configure & Enable'}
        </button>
      </div>
    `;
  }

  private _renderField(param: ConfigParam) {
    const isRequired = !param.isOptional && !param.hasDefault;
    const isSecret = this._isSecretField(param.name);
    const isBoolean = param.type === 'boolean';
    const isNumber = param.type === 'number';
    const defaultValue = param.hasDefault ? String(param.defaultValue ?? '') : '';

    return html`
      <div class="form-group">
        <label>
          ${param.name}${isRequired ? html`<span class="required">*</span>` : ''}
          <span class="hint">${param.envVar}</span>
        </label>

        ${isBoolean
          ? this._renderToggle(param, defaultValue)
          : isNumber
            ? this._renderNumberInput(param, defaultValue, isRequired)
            : this._renderTextInput(param, defaultValue, isRequired, isSecret)}
      </div>
    `;
  }

  private _renderToggle(param: ConfigParam, defaultValue: string) {
    const isOn = defaultValue === 'true';
    return html`
      <div class="toggle-switch">
        <button
          type="button"
          class="toggle-btn ${!isOn ? 'active' : ''}"
          @click=${() => this._setToggle(param.envVar, false)}
        >
          Off
        </button>
        <button
          type="button"
          class="toggle-btn ${isOn ? 'active' : ''}"
          @click=${() => this._setToggle(param.envVar, true)}
        >
          On
        </button>
      </div>
    `;
  }

  private _renderNumberInput(param: ConfigParam, defaultValue: string, isRequired: boolean) {
    return html`
      <input
        type="number"
        id="photon-${param.envVar}"
        name="${param.envVar}"
        .value=${this._formData[param.envVar] ?? defaultValue}
        placeholder="Enter ${param.name}..."
        @input=${(e: Event) =>
          this._updateField(param.envVar, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  private _renderTextInput(
    param: ConfigParam,
    defaultValue: string,
    isRequired: boolean,
    isSecret: boolean
  ) {
    return html`
      <input
        type="text"
        id="photon-${param.envVar}"
        name="${param.envVar}"
        class="${isSecret ? 'secret-field' : ''}"
        .value=${this._formData[param.envVar] ?? defaultValue}
        placeholder="Enter ${param.name}..."
        @input=${(e: Event) =>
          this._updateField(param.envVar, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  private _isSecretField(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('key') ||
      lower.includes('token')
    );
  }

  private _setToggle(envVar: string, value: boolean) {
    this._formData = { ...this._formData, [envVar]: String(value) };
  }

  private _updateField(envVar: string, value: string) {
    this._formData = { ...this._formData, [envVar]: value };
  }

  private _handleSubmit() {
    if (!this.photon) return;

    // Collect form data
    const config: Record<string, string> = {};
    const params = this.photon.requiredParams || [];

    for (const param of params) {
      const value = this._formData[param.envVar];
      if (value) {
        config[param.envVar] = value;
      } else if (param.hasDefault) {
        config[param.envVar] = String(param.defaultValue ?? '');
      }
    }

    this._loading = true;
    showToast(`Configuring ${this.photon.name}...`, 'info');

    this.dispatchEvent(
      new CustomEvent('configure', {
        detail: {
          photon: this.photon.name,
          config,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Called from parent when configuration completes
  configurationComplete(success: boolean, message?: string) {
    this._loading = false;
    if (success) {
      showToast(`${this.photon?.name} configured successfully!`, 'success');
    } else {
      showToast(message || 'Configuration failed', 'error');
    }
  }
}
