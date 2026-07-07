import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// ─── Bridge Declarations ──────────────────────────────────────────────────
declare global {
  interface Window {
    photon?: {
      toolInput: Record<string, any>;
      widgetState: any;
      setWidgetState: (state: any) => void;
      callTool: (name: string, args: any) => Promise<any>;
      onProgress: (cb: (e: any) => void) => () => void;
      onEmit: (cb: (e: { emit: string; data?: any }) => void) => () => void;
      onResult: (cb: (r: any) => void) => () => void;
      onError: (cb: (err: any) => void) => () => void;
      onThemeChange: (cb: (theme: 'light' | 'dark') => void) => () => void;
      theme: 'light' | 'dark';
    };
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div [class]="'app-container ' + theme">
      <header class="app-header">
        <div class="header-logo">
          <span class="logo-icon">❤️</span>
          <h1>Photon Angular Dashboard</h1>
        </div>
        <div class="connection-badge">
          <span [class]="'status-dot ' + (hasBridge ? 'connected' : 'mock')"></span>
          {{ hasBridge ? 'Photon Connected' : 'Local Mock Mode' }}
        </div>
      </header>

      <main class="app-main">
        <div class="grid">
          <!-- Card 1: Parameters Received -->
          <section class="card card-input">
            <h2>📥 Initial Parameters</h2>
            <p class="card-desc">Values passed by the LLM agent or environment triggers:</p>
            <pre class="json-box">{{ inputJson }}</pre>
          </section>

          <!-- Card 2: Interactive Tools -->
          <section class="card card-tools">
            <h2>⚙️ Test Backend Tools</h2>
            <p class="card-desc">Call methods exposed on the server-side Photon class:</p>

            <div class="tool-row">
              <h3>Echo Tool</h3>
              <div class="input-group">
                <input type="text" [(ngModel)]="echoText" placeholder="Enter message..." />
                <button (click)="handleEcho()" [disabled]="loading['echo']">
                  {{ loading['echo'] ? 'Calling...' : 'Call Echo' }}
                </button>
              </div>
              <div *ngIf="echoResult" class="result-badge">{{ echoResult }}</div>
            </div>

            <div class="tool-row divider">
              <h3>Add Tool</h3>
              <div class="input-group">
                <input type="number" [(ngModel)]="numA" style="width: 80px" />
                <span class="math-operator">+</span>
                <input type="number" [(ngModel)]="numB" style="width: 80px" />
                <button (click)="handleAdd()" [disabled]="loading['add']">
                  {{ loading['add'] ? 'Calling...' : 'Call Add' }}
                </button>
              </div>
              <div *ngIf="addResult !== null" class="result-badge success">
                Sum: <strong>{{ addResult }}</strong>
              </div>
            </div>
          </section>

          <!-- Card 3: Real-time Event Feed -->
          <section class="card card-events">
            <h2>⚡ Real-Time Events</h2>
            <p class="card-desc">
              Live messages pushed from the backend via the event pub/sub pipeline:
            </p>
            <div class="event-feed">
              <div *ngIf="events.length === 0" class="feed-empty">
                No events received yet. Try running some tools.
              </div>
              <div *ngIf="events.length > 0">
                <div *ngFor="let e of events" class="event-item">
                  <span class="event-time">{{ e.time }}</span>
                  <span class="event-name">{{ e.emit }}</span>
                  <span class="event-data">{{ e.dataJson }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  hasBridge = typeof window.photon !== 'undefined';
  input = window.photon?.toolInput || {};
  inputJson = JSON.stringify(this.input, null, 2);
  theme: 'light' | 'dark' = window.photon?.theme || 'light';
  echoText = 'Hello Photon!';
  echoResult = '';
  numA = 5;
  numB = 10;
  addResult: number | null = null;
  loading: Record<string, boolean> = {};
  events: Array<{ time: string; emit: string; dataJson: string }> = [];

  private unsubscribeTheme?: () => void;
  private unsubscribeEmit?: () => void;

  ngOnInit() {
    if (window.photon) {
      this.unsubscribeTheme = window.photon.onThemeChange((newTheme) => {
        this.theme = newTheme;
      });

      this.unsubscribeEmit = window.photon.onEmit((event) => {
        this.events.unshift({
          time: new Date().toLocaleTimeString(),
          emit: event.emit,
          dataJson: JSON.stringify(event.data),
        });
        if (this.events.length > 10) {
          this.events.pop();
        }
      });
    }
  }

  ngOnDestroy() {
    if (this.unsubscribeTheme) this.unsubscribeTheme();
    if (this.unsubscribeEmit) this.unsubscribeEmit();
  }

  async callTool(name: string, args: any = {}) {
    if (window.photon) {
      return window.photon.callTool(name, args);
    }
    console.warn(`[Photon Mock] calling ${name} with`, args);
    return new Promise((resolve) =>
      setTimeout(() => {
        if (name === 'add') resolve({ a: args.a, b: args.b, sum: args.a + args.b });
        else if (name === 'echo') resolve(`Echo: ${args.message}`);
        else resolve({ mockResult: true });
      }, 500)
    );
  }

  async handleEcho() {
    this.loading['echo'] = true;
    try {
      const res = (await this.callTool('echo', { message: this.echoText })) as string;
      this.echoResult = res;
    } catch (err: any) {
      this.echoResult = `Error: ${err.message || err}`;
    } finally {
      this.loading['echo'] = false;
    }
  }

  async handleAdd() {
    this.loading['add'] = true;
    try {
      const res = (await this.callTool('add', { a: this.numA, b: this.numB })) as any;
      this.addResult = res?.sum ?? null;
    } catch (err: any) {
      console.error(err);
    } finally {
      this.loading['add'] = false;
    }
  }
}
