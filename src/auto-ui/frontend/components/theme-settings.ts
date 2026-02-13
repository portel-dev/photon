import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, type Theme } from '../styles/index.js';
import {
  generateBeamThemeColors,
  beamThemeToCSS,
  themePresets,
  type ThemeConfig,
} from '../../design-system/tokens.js';

const THEME_CONFIG_KEY = 'beam-theme-config';

export interface ThemeConfigState {
  hue: number;
  chroma: number;
  lightness: number;
  presetName?: string;
}

@customElement('theme-settings')
export class ThemeSettings extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        padding: var(--space-md);
        color: var(--t-primary);
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-lg);
      }

      h3 {
        margin: 0;
        font-size: var(--text-lg);
        font-weight: 600;
      }

      .close-btn {
        background: none;
        border: none;
        color: var(--t-muted);
        cursor: pointer;
        font-size: var(--text-xl);
        padding: var(--space-xs);
        border-radius: var(--radius-sm);
        transition: all 0.2s;
      }

      .close-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
      }

      .section {
        margin-bottom: var(--space-lg);
      }

      .section-label {
        font-size: var(--text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--t-muted);
        margin-bottom: var(--space-sm);
      }

      /* Theme mode toggle */
      .mode-toggle {
        display: flex;
        gap: var(--space-xs);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-full);
        padding: 3px;
        margin-bottom: var(--space-md);
      }

      .mode-btn {
        flex: 1;
        padding: 6px 12px;
        border: none;
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--t-muted);
        cursor: pointer;
        font-size: var(--text-md);
        transition: all 0.2s;
      }

      .mode-btn.active {
        background: var(--accent-primary);
        color: white;
      }

      .mode-btn:hover:not(.active) {
        background: var(--bg-glass-strong);
      }

      /* Sliders */
      .slider-group {
        margin-bottom: var(--space-md);
      }

      .slider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      .slider-label {
        font-size: var(--text-sm);
        color: var(--t-primary);
        font-weight: 500;
      }

      .slider-value {
        font-size: var(--text-xs);
        color: var(--t-muted);
        font-family: var(--font-mono);
        min-width: 40px;
        text-align: right;
      }

      input[type='range'] {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 6px;
        border-radius: 3px;
        outline: none;
        cursor: pointer;
      }

      input[type='range']::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--accent-primary);
        border: 2px solid white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        transition: transform 0.15s;
      }

      input[type='range']::-webkit-slider-thumb:hover {
        transform: scale(1.15);
      }

      .hue-slider {
        background: linear-gradient(
          to right,
          oklch(0.65 0.15 0),
          oklch(0.65 0.15 60),
          oklch(0.65 0.15 120),
          oklch(0.65 0.15 180),
          oklch(0.65 0.15 240),
          oklch(0.65 0.15 300),
          oklch(0.65 0.15 360)
        );
      }

      .chroma-slider {
        background: linear-gradient(
          to right,
          oklch(0.65 0 var(--hue-val, 260)),
          oklch(0.65 0.3 var(--hue-val, 260))
        );
      }

      .lightness-slider {
        background: linear-gradient(
          to right,
          oklch(0.2 0.1 var(--hue-val, 260)),
          oklch(0.9 0.1 var(--hue-val, 260))
        );
      }

      /* Presets */
      .presets-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-xs);
      }

      .preset-btn {
        padding: 8px;
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        background: var(--bg-glass);
        color: var(--t-primary);
        cursor: pointer;
        font-size: var(--text-xs);
        transition: all 0.2s;
        text-align: center;
      }

      .preset-btn:hover {
        border-color: var(--accent-primary);
        background: var(--bg-glass-strong);
      }

      .preset-btn.active {
        border-color: var(--accent-primary);
        background: var(--accent-primary);
        color: white;
      }

      .preset-swatch {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin: 0 auto 4px;
        border: 2px solid var(--border-glass);
      }

      .preset-btn.active .preset-swatch {
        border-color: white;
      }

      /* Preview strip */
      .preview-strip {
        display: flex;
        gap: 3px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        margin-top: var(--space-sm);
      }

      .preview-swatch {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }

      .swatch-color {
        width: 100%;
        height: 24px;
        border-radius: 3px;
      }

      .swatch-label {
        font-size: var(--text-2xs);
        color: var(--t-muted);
        text-align: center;
        line-height: 1;
      }

      /* Reset */
      .reset-btn {
        width: 100%;
        padding: var(--space-sm);
        background: none;
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--t-muted);
        cursor: pointer;
        font-size: var(--text-sm);
        transition: all 0.2s;
      }

      .reset-btn:hover {
        color: var(--color-error);
        border-color: var(--color-error);
      }
    `,
  ];

  @property({ type: String })
  currentTheme: Theme = 'dark';

  @state() private _hue = 260;
  @state() private _chroma = 0.15;
  @state() private _lightness = 0.65;
  @state() private _presetName: string | undefined = 'Default Violet';

  connectedCallback() {
    super.connectedCallback();
    this._loadConfig();
  }

  private _loadConfig() {
    try {
      const stored = localStorage.getItem(THEME_CONFIG_KEY);
      if (stored) {
        const config: ThemeConfigState = JSON.parse(stored);
        this._hue = config.hue;
        this._chroma = config.chroma;
        this._lightness = config.lightness;
        this._presetName = config.presetName;
      }
    } catch {
      // use defaults
    }
  }

  private _saveConfig() {
    const config: ThemeConfigState = {
      hue: this._hue,
      chroma: this._chroma,
      lightness: this._lightness,
      presetName: this._presetName,
    };
    localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify(config));
  }

  private _emitThemeUpdate() {
    this._saveConfig();
    const themeConfig: ThemeConfig = {
      hue: this._hue,
      chroma: this._chroma,
      lightness: this._lightness,
      theme: this.currentTheme,
    };
    const beamColors = generateBeamThemeColors(themeConfig);
    const cssVars = beamThemeToCSS(beamColors);

    this.dispatchEvent(
      new CustomEvent('oklch-theme-change', {
        detail: { config: themeConfig, cssVars },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _handleHue(e: Event) {
    this._hue = Number((e.target as HTMLInputElement).value);
    this._presetName = undefined;
    this._emitThemeUpdate();
  }

  private _handleChroma(e: Event) {
    this._chroma = Number((e.target as HTMLInputElement).value);
    this._presetName = undefined;
    this._emitThemeUpdate();
  }

  private _handleLightness(e: Event) {
    this._lightness = Number((e.target as HTMLInputElement).value);
    this._presetName = undefined;
    this._emitThemeUpdate();
  }

  private _selectPreset(preset: (typeof themePresets)[0]) {
    this._hue = preset.config.hue;
    this._chroma = preset.config.chroma;
    this._lightness = preset.config.lightness;
    this._presetName = preset.name;
    this._emitThemeUpdate();
  }

  private _setThemeMode(mode: Theme) {
    this.dispatchEvent(
      new CustomEvent('theme-change', {
        detail: { theme: mode },
        bubbles: true,
        composed: true,
      })
    );
    // Re-emit OKLCH with new mode
    setTimeout(() => this._emitThemeUpdate(), 0);
  }

  private _reset() {
    // Remove OKLCH config, revert to built-in theme
    localStorage.removeItem(THEME_CONFIG_KEY);
    this._hue = 260;
    this._chroma = 0.15;
    this._lightness = 0.65;
    this._presetName = 'Default Violet';

    this.dispatchEvent(new CustomEvent('oklch-theme-reset', { bubbles: true, composed: true }));
  }

  render() {
    const previewConfig: ThemeConfig = {
      hue: this._hue,
      chroma: this._chroma,
      lightness: this._lightness,
      theme: this.currentTheme,
    };
    const preview = generateBeamThemeColors(previewConfig);

    return html`
      <div class="panel-header">
        <h3>Theme</h3>
        <button
          class="close-btn"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}
          title="Close"
        >
          ✕
        </button>
      </div>

      <!-- Dark/Light toggle -->
      <div class="section">
        <div class="mode-toggle">
          <button
            class="mode-btn ${this.currentTheme === 'light' ? 'active' : ''}"
            @click=${() => this._setThemeMode('light')}
          >
            ☀️ Light
          </button>
          <button
            class="mode-btn ${this.currentTheme === 'dark' ? 'active' : ''}"
            @click=${() => this._setThemeMode('dark')}
          >
            🌙 Dark
          </button>
        </div>
      </div>

      <!-- Presets -->
      <div class="section">
        <div class="section-label">Presets</div>
        <div class="presets-grid">
          ${themePresets.map((preset) => {
            const swatch = generateBeamThemeColors({
              ...preset.config,
              theme: this.currentTheme,
            });
            return html`
              <button
                class="preset-btn ${this._presetName === preset.name ? 'active' : ''}"
                @click=${() => this._selectPreset(preset)}
              >
                <div class="preset-swatch" style="background: ${swatch.accentPrimary}"></div>
                ${preset.name.replace(' ', '\u00A0')}
              </button>
            `;
          })}
        </div>
      </div>

      <!-- Sliders -->
      <div class="section">
        <div class="section-label">Custom</div>

        <div class="slider-group">
          <div class="slider-header">
            <span class="slider-label">Hue</span>
            <span class="slider-value">${Math.round(this._hue)}°</span>
          </div>
          <input
            type="range"
            class="hue-slider"
            min="0"
            max="360"
            step="1"
            .value=${String(this._hue)}
            @input=${this._handleHue}
          />
        </div>

        <div class="slider-group" style="--hue-val: ${this._hue}">
          <div class="slider-header">
            <span class="slider-label">Chroma</span>
            <span class="slider-value">${this._chroma.toFixed(2)}</span>
          </div>
          <input
            type="range"
            class="chroma-slider"
            min="0"
            max="0.3"
            step="0.01"
            .value=${String(this._chroma)}
            @input=${this._handleChroma}
          />
        </div>

        <div class="slider-group" style="--hue-val: ${this._hue}">
          <div class="slider-header">
            <span class="slider-label">Lightness</span>
            <span class="slider-value">${this._lightness.toFixed(2)}</span>
          </div>
          <input
            type="range"
            class="lightness-slider"
            min="0.3"
            max="0.85"
            step="0.01"
            .value=${String(this._lightness)}
            @input=${this._handleLightness}
          />
        </div>
      </div>

      <!-- Preview -->
      <div class="section">
        <div class="section-label">Palette</div>
        <div class="preview-strip">
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.bgApp}"></div>
            <span class="swatch-label">Bg</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.bgPanel}"></div>
            <span class="swatch-label">Panel</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.accentPrimary}"></div>
            <span class="swatch-label">Accent</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.accentSecondary}"></div>
            <span class="swatch-label">Alt</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.tPrimary}"></div>
            <span class="swatch-label">Text</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.colorSuccess}"></div>
            <span class="swatch-label">OK</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.colorWarning}"></div>
            <span class="swatch-label">Warn</span>
          </div>
          <div class="preview-swatch">
            <div class="swatch-color" style="background: ${preview.colorError}"></div>
            <span class="swatch-label">Error</span>
          </div>
        </div>
      </div>

      <!-- Reset -->
      <button class="reset-btn" @click=${this._reset}>Reset to Default</button>
    `;
  }
}

/**
 * Load saved OKLCH theme config from localStorage.
 * Returns null if no custom theme is saved.
 */
export function loadSavedThemeConfig(): ThemeConfigState | null {
  try {
    const stored = localStorage.getItem(THEME_CONFIG_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return null;
}
