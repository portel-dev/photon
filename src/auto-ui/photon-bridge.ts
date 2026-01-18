/**
 * PhotonBridge - Unified UI Communication Layer
 *
 * Provides a standardized API for custom UIs to communicate with Photon servers.
 * Compatible with OpenAI Apps SDK patterns and MCP Apps (SEP-1865) proposal.
 *
 * Usage in custom UI (iframe):
 *   window.photon.onProgress((data) => updateProgressBar(data.value));
 *   window.photon.onElicitation(async (ask) => showMyDialog(ask));
 *
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui/
 * @see https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
 */

// Browser globals for client-side code (runs in iframe)
 
declare const window: {
  photon?: PhotonBridge;
  openai?: any;
  parent: { postMessage(message: any, targetOrigin: string): void };
  addEventListener(type: string, listener: (event: { data: any; source: any }) => void): void;
  removeEventListener(type: string, listener: (event: { data: any; source: any }) => void): void;
};

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface ProgressEvent {
  emit: 'progress';
  value: number; // 0-1
  message?: string;
}

export interface StatusEvent {
  emit: 'status';
  message: string;
}

export interface StreamEvent {
  emit: 'stream';
  data: any;
}

export type EmitEvent = ProgressEvent | StatusEvent | StreamEvent;

export interface AskTextEvent {
  ask: 'text' | 'password';
  message: string;
  default?: string;
  placeholder?: string;
}

export interface AskConfirmEvent {
  ask: 'confirm';
  message: string;
  default?: boolean;
}

export interface AskSelectEvent {
  ask: 'select';
  message: string;
  options: Array<string | { value: string; label: string }>;
  default?: string;
}

export interface AskNumberEvent {
  ask: 'number';
  message: string;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

export type AskEvent = AskTextEvent | AskConfirmEvent | AskSelectEvent | AskNumberEvent;

export interface PhotonContext {
  theme: 'light' | 'dark';
  locale: string;
  photon: string;
  method: string;
}

/**
 * PhotonBridge API - injected as window.photon in custom UI iframes
 */
export interface PhotonBridge {
  // ─────────────────────────────────────────────────────────────────────────────
  // Data Access (OpenAI Apps SDK compatible)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Arguments supplied when the tool was invoked */
  toolInput: Record<string, any>;

  /** Structured content returned by the tool (available after completion) */
  toolOutput: any;

  /** Snapshot of UI state persisted between renders */
  widgetState: any;

  /** Synchronously store state snapshot after UI interactions */
  setWidgetState(state: any): void;

  // ─────────────────────────────────────────────────────────────────────────────
  // Real-time Event Subscriptions (Photon-specific)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Subscribe to progress updates (0-1 value with optional message) */
  onProgress(callback: (event: ProgressEvent) => void): () => void;

  /** Subscribe to status messages (spinner/indeterminate progress) */
  onStatus(callback: (event: StatusEvent) => void): () => void;

  /** Subscribe to stream data chunks */
  onStream(callback: (event: StreamEvent) => void): () => void;

  /** Subscribe to any emit event */
  onEmit(callback: (event: EmitEvent) => void): () => void;

  /**
   * Handle elicitation requests from the server
   * Return a promise that resolves with the user's response
   */
  onElicitation(handler: (ask: AskEvent) => Promise<any>): () => void;

  /** Subscribe to result (tool completion) */
  onResult(callback: (result: any) => void): () => void;

  /** Subscribe to errors */
  onError(callback: (error: { message: string; code?: string }) => void): () => void;

  // ─────────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /** Invoke another tool on the same photon */
  callTool(toolName: string, args: Record<string, any>): Promise<any>;

  /** Alias for callTool - invoke another tool on the same photon */
  invoke(toolName: string, args: Record<string, any>): Promise<any>;

  /** Send a follow-up message (for conversational UIs) */
  sendFollowUpMessage(message: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Context
  // ─────────────────────────────────────────────────────────────────────────────

  /** Current theme */
  theme: 'light' | 'dark';

  /** User locale */
  locale: string;

  /** Current photon name */
  photon: string;

  /** Current method being executed */
  method: string;

  /** Check if running inside ChatGPT (has window.openai) */
  isChatGPT: boolean;
}

// ════════════════════════════════════════════════════════════════════════════════
// MESSAGE PROTOCOL (postMessage between host and iframe)
// ════════════════════════════════════════════════════════════════════════════════

export type HostToUIMessage =
  | { type: 'photon:init'; context: PhotonContext; toolInput: Record<string, any> }
  | { type: 'photon:emit'; event: EmitEvent }
  | { type: 'photon:ask'; id: string; event: AskEvent }
  | { type: 'photon:result'; data: any }
  | { type: 'photon:error'; error: { message: string; code?: string } }
  | { type: 'photon:context'; context: Partial<PhotonContext> }
  | { type: 'photon:call-tool-response'; callId: string; result?: any; error?: string };

export type UIToHostMessage =
  | { type: 'photon:ready' }
  | { type: 'photon:ask-response'; id: string; value: any }
  | { type: 'photon:call-tool'; toolName: string; args: Record<string, any>; callId: string }
  | { type: 'photon:set-state'; state: any }
  | { type: 'photon:follow-up'; message: string };

// ════════════════════════════════════════════════════════════════════════════════
// CLIENT IMPLEMENTATION (runs inside iframe)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create the PhotonBridge instance for use in custom UI iframes.
 * This is injected as window.photon by the PhotonBridgeLoader script.
 */
export function createPhotonBridge(): PhotonBridge {
  // Event listeners
  const progressListeners: Array<(event: ProgressEvent) => void> = [];
  const statusListeners: Array<(event: StatusEvent) => void> = [];
  const streamListeners: Array<(event: StreamEvent) => void> = [];
  const emitListeners: Array<(event: EmitEvent) => void> = [];
  const resultListeners: Array<(result: any) => void> = [];
  const errorListeners: Array<(error: { message: string }) => void> = [];

  let elicitationHandler: ((ask: AskEvent) => Promise<any>) | null = null;

  // State
  let _toolInput: Record<string, any> = {};
  let _toolOutput: any = null;
  let _widgetState: any = {};
  let _context: PhotonContext = {
    theme: 'dark',
    locale: 'en-US',
    photon: '',
    method: '',
  };

  // Check if running in ChatGPT
  const isChatGPT = typeof (window as any).openai !== 'undefined';

  // Message handler
  function handleMessage(event: any) {
    const msg = event.data as HostToUIMessage;
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('photon:')) return;

    switch (msg.type) {
      case 'photon:init':
        _toolInput = msg.toolInput;
        _context = msg.context;
        break;

      case 'photon:emit':
        const emitEvent = msg.event;
        emitListeners.forEach((cb) => cb(emitEvent));

        if (emitEvent.emit === 'progress') {
          progressListeners.forEach((cb) => cb(emitEvent as ProgressEvent));
        } else if (emitEvent.emit === 'status') {
          statusListeners.forEach((cb) => cb(emitEvent as StatusEvent));
        } else if (emitEvent.emit === 'stream') {
          streamListeners.forEach((cb) => cb(emitEvent as StreamEvent));
        }
        break;

      case 'photon:ask':
        if (elicitationHandler) {
          elicitationHandler(msg.event).then((value) => {
            window.parent.postMessage(
              {
                type: 'photon:ask-response',
                id: msg.id,
                value,
              } as UIToHostMessage,
              '*'
            );
          });
        }
        break;

      case 'photon:result':
        _toolOutput = msg.data;
        resultListeners.forEach((cb) => cb(msg.data));
        break;

      case 'photon:error':
        errorListeners.forEach((cb) => cb(msg.error));
        break;

      case 'photon:context':
        _context = { ..._context, ...msg.context };
        break;
    }
  }

  window.addEventListener('message', handleMessage);

  // Notify host that bridge is ready
  window.parent.postMessage({ type: 'photon:ready' } as UIToHostMessage, '*');

  // Helper to create unsubscribe function
  function subscribe<T>(listeners: T[], callback: T): () => void {
    listeners.push(callback);
    return () => {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  return {
    // Data access
    get toolInput() {
      return _toolInput;
    },
    get toolOutput() {
      return _toolOutput;
    },
    get widgetState() {
      return _widgetState;
    },
    setWidgetState(state: any) {
      _widgetState = state;
      window.parent.postMessage(
        {
          type: 'photon:set-state',
          state,
        } as UIToHostMessage,
        '*'
      );
    },

    // Event subscriptions
    onProgress: (cb) => subscribe(progressListeners, cb),
    onStatus: (cb) => subscribe(statusListeners, cb),
    onStream: (cb) => subscribe(streamListeners, cb),
    onEmit: (cb) => subscribe(emitListeners, cb),
    onResult: (cb) => subscribe(resultListeners, cb),
    onError: (cb) => subscribe(errorListeners, cb),

    onElicitation(handler) {
      elicitationHandler = handler;
      return () => {
        elicitationHandler = null;
      };
    },

    // Actions
    async callTool(toolName, args) {
      const callId = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        // Listen for response
        function handleResponse(event: any) {
          const msg = event.data;
          if (msg?.type === 'photon:call-tool-response' && msg.callId === callId) {
            window.removeEventListener('message', handleResponse);
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result);
          }
        }
        window.addEventListener('message', handleResponse);

        window.parent.postMessage(
          {
            type: 'photon:call-tool',
            toolName,
            args,
            callId,
          } as UIToHostMessage,
          '*'
        );
      });
    },

    // Alias for callTool - used by custom UI templates
    async invoke(toolName, args) {
      return this.callTool(toolName, args);
    },

    async sendFollowUpMessage(message) {
      window.parent.postMessage(
        {
          type: 'photon:follow-up',
          message,
        } as UIToHostMessage,
        '*'
      );
    },

    // Context
    get theme() {
      return _context.theme;
    },
    get locale() {
      return _context.locale;
    },
    get photon() {
      return _context.photon;
    },
    get method() {
      return _context.method;
    },
    get isChatGPT() {
      return isChatGPT;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// LOADER SCRIPT (injected into custom UI HTML)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate the script that should be injected into custom UI HTML.
 * This creates window.photon with the full bridge API.
 */
export function generateBridgeLoaderScript(): string {
  // Minified version of createPhotonBridge for injection
  return `
<script>
(function() {
  var pL = [], sL = [], strL = [], eL = [], rL = [], errL = [], eH = null;
  var tI = {}, tO = null, wS = {}, ctx = { theme: 'dark', locale: 'en-US', photon: '', method: '' };

  function sub(arr, cb) { arr.push(cb); return function() { var i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); }; }

  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m.type !== 'string' || m.type.indexOf('photon:') !== 0) return;

    if (m.type === 'photon:init') { tI = m.toolInput; ctx = m.context; }
    else if (m.type === 'photon:emit') {
      var ev = m.event;
      eL.forEach(function(cb) { cb(ev); });
      if (ev.emit === 'progress') pL.forEach(function(cb) { cb(ev); });
      else if (ev.emit === 'status') sL.forEach(function(cb) { cb(ev); });
      else if (ev.emit === 'stream') strL.forEach(function(cb) { cb(ev); });
    }
    else if (m.type === 'photon:ask' && eH) {
      eH(m.event).then(function(v) {
        window.parent.postMessage({ type: 'photon:ask-response', id: m.id, value: v }, '*');
      });
    }
    else if (m.type === 'photon:result') { tO = m.data; rL.forEach(function(cb) { cb(m.data); }); }
    else if (m.type === 'photon:error') { errL.forEach(function(cb) { cb(m.error); }); }
    else if (m.type === 'photon:context') { Object.assign(ctx, m.context); }
  });

  window.parent.postMessage({ type: 'photon:ready' }, '*');

  window.photon = {
    get toolInput() { return tI; },
    get toolOutput() { return tO; },
    get widgetState() { return wS; },
    setWidgetState: function(s) { wS = s; window.parent.postMessage({ type: 'photon:set-state', state: s }, '*'); },
    onProgress: function(cb) { return sub(pL, cb); },
    onStatus: function(cb) { return sub(sL, cb); },
    onStream: function(cb) { return sub(strL, cb); },
    onEmit: function(cb) { return sub(eL, cb); },
    onResult: function(cb) { return sub(rL, cb); },
    onError: function(cb) { return sub(errL, cb); },
    onElicitation: function(h) { eH = h; return function() { eH = null; }; },
    callTool: function(name, args) {
      var id = Math.random().toString(36).slice(2);
      return new Promise(function(res, rej) {
        function h(e) {
          var m = e.data;
          if (m && m.type === 'photon:call-tool-response' && m.callId === id) {
            window.removeEventListener('message', h);
            if (m.error) rej(new Error(m.error)); else res(m.result);
          }
        }
        window.addEventListener('message', h);
        window.parent.postMessage({ type: 'photon:call-tool', toolName: name, args: args, callId: id }, '*');
      });
    },
    invoke: function(name, args) { return this.callTool(name, args); },
    sendFollowUpMessage: function(msg) {
      window.parent.postMessage({ type: 'photon:follow-up', message: msg }, '*');
    },
    get theme() { return ctx.theme; },
    get locale() { return ctx.locale; },
    get photon() { return ctx.photon; },
    get method() { return ctx.method; },
    get isChatGPT() { return typeof window.openai !== 'undefined'; }
  };
})();
</script>`;
}
