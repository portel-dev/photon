import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

const THEME_STORAGE_KEY = 'beam-theme';

@customElement('beam-app')
export class BeamApp extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: flex;
        height: 100vh;
        width: 100vw;
        background: var(--bg-app);
        color: var(--t-primary);
        font-family: var(--font-sans);
        overflow: hidden;
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

    this._connect();

    window.addEventListener('hashchange', this._handleHashChange);
    window.addEventListener('message', this._handleBridgeMessage);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._handleHashChange);
    window.removeEventListener('message', this._handleBridgeMessage);
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
                  <method-card .method=${method} @select=${this._handleMethodSelect}></method-card>
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
          <div style="margin-bottom: var(--space-md);">
            <button
              style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
              @click=${() => this._handleBackFromMethod()}
            >${backLabel}</button>
          </div>
          <div class="glass-panel" style="padding: var(--space-lg);">
            <h2 style="margin-top:0;">${this._selectedMethod.name}</h2>
            <p style="color: var(--t-muted);">${this._selectedMethod.description}</p>
            <invoke-form
              .params=${this._selectedMethod.params}
              .loading=${this._isExecuting}
              @submit=${this._handleExecute}
              @cancel=${() => this._handleBackFromMethod()}
            ></invoke-form>

            ${this._lastResult !== null ? html`
              <result-viewer
                .result=${this._lastResult}
                .outputFormat=${this._selectedMethod?.outputFormat}
                .layoutHints=${this._selectedMethod?.layoutHints}
              ></result-viewer>
            ` : ''}
          </div>
        `;
    }

    return html`
        <h1 class="text-gradient">${this._selectedPhoton.name}</h1>
        <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">
          ${this._selectedPhoton.description || 'Manage this photon instance.'}
        </p>

        <h3 style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em;">Methods</h3>
        <div class="cards-grid">
          ${(this._selectedPhoton.methods || []).map((method: any) => html`
            <method-card .method=${method} @select=${this._handleMethodSelect}></method-card>
          `)}
        </div>
      `;
  }

  private _handlePhotonSelect(e: CustomEvent) {
    this._selectedPhoton = e.detail.photon;
    this._selectedMethod = null;

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

  private _handleExecute(e: CustomEvent) {
    const args = e.detail.args;
    this._log('info', `Invoking ${this._selectedMethod.name}...`);
    this._lastResult = null;
    this._isExecuting = true;

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
  }

  private _handleThemeChange = (e: CustomEvent) => {
    const newTheme = e.detail.theme as Theme;
    this._theme = newTheme;
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    this._applyTheme();
    this._broadcastThemeToIframes();
  }

  private _applyTheme() {
    this.setAttribute('data-theme', this._theme);
  }

  private _broadcastThemeToIframes() {
    // Find any custom-ui-renderer iframes and notify them of theme change
    const iframes = this.shadowRoot?.querySelectorAll('iframe');
    iframes?.forEach(iframe => {
      iframe.contentWindow?.postMessage({
        type: 'photon:theme-change',
        theme: this._theme
      }, '*');
    });
  }
}
