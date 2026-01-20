import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';

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
    `
  ];

  @state() private _connected = false;
  @state() private _photons: any[] = [];
  @state() private _selectedPhoton: any = null;
  @state() private _view: 'list' | 'form' = 'list';
  @state() private _selectedMethod: any = null;
  @state() private _activityLog: any[] = [];

  private _ws: WebSocket | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._connect();
  }

  private _connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WebSocket(`${protocol}//${window.location.host}`);

    this._ws.onopen = () => {
      this._connected = true;
      this._log('info', 'Connected to Beam server');
    };

    this._ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'photons') {
        this._photons = msg.data;
        if (!this._selectedPhoton && this._photons.length > 0) {
          this._selectedPhoton = this._photons[0];
        }
      }
    };

    this._ws.onclose = () => {
      this._connected = false;
      this._log('error', 'Disconnected from server');
      setTimeout(() => this._connect(), 2000);
    };
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
      <div class="background-glow"></div>
      
      <div class="sidebar-area glass-panel" style="margin: var(--space-sm); border-radius: var(--radius-md);">
        <beam-sidebar 
          .photons=${this._photons} 
          .selectedPhoton=${this._selectedPhoton?.name}
          @select=${this._handlePhotonSelect}
        ></beam-sidebar>
      </div>

      <main class="main-area">
        ${this._renderContent()}
        <activity-log .items=${this._activityLog} @clear=${() => this._activityLog = []}></activity-log>
      </main>
    `;
  }

  private _renderContent() {
    if (!this._selectedPhoton) {
      return html`
           <h1>Welcome to Beam</h1>
           <p style="color: var(--t-muted);">Select a Photon to begin.</p>
         `;
    }

    if (this._view === 'form' && this._selectedMethod) {
      return html`
          <div style="margin-bottom: var(--space-md);">
            <button 
              style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
              @click=${() => this._view = 'list'}
            >← Back to Methods</button>
          </div>
          <div class="glass-panel" style="padding: var(--space-lg);">
            <h2 style="margin-top:0;">${this._selectedMethod.name}</h2>
            <p style="color: var(--t-muted);">${this._selectedMethod.description}</p>
            <invoke-form 
              .params=${this._selectedMethod.params}
              @submit=${this._handleExecute}
              @cancel=${() => this._view = 'list'}
            ></invoke-form>
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
    this._view = 'list';
    this._selectedMethod = null;
  }

  private _handleMethodSelect(e: CustomEvent) {
    this._selectedMethod = e.detail.method;
    this._view = 'form';
  }

  private _handleExecute(e: CustomEvent) {
    const args = e.detail.args;
    this._log('info', `Invoking ${this._selectedMethod.name}...`);

    this._ws?.send(JSON.stringify({
      type: 'invoke',
      photon: this._selectedPhoton.name,
      method: this._selectedMethod.name,
      args
    }));

    this._view = 'list';
  }
}
