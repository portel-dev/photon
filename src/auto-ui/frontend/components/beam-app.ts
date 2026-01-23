import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';
import type { BeamSidebar } from './beam-sidebar.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import type { ElicitationData } from './elicitation-modal.js';
import { mcpClient } from '../services/mcp-client.js';

const THEME_STORAGE_KEY = 'beam-theme';
const PROTOCOL_STORAGE_KEY = 'beam-protocol';

@customElement('beam-app')
export class BeamApp extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        /* ===== Dark Theme (Default) ===== */
        --bg-app: hsl(220, 15%, 10%);
        --bg-glass: hsla(220, 15%, 14%, 0.6);
        --bg-glass-strong: hsla(220, 15%, 14%, 0.85);
        --bg-panel: hsl(220, 15%, 12%);
        --t-primary: hsl(220, 10%, 95%);
        --t-muted: hsl(220, 10%, 65%);
        --border-glass: hsla(220, 10%, 80%, 0.1);
        --accent-primary: hsl(260, 100%, 65%);
        --accent-secondary: hsl(190, 100%, 50%);
        --glow-primary: hsla(260, 100%, 65%, 0.3);

        display: flex;
        height: 100vh;
        width: 100vw;
        background: var(--bg-app);
        color: var(--t-primary);
        font-family: var(--font-sans);
        overflow: hidden;
      }

      /* ===== Light Theme - "Warm Editorial" ===== */
      :host([data-theme="light"]) {
        --bg-app: hsl(40, 20%, 94%);
        --bg-glass: hsla(45, 40%, 99%, 0.92);
        --bg-glass-strong: hsla(45, 50%, 100%, 0.97);
        --bg-panel: hsl(42, 35%, 97%);
        --t-primary: hsl(220, 30%, 15%);
        --t-muted: hsl(220, 10%, 45%);
        --border-glass: hsla(30, 20%, 50%, 0.15);
        --accent-primary: hsl(215, 70%, 48%);
        --accent-secondary: hsl(165, 60%, 38%);
        --glow-primary: hsla(215, 70%, 48%, 0.15);
      }

      .sidebar-area {
        width: 300px;
        flex-shrink: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
      }

      .main-area {
        flex: 1;
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--space-lg);
      }
      
      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-md);
        margin-bottom: var(--space-xl);
        align-items: stretch; /* Make cards same height per row */
      }

      /* Photon Header */
      .photon-header {
        display: flex;
        align-items: flex-start;
        gap: var(--space-lg);
        margin-bottom: var(--space-xl);
      }

      .photon-icon-large {
        width: 64px;
        height: 64px;
        border-radius: 16px;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        color: white;
        flex-shrink: 0;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      }

      .photon-icon-large.mcp-icon {
        background: var(--bg-glass);
        color: var(--accent-secondary);
        font-size: 20px;
        font-weight: 600;
      }

      .photon-icon-large img {
        width: 40px;
        height: 40px;
        object-fit: contain;
      }

      .photon-header-info {
        flex: 1;
        min-width: 0;
      }

      .photon-header-name {
        font-size: 2rem;
        font-weight: 700;
        margin: 0 0 var(--space-sm) 0;
        background: linear-gradient(135deg, var(--t-primary), var(--accent-secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .photon-header-desc {
        color: var(--t-muted);
        font-size: 1rem;
        line-height: 1.5;
        margin: 0;
      }

      .photon-header-meta {
        display: flex;
        gap: var(--space-md);
        margin-top: var(--space-sm);
      }

      .photon-badge {
        font-size: 0.75rem;
        padding: 4px 10px;
        border-radius: 12px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
      }

      .photon-badge.app {
        background: hsla(260, 100%, 65%, 0.15);
        border-color: hsla(260, 100%, 65%, 0.3);
        color: hsl(260, 100%, 75%);
      }

      /* Inline Editable Elements */
      .editable {
        cursor: pointer;
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        margin: -2px -6px;
        transition: background 0.15s ease, box-shadow 0.15s ease;
        position: relative;
      }

      .editable:hover {
        background: var(--bg-glass);
      }

      .editable:hover::after {
        content: '✏️';
        position: absolute;
        right: -24px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 0.8rem;
        opacity: 0.6;
      }

      .editable.editing {
        background: var(--bg-glass-strong);
        box-shadow: 0 0 0 2px var(--accent-primary);
      }

      .editable-input {
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        width: 100%;
        outline: none;
        padding: 0;
        margin: 0;
      }

      .editable-input::placeholder {
        color: var(--t-muted);
        font-style: italic;
      }

      .photon-header-desc.editable {
        min-width: 200px;
        display: inline-block;
      }

      .photon-header-desc.placeholder {
        color: var(--t-muted);
        font-style: italic;
      }

      /* Editable Icon */
      .photon-icon-large.editable {
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .photon-icon-large.editable:hover {
        transform: scale(1.05);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 3px var(--accent-primary);
      }

      /* Emoji Picker */
      .emoji-picker {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-sm);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 100;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
        max-width: 280px;
      }

      .emoji-picker button {
        background: none;
        border: none;
        font-size: 1.5rem;
        padding: 4px;
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: background 0.15s ease, transform 0.1s ease;
      }

      .emoji-picker button:hover {
        background: var(--bg-glass);
        transform: scale(1.1);
      }

      .background-glow {
        position: absolute;
        top: -20%;
        left: -10%;
        width: 50%;
        height: 50%;
        background: radial-gradient(circle, var(--glow-primary) 0%, transparent 70%);
        pointer-events: none;
        z-index: 0;
      }

      .connection-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #f87171;
        color: white;
        padding: var(--space-sm) var(--space-md);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-md);
        z-index: 9998;
        font-size: 0.9rem;
      }

      .connection-banner button {
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.8rem;
      }

      .connection-banner button:hover {
        background: rgba(255,255,255,0.3);
      }

      .reconnecting {
        background: #fbbf24;
      }

      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .help-modal {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-xl);
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
      }

      .help-modal h2 {
        margin: 0 0 var(--space-lg) 0;
        font-size: 1.5rem;
      }

      .help-modal-close {
        position: absolute;
        top: var(--space-md);
        right: var(--space-md);
        background: none;
        border: none;
        color: var(--t-muted);
        font-size: 1.5rem;
        cursor: pointer;
      }

      .shortcut-section {
        margin-bottom: var(--space-lg);
      }

      .shortcut-section h3 {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-muted);
        margin: 0 0 var(--space-sm) 0;
      }

      .shortcut-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }

      .shortcut-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-xs) 0;
      }

      .shortcut-key {
        display: inline-flex;
        gap: 4px;
      }

      .shortcut-key kbd {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: 4px;
        padding: 2px 8px;
        font-family: var(--font-mono);
        font-size: 0.85rem;
      }

      .shortcut-desc {
        color: var(--t-muted);
        font-size: 0.9rem;
      }

      /* Settings Menu Dropdown */
      .header-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-md);
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: var(--space-md);
      }

      .settings-container {
        position: relative;
      }

      .settings-btn {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem;
        transition: all 0.2s ease;
      }

      .settings-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .settings-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        min-width: 200px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 100;
        overflow: hidden;
      }

      .settings-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        cursor: pointer;
        color: var(--t-primary);
        font-size: 0.9rem;
        transition: background 0.15s ease;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }

      .settings-dropdown-item:hover {
        background: var(--bg-glass);
      }

      .settings-dropdown-item .icon {
        font-size: 1rem;
        width: 20px;
        text-align: center;
      }

      .settings-dropdown-divider {
        height: 1px;
        background: var(--border-glass);
        margin: 4px 0;
      }

      .settings-dropdown-item.toggle {
        justify-content: space-between;
      }

      .toggle-switch {
        width: 36px;
        height: 20px;
        background: var(--bg-glass);
        border-radius: 10px;
        position: relative;
        transition: background 0.2s ease;
      }

      .toggle-switch.active {
        background: var(--accent-primary);
      }

      .toggle-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s ease;
      }

      .toggle-switch.active::after {
        transform: translateX(16px);
      }
    `
  ];

  @state() private _connected = false;
  @state() private _reconnecting = false;
  @state() private _photons: any[] = [];
  @state() private _selectedPhoton: any = null;
  @state() private _view: 'list' | 'form' | 'marketplace' | 'config' = 'list';

  // ... (existing code)



  private _handleInstall(e: CustomEvent) {
    // Just log for now, the socket update 'photon_added' will handle the actual refresh
    this._log('info', `Installed ${e.detail.name}`);
  }
  @state() private _selectedMethod: any = null;
  @state() private _lastResult: any = null;
  @state() private _activityLog: any[] = [];
  @state() private _isExecuting = false;
  @state() private _theme: Theme = 'dark';
  @state() private _showHelp = false;
  @state() private _elicitationData: ElicitationData | null = null;
  @state() private _showElicitation = false;
  @state() private _protocolMode: 'legacy' | 'mcp' = 'legacy';
  @state() private _mcpReady = false;
  @state() private _showSettingsMenu = false;
  @state() private _rememberFormValues = false;
  @state() private _editingDescription = false;
  @state() private _editingIcon = false;
  @state() private _editedDescription = '';

  @query('beam-sidebar')
  private _sidebar!: BeamSidebar;

  private _ws: WebSocket | null = null;
  private _pendingBridgeCalls = new Map<string, Window>();

  connectedCallback() {
    super.connectedCallback();

    // Load saved theme preference
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
    if (savedTheme === 'light' || savedTheme === 'dark') {
      this._theme = savedTheme;
    }
    this._applyTheme();

    // Load saved protocol preference
    const savedProtocol = localStorage.getItem(PROTOCOL_STORAGE_KEY) as 'legacy' | 'mcp';
    if (savedProtocol === 'mcp') {
      this._protocolMode = 'mcp';
    }

    // Load saved remember values preference
    const savedRemember = localStorage.getItem('beam-remember-values');
    if (savedRemember === 'true') {
      this._rememberFormValues = true;
    }

    // Click outside to close settings menu
    document.addEventListener('click', this._handleDocumentClick);

    this._connect();
    this._connectMCP();

    window.addEventListener('hashchange', this._handleHashChange);
    window.addEventListener('message', this._handleBridgeMessage);
    window.addEventListener('keydown', this._handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._handleHashChange);
    window.removeEventListener('message', this._handleBridgeMessage);
    window.removeEventListener('keydown', this._handleKeydown);
    document.removeEventListener('click', this._handleDocumentClick);
  }

  private _handleDocumentClick = (e: MouseEvent) => {
    const path = e.composedPath();

    if (this._showSettingsMenu) {
      const settingsContainer = this.shadowRoot?.querySelector('.settings-container');
      if (settingsContainer && !path.includes(settingsContainer)) {
        this._showSettingsMenu = false;
      }
    }

    // Close emoji picker when clicking outside
    if (this._editingIcon) {
      const emojiPicker = this.shadowRoot?.querySelector('.emoji-picker');
      const iconElement = this.shadowRoot?.querySelector('.photon-icon-large');
      if (emojiPicker && !path.includes(emojiPicker) && !path.includes(iconElement!)) {
        this._editingIcon = false;
      }
    }
  }

  private async _connectMCP() {
    try {
      mcpClient.on('connect', () => {
        this._mcpReady = true;
        console.log('MCP client connected');
      });

      mcpClient.on('disconnect', () => {
        this._mcpReady = false;
      });

      mcpClient.on('tools-changed', async () => {
        if (this._protocolMode === 'mcp') {
          const tools = await mcpClient.listTools();
          this._photons = mcpClient.toolsToPhotons(tools);
        }
      });

      mcpClient.on('progress', (data: any) => {
        // Handle progress notifications
        this._log('info', data.message || 'Processing...');
      });

      await mcpClient.connect();
    } catch (error) {
      console.warn('MCP connection failed, using legacy protocol');
      this._mcpReady = false;
    }
  }

  private _connect() {
    if (this._ws && (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WebSocket(`${protocol}//${window.location.host}`);

    this._ws.onopen = () => {
      this._connected = true;
      this._reconnecting = false;
      this._log('info', 'Connected to Beam server');
      showToast('Connected to Beam server', 'success');
    };

    this._ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'photons') {
        this._photons = msg.data;
        // If we have a hash, restore state, otherwise select first
        if (window.location.hash) {
          this._handleHashChange();
        } else if (!this._selectedPhoton && this._photons.length > 0) {
          this._selectedPhoton = this._photons[0];
          this._updateHash();
        }
      } else if (msg.type === 'result') {
        // Check if this is a response to a bridge call
        if (msg.invocationId && this._pendingBridgeCalls.has(msg.invocationId)) {
          const source = this._pendingBridgeCalls.get(msg.invocationId);
          if (source) {
            source.postMessage({
              type: 'photon:call-tool-response',
              callId: msg.invocationId,
              result: msg.data,
              error: msg.error
            }, '*');
          }
          this._pendingBridgeCalls.delete(msg.invocationId);
        }

        this._lastResult = msg.data;
        this._isExecuting = false;
        this._log('success', 'Execution completed');
        showToast('Execution completed successfully', 'success');
      } else if (msg.type === 'configured') {
        // Photon was successfully configured
        const configuredPhoton = msg.photon;
        this._log('success', `${configuredPhoton.name} configured successfully`);
        showToast(`${configuredPhoton.name} configured successfully!`, 'success');

        // Update photon in list
        const index = this._photons.findIndex(p => p.name === configuredPhoton.name);
        if (index !== -1) {
          this._photons = [
            ...this._photons.slice(0, index),
            configuredPhoton,
            ...this._photons.slice(index + 1)
          ];
        }

        // Update selected photon and switch to methods view
        if (this._selectedPhoton?.name === configuredPhoton.name) {
          this._selectedPhoton = configuredPhoton;
          // If it's an app, show the custom UI
          if (configuredPhoton.isApp && configuredPhoton.appEntry) {
            this._selectedMethod = configuredPhoton.appEntry;
            this._view = 'form';
          } else {
            this._view = 'list';
          }
          this._updateHash();
        }
      } else if (msg.type === 'error') {
        // Also handle errors for bridge calls
        if (msg.invocationId && this._pendingBridgeCalls.has(msg.invocationId)) {
          const source = this._pendingBridgeCalls.get(msg.invocationId);
          if (source) {
            source.postMessage({
              type: 'photon:call-tool-response',
              callId: msg.invocationId,
              error: msg.message
            }, '*');
          }
          this._pendingBridgeCalls.delete(msg.invocationId);
        }
        this._isExecuting = false;
        this._log('error', msg.message);
        showToast(msg.message, 'error', 5000);
      } else if (msg.type === 'elicitation') {
        // Show elicitation modal for user input
        this._elicitationData = msg.data;
        this._showElicitation = true;
        this._log('info', `Input required: ${msg.data.message || msg.data.ask}`);
      }
    };

    this._ws.onclose = () => {
      this._connected = false;
      this._reconnecting = true;
      this._log('error', 'Disconnected from server');
      showToast('Connection lost. Reconnecting...', 'warning');
      setTimeout(() => this._connect(), 2000);
    };
  }

  private _handleHashChange = () => {
    const hash = window.location.hash.slice(1);
    const [photonName, methodName] = hash.split('/');

    if (photonName) {
      const photon = this._photons.find(p => p.name === photonName);
      if (photon) {
        this._selectedPhoton = photon;

        if (methodName && photon.methods) {
          const method = photon.methods.find((m: any) => m.name === methodName);
          if (method) {
            this._selectedMethod = method;
            this._view = 'form';
          }
        } else if (photon.isApp && photon.appEntry) {
          // For Apps without method specified, auto-select main
          this._selectedMethod = photon.appEntry;
          this._view = 'form';
        } else {
          this._selectedMethod = null;
          this._view = 'list';
        }
      }
    }
  }

  private _updateHash() {
    if (!this._selectedPhoton) return;
    let hash = this._selectedPhoton.name;
    if (this._selectedMethod) {
      hash += `/${this._selectedMethod.name}`;
    }
    // Update URL without scrolling
    history.replaceState(null, '', `#${hash}`);
  }

  private _log(type: string, message: string) {
    this._activityLog = [{
      id: Date.now().toString(),
      type,
      message,
      timestamp: new Date().toISOString()
    }, ...this._activityLog];
  }

  render() {
    return html`
      ${!this._connected ? html`
        <div class="connection-banner ${this._reconnecting ? 'reconnecting' : ''}">
          <span>${this._reconnecting ? 'Reconnecting to server...' : 'Disconnected from server'}</span>
          <button @click=${() => this._connect()}>Retry Now</button>
        </div>
      ` : ''}

      <div class="background-glow"></div>

      <div class="sidebar-area glass-panel" style="margin: var(--space-sm); border-radius: var(--radius-md);">
        <beam-sidebar
          .photons=${this._photons}
          .selectedPhoton=${this._selectedPhoton?.name}
          .theme=${this._theme}
          @select=${this._handlePhotonSelect}
          @marketplace=${() => this._view = 'marketplace'}
          @theme-change=${this._handleThemeChange}
        ></beam-sidebar>
      </div>

      <main class="main-area">
        ${this._renderContent()}
        <activity-log .items=${this._activityLog} @clear=${() => this._activityLog = []}></activity-log>
      </main>

      <toast-manager></toast-manager>

      ${this._showHelp ? this._renderHelpModal() : ''}

      <elicitation-modal
        ?open=${this._showElicitation}
        .data=${this._elicitationData}
        @submit=${this._handleElicitationSubmit}
        @cancel=${this._handleElicitationCancel}
        @oauth-complete=${this._handleOAuthComplete}
      ></elicitation-modal>
    `;
  }

  private _renderContent() {
    if (this._view === 'marketplace') {
      return html`
            <div style="margin-bottom: var(--space-md);">
                <button 
                  style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                  @click=${() => this._view = 'list'}
                >← Back to Dashboard</button>
            </div>
            <h1 class="text-gradient">Marketplace</h1>
            <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">
              Discover and install new Photons.
            </p>
            <marketplace-view @install=${this._handleInstall}></marketplace-view>
        `;
    }

    if (!this._selectedPhoton) {
      return html`
           <h1>Welcome to Beam</h1>
           <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">Select a Photon to begin.</p>

           <div class="glass-panel" style="padding: var(--space-xl); text-align: center;">
             <h3>No Photon Selected</h3>
             <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">Select one from the sidebar or explore the marketplace.</p>
             <button class="btn-primary" @click=${() => this._view = 'marketplace'}>
               Browse Marketplace
             </button>
           </div>
         `;
    }

    // Show configuration view for unconfigured photons
    if (this._view === 'config' || this._selectedPhoton.configured === false) {
      return html`
        <div class="glass-panel" style="padding: var(--space-lg); max-width: 600px;">
          <photon-config
            .photon=${this._selectedPhoton}
            @configure=${this._handleConfigure}
          ></photon-config>
        </div>
      `;
    }

    if (this._view === 'form' && this._selectedMethod) {
      // Check for Linked UI (Custom Interface)
      if (this._selectedMethod.linkedUi) {
        const isAppMain = this._selectedPhoton.isApp && this._selectedMethod.name === 'main';
        const otherMethods = isAppMain
          ? (this._selectedPhoton.methods || []).filter((m: any) => m.name !== 'main')
          : [];

        return html`
          ${!isAppMain ? html`
            <div style="margin-bottom: var(--space-md);">
              <button
                style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                @click=${() => this._handleBackFromMethod()}
              >← Back to ${this._selectedPhoton.isApp ? this._selectedPhoton.name : 'Methods'}</button>
            </div>
          ` : ''}
          <div class="glass-panel" style="padding: 0; overflow: hidden; min-height: calc(100vh - 80px);">
             <custom-ui-renderer
                .photon=${this._selectedPhoton.name}
                .method=${this._selectedMethod.name}
                .uiId=${this._selectedMethod.linkedUi}
                .theme=${this._theme}
                style="height: calc(100vh - 80px);"
             ></custom-ui-renderer>
          </div>

          ${isAppMain && otherMethods.length > 0 ? html`
            <div style="margin-top: var(--space-xl); padding-top: var(--space-xl); border-top: 1px solid var(--border-glass);">
              <h3 style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; margin-bottom: var(--space-md);">
                Additional Methods
              </h3>
              <div class="cards-grid">
                ${otherMethods.map((method: any) => html`
                  <method-card .method=${method} .photonName=${this._selectedPhoton.name} @select=${this._handleMethodSelect} @update-metadata=${this._handleMethodMetadataUpdate}></method-card>
                `)}
              </div>
            </div>
          ` : ''}
        `;
      }

      // Default Form Interface
      const isAppMethod = this._selectedPhoton.isApp && this._selectedPhoton.appEntry;
      const backLabel = isAppMethod ? `← Back to ${this._selectedPhoton.name}` : '← Back to Methods';

      return html`
          <div class="header-toolbar">
            <div class="header-left">
              <button
                style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                @click=${() => this._handleBackFromMethod()}
              >${backLabel}</button>
            </div>
            <div class="settings-container">
              <button class="settings-btn" @click=${this._toggleSettingsMenu}>
                <span>⚙️</span>
                <span>Settings</span>
              </button>
              ${this._showSettingsMenu ? html`
                <div class="settings-dropdown">
                  <button class="settings-dropdown-item" @click=${this._handleRefresh}>
                    <span class="icon">🔄</span>
                    <span>Refresh</span>
                  </button>
                  ${this._selectedPhoton.configured !== false ? html`
                    <button class="settings-dropdown-item" @click=${this._handleReconfigure}>
                      <span class="icon">🔧</span>
                      <span>Reconfigure</span>
                    </button>
                  ` : ''}
                  <div class="settings-dropdown-divider"></div>
                  <button class="settings-dropdown-item toggle" @click=${this._toggleRememberValues}>
                    <span style="display:flex;align-items:center;gap:10px;">
                      <span class="icon">💾</span>
                      <span>Remember Values</span>
                    </span>
                    <span class="toggle-switch ${this._rememberFormValues ? 'active' : ''}"></span>
                  </button>
                  <div class="settings-dropdown-divider"></div>
                  <button class="settings-dropdown-item" @click=${this._showHelpModal}>
                    <span class="icon">❓</span>
                    <span>Help & Shortcuts</span>
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
          <div class="glass-panel" style="padding: var(--space-lg);">
            <h2 style="margin-top:0;">${this._selectedMethod.name}</h2>
            <p style="color: var(--t-muted);">${this._selectedMethod.description}</p>
            <invoke-form
              .params=${this._selectedMethod.params}
              .loading=${this._isExecuting}
              .photonName=${this._selectedPhoton.name}
              .methodName=${this._selectedMethod.name}
              .rememberValues=${this._rememberFormValues}
              @submit=${this._handleExecute}
              @cancel=${() => this._handleBackFromMethod()}
            ></invoke-form>

            ${this._lastResult !== null ? html`
              <result-viewer
                .result=${this._lastResult}
                .outputFormat=${this._selectedMethod?.outputFormat}
                .layoutHints=${this._selectedMethod?.layoutHints}
                .theme=${this._theme}
              ></result-viewer>
            ` : ''}
          </div>
        `;
    }

    return html`
        <div class="header-toolbar">
          <div class="header-left"></div>
          <div class="settings-container">
            <button class="settings-btn" @click=${this._toggleSettingsMenu}>
              <span>⚙️</span>
              <span>Settings</span>
            </button>
            ${this._showSettingsMenu ? html`
              <div class="settings-dropdown">
                <button class="settings-dropdown-item" @click=${this._handleRefresh}>
                  <span class="icon">🔄</span>
                  <span>Refresh</span>
                </button>
                ${this._selectedPhoton.configured !== false ? html`
                  <button class="settings-dropdown-item" @click=${this._handleReconfigure}>
                    <span class="icon">🔧</span>
                    <span>Reconfigure</span>
                  </button>
                ` : ''}
                <div class="settings-dropdown-divider"></div>
                <button class="settings-dropdown-item toggle" @click=${this._toggleRememberValues}>
                  <span style="display:flex;align-items:center;gap:10px;">
                    <span class="icon">💾</span>
                    <span>Remember Values</span>
                  </span>
                  <span class="toggle-switch ${this._rememberFormValues ? 'active' : ''}"></span>
                </button>
                <div class="settings-dropdown-divider"></div>
                <button class="settings-dropdown-item" @click=${this._showHelpModal}>
                  <span class="icon">❓</span>
                  <span>Help & Shortcuts</span>
                </button>
              </div>
            ` : ''}
          </div>
        </div>

        ${this._renderPhotonHeader()}

        <h3 style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em;">Methods</h3>
        <div class="cards-grid">
          ${(this._selectedPhoton.methods || []).map((method: any) => html`
            <method-card .method=${method} .photonName=${this._selectedPhoton.name} @select=${this._handleMethodSelect} @update-metadata=${this._handleMethodMetadataUpdate}></method-card>
          `)}
        </div>
      `;
  }

  private _handlePhotonSelect(e: CustomEvent) {
    this._selectedPhoton = e.detail.photon;
    this._selectedMethod = null;
    this._lastResult = null;

    // For unconfigured photons, show configuration view
    if (this._selectedPhoton.configured === false) {
      this._view = 'config';
      this._updateHash();
      return;
    }

    // For Apps, automatically select the main method to show Custom UI
    if (this._selectedPhoton.isApp && this._selectedPhoton.appEntry) {
      this._selectedMethod = this._selectedPhoton.appEntry;
      this._view = 'form';
    } else {
      this._view = 'list';
    }
    this._updateHash();
  }

  private _handleMethodSelect(e: CustomEvent) {
    this._selectedMethod = e.detail.method;
    this._lastResult = null;
    this._view = 'form';
    this._updateHash();
  }

  private _handleBackFromMethod() {
    if (this._selectedPhoton.isApp && this._selectedPhoton.appEntry) {
      // For Apps, go back to the main Custom UI and scroll to methods
      this._selectedMethod = this._selectedPhoton.appEntry;
      this._view = 'form';
      this._updateHash();

      // Scroll to methods section after render
      this.updateComplete.then(() => {
        setTimeout(() => {
          const mainArea = this.shadowRoot?.querySelector('.main-area');
          if (mainArea) {
            // Scroll past the Custom UI to show methods
            mainArea.scrollTo({ top: mainArea.scrollHeight, behavior: 'smooth' });
          }
        }, 100);
      });
    } else {
      // For regular photons, go back to methods list
      this._view = 'list';
      this._selectedMethod = null;
      this._updateHash();
    }
  }

  private _toggleSettingsMenu = () => {
    this._showSettingsMenu = !this._showSettingsMenu;
  }

  private _closeSettingsMenu = () => {
    this._showSettingsMenu = false;
  }

  private _handleRefresh = () => {
    this._closeSettingsMenu();
    // Refresh photons list
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'list' }));
      showToast('Refreshing photons...', 'info');
    }
  }

  private _handleReconfigure = () => {
    this._closeSettingsMenu();
    this._view = 'config';
    this._updateHash();
  }

  private _toggleRememberValues = () => {
    this._rememberFormValues = !this._rememberFormValues;
    localStorage.setItem('beam-remember-values', String(this._rememberFormValues));
    showToast(this._rememberFormValues ? 'Form values will be remembered' : 'Form values will not be remembered', 'info');
  }

  private async _handleExecute(e: CustomEvent) {
    const args = e.detail.args;
    this._log('info', `Invoking ${this._selectedMethod.name}...`);
    this._lastResult = null;
    this._isExecuting = true;

    // Use MCP if enabled and ready
    if (this._protocolMode === 'mcp' && this._mcpReady) {
      try {
        const toolName = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;
        const result = await mcpClient.callTool(toolName, args);

        if (result.isError) {
          const errorText = result.content.find(c => c.type === 'text')?.text || 'Unknown error';
          this._log('error', errorText);
          showToast(errorText, 'error', 5000);
        } else {
          this._lastResult = mcpClient.parseToolResult(result);
          this._log('success', 'Execution completed');
          showToast('Execution completed successfully', 'success');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this._log('error', message);
        showToast(message, 'error', 5000);
      } finally {
        this._isExecuting = false;
      }
      return;
    }

    // Fall back to legacy protocol
    this._ws?.send(JSON.stringify({
      type: 'invoke',
      photon: this._selectedPhoton.name,
      method: this._selectedMethod.name,
      args
    }));
  }

  private _handleConfigure(e: CustomEvent) {
    const { photon, config } = e.detail;
    this._log('info', `Configuring ${photon}...`);

    this._ws?.send(JSON.stringify({
      type: 'configure',
      photon,
      config
    }));
  }
  private _handleBridgeMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'photon:call-tool') {
      const callId = msg.callId;
      if (this._selectedPhoton) {
        if (event.source) {
          this._pendingBridgeCalls.set(callId, event.source as Window);
        }

        this._log('info', `Bridge invoking ${msg.toolName}...`);

        this._ws?.send(JSON.stringify({
          type: 'invoke',
          photon: this._selectedPhoton.name,
          method: msg.toolName,
          args: msg.args,
          invocationId: callId
        }));
      }
    }

    // Handle app state persistence
    if (msg.type === 'photon:set-state') {
      if (this._selectedPhoton && this._selectedMethod) {
        const stateKey = `beam-app-state:${this._selectedPhoton.name}:${this._selectedMethod.name}`;
        try {
          localStorage.setItem(stateKey, JSON.stringify(msg.state));
        } catch (e) {
          console.warn('Failed to persist app state:', e);
        }
      }
    }

    // Handle request for persisted state
    if (msg.type === 'photon:get-state') {
      if (this._selectedPhoton && this._selectedMethod && event.source) {
        const stateKey = `beam-app-state:${this._selectedPhoton.name}:${this._selectedMethod.name}`;
        try {
          const savedState = localStorage.getItem(stateKey);
          const state = savedState ? JSON.parse(savedState) : null;
          (event.source as Window).postMessage({
            type: 'photon:init-state',
            state
          }, '*');
        } catch (e) {
          console.warn('Failed to load app state:', e);
        }
      }
    }
  }

  private _handleThemeChange = (e: CustomEvent) => {
    const newTheme = e.detail.theme as Theme;
    this._theme = newTheme;
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    this._applyTheme();
    this._broadcastThemeToIframes();
  }

  private _handleElicitationSubmit = (e: CustomEvent) => {
    const { value } = e.detail;
    this._ws?.send(JSON.stringify({
      type: 'elicitation_response',
      value
    }));
    this._showElicitation = false;
    this._elicitationData = null;
    this._log('info', 'Input submitted');
  }

  private _handleElicitationCancel = () => {
    this._ws?.send(JSON.stringify({
      type: 'elicitation_response',
      cancelled: true
    }));
    this._showElicitation = false;
    this._elicitationData = null;
    this._isExecuting = false;
    this._log('info', 'Input cancelled');
    showToast('Input cancelled', 'info');
  }

  private _handleOAuthComplete = (e: CustomEvent) => {
    const { elicitationId, success } = e.detail;
    this._ws?.send(JSON.stringify({
      type: 'oauth_complete',
      elicitationId,
      success
    }));
    this._showElicitation = false;
    this._elicitationData = null;
    if (success) {
      this._log('success', 'Authorization completed');
      showToast('Authorization completed', 'success');
    }
  }

  private _applyTheme() {
    this.setAttribute('data-theme', this._theme);
  }

  private _broadcastThemeToIframes() {
    const themeTokens = getThemeTokens(this._theme);

    // Find custom-ui-renderer components and notify their iframes
    const renderers = this.shadowRoot?.querySelectorAll('custom-ui-renderer');
    renderers?.forEach((renderer) => {
      const shadowRoot = (renderer as any).shadowRoot;
      const iframe = shadowRoot?.querySelector('iframe');
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'photon:theme-change',
          theme: this._theme,
          themeTokens: themeTokens
        }, '*');
      }
    });

    // Also check for any direct iframes (fallback)
    const iframes = this.shadowRoot?.querySelectorAll('iframe');
    iframes?.forEach((iframe) => {
      iframe.contentWindow?.postMessage({
        type: 'photon:theme-change',
        theme: this._theme,
        themeTokens: themeTokens
      }, '*');
    });
  }

  private _handleKeydown = (e: KeyboardEvent) => {
    // Skip if typing in an input field (unless it's a special key combo)
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Ctrl/Cmd+K or / to focus search
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !isInput)) {
      e.preventDefault();
      this._sidebar?.focusSearch();
      return;
    }

    // Escape to close modals or clear
    if (e.key === 'Escape') {
      if (this._showHelp) {
        this._showHelp = false;
        return;
      }
      if (this._view === 'form' && this._selectedMethod) {
        this._handleBackFromMethod();
        return;
      }
      if (this._view === 'marketplace') {
        this._view = 'list';
        return;
      }
    }

    // Skip other shortcuts if in input
    if (isInput) return;

    // ? to show help
    if (e.key === '?' && e.shiftKey) {
      this._showHelp = !this._showHelp;
      return;
    }

    // t to toggle theme
    if (e.key === 't') {
      const newTheme = this._theme === 'dark' ? 'light' : 'dark';
      this._theme = newTheme;
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      this._applyTheme();
      this._broadcastThemeToIframes();
      showToast(`Theme: ${newTheme}`, 'info');
      return;
    }

    // p to show marketplace
    if (e.key === 'p') {
      this._view = 'marketplace';
      return;
    }

    // f to toggle favorites filter
    if (e.key === 'f') {
      this._sidebar?.toggleFavoritesFilter();
      const isActive = this._sidebar?.isFavoritesFilterActive();
      showToast(isActive ? 'Showing favorites only' : 'Showing all photons', 'info');
      return;
    }

    // h to go back
    if (e.key === 'h') {
      if (this._view === 'form') {
        this._handleBackFromMethod();
      } else if (this._view === 'marketplace') {
        this._view = 'list';
      }
      return;
    }

    // [ and ] to navigate photons
    if (e.key === '[' || e.key === ']') {
      const photons = this._sidebar?.getAllPhotons() || this._photons;
      if (photons.length === 0) return;

      const currentIndex = this._selectedPhoton
        ? photons.findIndex(p => p.name === this._selectedPhoton.name)
        : -1;

      let newIndex: number;
      if (e.key === '[') {
        newIndex = currentIndex <= 0 ? photons.length - 1 : currentIndex - 1;
      } else {
        newIndex = currentIndex >= photons.length - 1 ? 0 : currentIndex + 1;
      }

      const newPhoton = photons[newIndex];
      if (newPhoton) {
        this._handlePhotonSelect(new CustomEvent('select', { detail: { photon: newPhoton } }));
      }
      return;
    }

    // j/k or arrows to navigate methods
    if ((e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') && this._view === 'list') {
      const methods = this._selectedPhoton?.methods || [];
      if (methods.length === 0) return;

      const currentIndex = this._selectedMethod
        ? methods.findIndex((m: any) => m.name === this._selectedMethod.name)
        : -1;

      let newIndex: number;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        newIndex = currentIndex >= methods.length - 1 ? 0 : currentIndex + 1;
      } else {
        newIndex = currentIndex <= 0 ? methods.length - 1 : currentIndex - 1;
      }

      this._selectedMethod = methods[newIndex];
      // Highlight but don't navigate to form
      return;
    }

    // Enter to select highlighted method
    if (e.key === 'Enter' && this._selectedMethod && this._view === 'list') {
      this._view = 'form';
      this._updateHash();
      return;
    }

    // r to reload/re-execute
    if (e.key === 'r') {
      if (this._view === 'form' && this._selectedMethod && this._lastResult !== null) {
        // Re-execute last method (would need form data - skip for now)
        showToast('Press Ctrl+Enter in form to re-execute', 'info');
      }
      return;
    }
  }

  private _closeHelp() {
    this._showHelp = false;
  }

  private _showHelpModal = () => {
    this._closeSettingsMenu();
    this._showHelp = true;
  }

  private _renderPhotonHeader() {
    if (!this._selectedPhoton) return '';

    const isApp = this._selectedPhoton.isApp;
    const methodCount = this._selectedPhoton.methods?.length || 0;
    const description = this._selectedPhoton.description || `${this._selectedPhoton.name} MCP`;
    const isGenericDesc = description.endsWith(' MCP') || description === 'Photon tool';

    // Get icon - check for custom icon first, then app icon, then initials
    const customIcon = this._selectedPhoton.icon;
    const photonInitials = this._selectedPhoton.name.substring(0, 2).toUpperCase();
    const defaultIcon = isApp ? '📱' : photonInitials;
    const displayIcon = customIcon || defaultIcon;

    return html`
      <div class="photon-header">
        <div class="photon-icon-large editable ${isApp ? '' : 'mcp-icon'}"
             @click=${this._startEditingIcon}
             title="Click to change icon">
          ${displayIcon}
        </div>
        ${this._editingIcon ? this._renderEmojiPicker() : ''}
        <div class="photon-header-info">
          <h1 class="photon-header-name">${this._selectedPhoton.name}</h1>
          ${this._editingDescription ? html`
            <p class="photon-header-desc editable editing">
              <input
                class="editable-input"
                type="text"
                .value=${this._editedDescription}
                placeholder="Add a description..."
                @input=${(e: Event) => this._editedDescription = (e.target as HTMLInputElement).value}
                @blur=${this._saveDescription}
                @keydown=${this._handleDescriptionKeydown}
                autofocus
              />
            </p>
          ` : html`
            <p class="photon-header-desc editable ${isGenericDesc ? 'placeholder' : ''}"
               @click=${this._startEditingDescription}
               title="Click to edit description">
              ${isGenericDesc ? 'Click to add a description...' : description}
            </p>
          `}
          <div class="photon-header-meta">
            ${isApp ? html`<span class="photon-badge app">App</span>` : html`<span class="photon-badge">MCP</span>`}
            <span class="photon-badge">${methodCount} method${methodCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
    `;
  }

  private _startEditingDescription = () => {
    const desc = this._selectedPhoton?.description || '';
    const isGeneric = desc.endsWith(' MCP') || desc === 'Photon tool';
    this._editedDescription = isGeneric ? '' : desc;
    this._editingDescription = true;
  }

  private _handleDescriptionKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._saveDescription();
    } else if (e.key === 'Escape') {
      this._editingDescription = false;
    }
  }

  private _saveDescription = () => {
    this._editingDescription = false;
    const newDesc = this._editedDescription.trim();

    if (newDesc && this._selectedPhoton) {
      // Update local state optimistically
      const oldDesc = this._selectedPhoton.description;
      this._selectedPhoton = { ...this._selectedPhoton, description: newDesc };

      // Send to server to persist
      this._ws?.send(JSON.stringify({
        type: 'update-metadata',
        photon: this._selectedPhoton.name,
        metadata: { description: newDesc }
      }));

      showToast('Description updated', 'success');
    }
  }

  private _startEditingIcon = () => {
    this._editingIcon = !this._editingIcon;
  }

  private _selectIcon = (icon: string) => {
    this._editingIcon = false;

    if (this._selectedPhoton) {
      // Update local state optimistically
      this._selectedPhoton = { ...this._selectedPhoton, icon };

      // Send to server to persist
      this._ws?.send(JSON.stringify({
        type: 'update-metadata',
        photon: this._selectedPhoton.name,
        metadata: { icon }
      }));

      showToast('Icon updated', 'success');
    }
  }

  private _handleMethodMetadataUpdate = (e: CustomEvent) => {
    const { photonName, methodName, metadata } = e.detail;

    if (this._selectedPhoton && this._selectedPhoton.name === photonName) {
      // Update local state optimistically
      const methods = this._selectedPhoton.methods?.map((m: any) => {
        if (m.name === methodName) {
          return {
            ...m,
            ...(metadata.description !== undefined ? { description: metadata.description || '' } : {}),
            ...(metadata.icon !== undefined ? { icon: metadata.icon || undefined } : {})
          };
        }
        return m;
      });

      this._selectedPhoton = { ...this._selectedPhoton, methods };

      // Send to server to persist
      this._ws?.send(JSON.stringify({
        type: 'update-method-metadata',
        photon: photonName,
        method: methodName,
        metadata
      }));

      showToast(`Method ${metadata.description !== undefined ? 'description' : 'icon'} updated`, 'success');
    }
  }

  private _renderEmojiPicker() {
    const emojis = [
      '🔧', '⚙️', '🛠️', '🔨', '🔩', '⚡', '💡', '🎯',
      '📊', '📈', '📉', '📋', '📝', '📁', '📂', '🗂️',
      '🌐', '🔗', '🔒', '🔓', '🔑', '🛡️', '🔍', '🔎',
      '💾', '💿', '📀', '🖥️', '💻', '📱', '⌨️', '🖱️',
      '🤖', '🧠', '🎨', '🎭', '🎬', '🎮', '🎲', '🧩',
      '📧', '💬', '💭', '🗨️', '📣', '📢', '🔔', '🔕',
      '✅', '❌', '⭐', '🌟', '💫', '✨', '🔥', '💥',
    ];

    return html`
      <div class="emoji-picker" @click=${(e: Event) => e.stopPropagation()}>
        ${emojis.map(emoji => html`
          <button @click=${() => this._selectIcon(emoji)}>${emoji}</button>
        `)}
      </div>
    `;
  }

  private _renderHelpModal() {
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeHelp(); }}>
        <div class="help-modal glass-panel">
          <h2 class="text-gradient">Keyboard Shortcuts</h2>

          <div class="shortcut-section">
            <h3>Navigation</h3>
            <div class="shortcut-list">
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>⌘</kbd><kbd>K</kbd></span>
                <span class="shortcut-desc">Focus search</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>/</kbd></span>
                <span class="shortcut-desc">Focus search</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>[</kbd> <kbd>]</kbd></span>
                <span class="shortcut-desc">Previous / Next photon</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>j</kbd> <kbd>k</kbd></span>
                <span class="shortcut-desc">Navigate methods</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>Enter</kbd></span>
                <span class="shortcut-desc">Select method</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>h</kbd></span>
                <span class="shortcut-desc">Go back</span>
              </div>
            </div>
          </div>

          <div class="shortcut-section">
            <h3>Actions</h3>
            <div class="shortcut-list">
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>⌘</kbd><kbd>Enter</kbd></span>
                <span class="shortcut-desc">Submit form</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>Esc</kbd></span>
                <span class="shortcut-desc">Close / Cancel</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>t</kbd></span>
                <span class="shortcut-desc">Toggle theme</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>p</kbd></span>
                <span class="shortcut-desc">Open marketplace</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>f</kbd></span>
                <span class="shortcut-desc">Toggle favorites filter</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>?</kbd></span>
                <span class="shortcut-desc">Show this help</span>
              </div>
            </div>
          </div>

          <button
            class="btn-primary"
            style="width: 100%; margin-top: var(--space-md);"
            @click=${this._closeHelp}
          >Close</button>
        </div>
      </div>
    `;
  }
}
