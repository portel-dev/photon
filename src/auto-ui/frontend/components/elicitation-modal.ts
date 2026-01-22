import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

export interface ElicitationData {
    ask: 'text' | 'password' | 'select' | 'confirm' | 'number' | 'oauth' | 'form';
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
}

@customElement('elicitation-modal')
export class ElicitationModal extends LitElement {
    static styles = [
        theme,
        css`
            :host {
                display: none;
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
            }

            h3 {
                margin: 0 0 var(--space-lg) 0;
                font-size: 1.25rem;
                font-weight: 600;
                color: var(--t-primary);
            }

            .form-group {
                margin-bottom: var(--space-md);
            }

            label {
                display: block;
                margin-bottom: var(--space-xs);
                font-size: 0.875rem;
                color: var(--t-muted);
            }

            input[type="text"],
            input[type="password"],
            input[type="number"],
            textarea,
            select {
                width: 100%;
                padding: var(--space-sm) var(--space-md);
                background: var(--bg-glass);
                border: 1px solid var(--border-glass);
                border-radius: var(--radius-sm);
                color: var(--t-primary);
                font-size: 1rem;
                font-family: var(--font-sans);
                box-sizing: border-box;
            }

            input:focus,
            textarea:focus,
            select:focus {
                outline: none;
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 2px var(--glow-primary);
            }

            .actions {
                display: flex;
                gap: var(--space-sm);
                justify-content: flex-end;
                margin-top: var(--space-lg);
            }

            button {
                padding: var(--space-sm) var(--space-lg);
                border-radius: var(--radius-sm);
                font-size: 0.9rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                border: none;
            }

            .btn-primary {
                background: var(--accent-primary);
                color: white;
            }

            .btn-primary:hover {
                opacity: 0.9;
            }

            .btn-secondary {
                background: var(--bg-glass);
                border: 1px solid var(--border-glass);
                color: var(--t-primary);
            }

            .btn-secondary:hover {
                background: var(--bg-glass-strong);
            }

            .btn-success {
                background: #22c55e;
                color: white;
            }

            .btn-danger {
                background: #ef4444;
                color: white;
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

            .select-option input[type="radio"],
            .select-option input[type="checkbox"] {
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
                font-size: 0.85rem;
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

            /* OAuth */
            .oauth-content {
                text-align: center;
            }

            .oauth-icon {
                font-size: 3rem;
                margin-bottom: var(--space-md);
            }

            .oauth-message {
                color: var(--t-muted);
                margin-bottom: var(--space-lg);
            }

            .oauth-scopes {
                font-size: 0.85rem;
                color: var(--t-muted);
                margin-bottom: var(--space-lg);
            }

            /* Form fields */
            .form-fields {
                display: flex;
                flex-direction: column;
                gap: var(--space-md);
            }
        `
    ];

    @property({ type: Boolean, reflect: true }) open = false;
    @property({ type: Object }) data: ElicitationData | null = null;

    @state() private _inputValue: any = '';
    @state() private _selectedValues: string[] = [];
    @state() private _formValues: Record<string, any> = {};

    private _oauthPopup: Window | null = null;

    updated(changedProperties: Map<string, any>) {
        if (changedProperties.has('data') && this.data) {
            this._resetState();
        }
    }

    private _resetState() {
        if (!this.data) return;

        this._inputValue = this.data.default ?? '';
        this._selectedValues = [];
        this._formValues = {};

        // Pre-select options if specified
        if (this.data.options) {
            this._selectedValues = this.data.options
                .filter(opt => opt.selected)
                .map(opt => opt.value);
        }

        // Initialize form values
        if (this.data.fields) {
            this.data.fields.forEach(field => {
                this._formValues[field.name] = field.default ?? '';
            });
        }
    }

    render() {
        if (!this.data) return nothing;

        return html`
            <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
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
                    @input=${(e: Event) => this._inputValue = (e.target as HTMLInputElement).value}
                    @keydown=${this._handleKeydown}
                    autofocus
                />
            </div>
            <div class="actions">
                <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                <button class="btn-primary" @click=${this._submit}>Submit</button>
            </div>
        `;
    }

    private _renderNumberInput() {
        return html`
            <div class="form-group">
                <input
                    type="number"
                    .value=${String(this._inputValue)}
                    min=${this.data?.min ?? nothing}
                    max=${this.data?.max ?? nothing}
                    step=${this.data?.step ?? nothing}
                    @input=${(e: Event) => this._inputValue = Number((e.target as HTMLInputElement).value)}
                    @keydown=${this._handleKeydown}
                    autofocus
                />
            </div>
            <div class="actions">
                <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                <button class="btn-primary" @click=${this._submit}>Submit</button>
            </div>
        `;
    }

    private _renderSelect() {
        const options = this.data?.options || [];
        const isMulti = this.data?.multi === true;

        if (options.length <= 5 && !options.some(o => o.image || o.description)) {
            // Simple dropdown for small option sets
            return html`
                <div class="form-group">
                    <select @change=${(e: Event) => this._inputValue = (e.target as HTMLSelectElement).value}>
                        ${options.map(opt => html`
                            <option value=${opt.value} ?selected=${opt.selected}>${opt.label}</option>
                        `)}
                    </select>
                </div>
                <div class="actions">
                    <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                    <button class="btn-primary" @click=${this._submit}>Submit</button>
                </div>
            `;
        }

        // Rich select with cards
        return html`
            <div class="select-options">
                ${options.map(opt => html`
                    <label class="select-option ${opt.disabled ? 'disabled' : ''} ${this._isSelected(opt.value) ? 'selected' : ''}">
                        <input
                            type=${isMulti ? 'checkbox' : 'radio'}
                            name="select-option"
                            .value=${opt.value}
                            .checked=${this._isSelected(opt.value)}
                            ?disabled=${opt.disabled}
                            @change=${() => this._toggleOption(opt.value, isMulti)}
                        />
                        ${opt.image ? html`<img class="option-image" src=${opt.image} alt=${opt.label} />` : nothing}
                        <div class="option-content">
                            <div class="option-label">${opt.label}</div>
                            ${opt.description ? html`<div class="option-description">${opt.description}</div>` : nothing}
                        </div>
                    </label>
                `)}
            </div>
            <div class="actions">
                <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                <button class="btn-primary" @click=${this._submitSelect}>Submit</button>
            </div>
        `;
    }

    private _isSelected(value: string): boolean {
        return this._selectedValues.includes(value);
    }

    private _toggleOption(value: string, isMulti: boolean) {
        if (isMulti) {
            if (this._selectedValues.includes(value)) {
                this._selectedValues = this._selectedValues.filter(v => v !== value);
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
            default: '🔐'
        };
        const provider = this.data?.provider || 'OAuth';
        const icon = providerIcons[provider.toLowerCase()] || providerIcons.default;
        const scopes = (this.data?.scopes || []).join(', ') || 'basic access';

        return html`
            <div class="oauth-content">
                <div class="oauth-icon">${icon}</div>
                <p class="oauth-message">
                    Authorization is required to access ${provider}.
                </p>
                <p class="oauth-scopes">
                    Requested permissions: ${scopes}
                </p>
                <div class="actions" style="justify-content: center;">
                    <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                    <button class="btn-primary" @click=${this._startOAuth}>Authorize ${provider}</button>
                </div>
            </div>
        `;
    }

    private _renderForm() {
        const fields = this.data?.fields || [];

        return html`
            <div class="form-fields">
                ${fields.map(field => html`
                    <div class="form-group">
                        <label>${field.label || field.name}${field.required ? ' *' : ''}</label>
                        ${this._renderFormField(field)}
                    </div>
                `)}
            </div>
            <div class="actions">
                <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                <button class="btn-primary" @click=${this._submitForm}>Submit</button>
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
                    @input=${(e: Event) => this._updateFormValue(field.name, (e.target as HTMLTextAreaElement).value)}
                ></textarea>
            `;
        }

        return html`
            <input
                type=${type}
                .value=${value}
                placeholder=${field.placeholder || ''}
                ?required=${field.required}
                @input=${(e: Event) => this._updateFormValue(field.name, (e.target as HTMLInputElement).value)}
            />
        `;
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
        this.dispatchEvent(new CustomEvent('submit', {
            detail: { value },
            bubbles: true,
            composed: true
        }));
        this.open = false;
    }

    private _cancel() {
        this.dispatchEvent(new CustomEvent('cancel', {
            bubbles: true,
            composed: true
        }));
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

        // Listen for OAuth completion
        const checkClosed = setInterval(() => {
            if (this._oauthPopup?.closed) {
                clearInterval(checkClosed);
                // Assume success when popup closes
                this.dispatchEvent(new CustomEvent('oauth-complete', {
                    detail: {
                        elicitationId: this.data?.elicitationId,
                        success: true
                    },
                    bubbles: true,
                    composed: true
                }));
                this.open = false;
            }
        }, 500);
    }
}
