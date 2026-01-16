/**
 * Platform Compatibility Layer
 *
 * Provides universal compatibility for custom UIs across:
 * - MCP Apps Extension (SEP-1865) - Standard ui/initialize protocol
 * - ChatGPT Apps SDK - window.openai API
 * - Claude Artifacts - postMessage with theme class
 *
 * BEAM injects all these APIs so apps built for any platform work without modification.
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865
 * @see https://developers.openai.com/apps-sdk/reference/
 * @see https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts
 */

import { getThemeTokens, type ThemeMode } from './design-system/tokens';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES - MCP Apps Extension (SEP-1865)
// ════════════════════════════════════════════════════════════════════════════════

export interface McpAppsInitialize {
  jsonrpc: '2.0';
  method: 'ui/initialize';
  params: {
    hostContext: {
      name: string;
      version: string;
    };
    hostCapabilities: {
      toolCalling: boolean;
      resourceReading: boolean;
      elicitation: boolean;
    };
    containerDimensions: {
      mode: 'fixed' | 'responsive' | 'auto';
      width?: number;
      height?: number;
    };
    theme: Record<string, string>;  // CSS variables
  };
}

export interface McpAppsToolInput {
  jsonrpc: '2.0';
  method: 'ui/notifications/tool-input';
  params: {
    toolName: string;
    input: Record<string, unknown>;
  };
}

export interface McpAppsToolResult {
  jsonrpc: '2.0';
  method: 'ui/notifications/tool-result';
  params: {
    toolName: string;
    result: unknown;
    isError: boolean;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// TYPES - OpenAI Apps SDK
// ════════════════════════════════════════════════════════════════════════════════

export interface OpenAiContext {
  theme: 'light' | 'dark';
  displayMode: 'inline' | 'fullscreen' | 'pip';
  locale: string;
  maxHeight: number;
  safeArea: { top: number; bottom: number; left: number; right: number };
  view: 'widget' | 'modal';
  userAgent: string;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
  widgetState: unknown;
}

export interface OpenAiApi {
  // Context properties
  theme: 'light' | 'dark';
  displayMode: 'inline' | 'fullscreen' | 'pip';
  locale: string;
  maxHeight: number;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
  widgetState: unknown;

  // Methods
  setWidgetState(state: unknown): void;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  sendFollowUpMessage(options: { prompt: string }): Promise<void>;
  uploadFile(file: File): Promise<{ fileId: string }>;
  getFileDownloadUrl(options: { fileId: string }): Promise<string>;
  requestDisplayMode(mode: 'inline' | 'fullscreen' | 'pip'): Promise<void>;
  requestModal(options: { params: unknown; template: string }): Promise<void>;
  notifyIntrinsicHeight(height: number): void;
  openExternal(options: { href: string }): void;
  setOpenInAppUrl(options: { href: string }): void;
}

// ════════════════════════════════════════════════════════════════════════════════
// TYPES - Platform Bridge Context
// ════════════════════════════════════════════════════════════════════════════════

export interface PlatformContext {
  theme: 'light' | 'dark';
  locale: string;
  displayMode: 'inline' | 'fullscreen' | 'modal';
  photon: string;
  method: string;
  hostName: string;
  hostVersion: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// PLATFORM BRIDGE SCRIPT GENERATOR
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate the script that injects all platform APIs into an iframe.
 * This enables apps built for ChatGPT, Claude, or MCP Apps to work in BEAM.
 */
export function generatePlatformBridgeScript(context: PlatformContext): string {
  const themeTokens = getThemeTokens(context.theme);
  const themeTokensJson = JSON.stringify(themeTokens);
  const contextJson = JSON.stringify(context);

  return `
<script>
(function() {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED STATE
  // ══════════════════════════════════════════════════════════════════════════

  var ctx = ${contextJson};
  var themeTokens = ${themeTokensJson};
  var toolInput = {};
  var toolOutput = null;
  var widgetState = {};
  var pendingCalls = {};
  var callIdCounter = 0;

  // Event listeners
  var listeners = {
    progress: [],
    status: [],
    stream: [],
    emit: [],
    result: [],
    error: [],
    themeChange: []
  };
  var elicitationHandler = null;

  function subscribe(arr, cb) {
    arr.push(cb);
    return function() { var i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); };
  }

  function postToHost(msg) {
    window.parent.postMessage(msg, '*');
  }

  function generateCallId() {
    return 'call_' + (++callIdCounter) + '_' + Math.random().toString(36).slice(2);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLER (receives from host)
  // ══════════════════════════════════════════════════════════════════════════

  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;

    // ─────────────────────────────────────────────────────────────────────────
    // MCP Apps Extension (JSON-RPC 2.0)
    // ─────────────────────────────────────────────────────────────────────────
    if (m.jsonrpc === '2.0') {
      if (m.method === 'ui/initialize') {
        ctx.theme = m.params.theme ? 'dark' : 'dark'; // Extract from tokens
        themeTokens = m.params.theme || themeTokens;
        applyThemeTokens();
      }
      else if (m.method === 'ui/notifications/tool-input') {
        toolInput = m.params.input || {};
      }
      else if (m.method === 'ui/notifications/tool-result') {
        toolOutput = m.params.result;
        listeners.result.forEach(function(cb) { cb(m.params.result); });
      }
      else if (m.method === 'ui/notifications/context') {
        Object.assign(ctx, m.params);
        if (m.params.theme) {
          listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Photon Bridge Protocol (internal)
    // ─────────────────────────────────────────────────────────────────────────
    if (typeof m.type === 'string' && m.type.indexOf('photon:') === 0) {
      if (m.type === 'photon:init') {
        toolInput = m.toolInput || {};
        Object.assign(ctx, m.context);
        themeTokens = m.themeTokens || themeTokens;
        applyThemeTokens();
      }
      else if (m.type === 'photon:emit') {
        var ev = m.event;
        listeners.emit.forEach(function(cb) { cb(ev); });
        if (ev.emit === 'progress') listeners.progress.forEach(function(cb) { cb(ev); });
        else if (ev.emit === 'status') listeners.status.forEach(function(cb) { cb(ev); });
        else if (ev.emit === 'stream') listeners.stream.forEach(function(cb) { cb(ev); });
      }
      else if (m.type === 'photon:ask' && elicitationHandler) {
        elicitationHandler(m.event).then(function(v) {
          postToHost({ type: 'photon:ask-response', id: m.id, value: v });
        });
      }
      else if (m.type === 'photon:result') {
        toolOutput = m.data;
        listeners.result.forEach(function(cb) { cb(m.data); });
      }
      else if (m.type === 'photon:error') {
        listeners.error.forEach(function(cb) { cb(m.error); });
      }
      else if (m.type === 'photon:context') {
        Object.assign(ctx, m.context);
        if (m.themeTokens) {
          themeTokens = m.themeTokens;
          applyThemeTokens();
        }
        if (m.context.theme) {
          listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
        }
      }
      else if (m.type === 'photon:call-tool-response') {
        var pending = pendingCalls[m.callId];
        if (pending) {
          delete pendingCalls[m.callId];
          if (m.error) pending.reject(new Error(m.error));
          else pending.resolve(m.result);
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claude Artifacts Protocol (simple postMessage)
    // ─────────────────────────────────────────────────────────────────────────
    if (m.type === 'theme') {
      ctx.theme = m.theme || 'dark';
      applyThemeClass();
      listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OpenAI set_globals event
    // ─────────────────────────────────────────────────────────────────────────
    if (m.type === 'openai:set_globals') {
      if (m.theme) ctx.theme = m.theme;
      if (m.toolInput) toolInput = m.toolInput;
      if (m.toolOutput) toolOutput = m.toolOutput;
      if (m.widgetState) widgetState = m.widgetState;
      applyThemeClass();
      listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // THEME APPLICATION
  // ══════════════════════════════════════════════════════════════════════════

  function applyThemeTokens() {
    var root = document.documentElement;
    for (var key in themeTokens) {
      root.style.setProperty(key, themeTokens[key]);
    }
    applyThemeClass();
  }

  function applyThemeClass() {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(ctx.theme);
    document.documentElement.setAttribute('data-theme', ctx.theme);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CALL TOOL HELPER
  // ══════════════════════════════════════════════════════════════════════════

  function callTool(name, args) {
    var callId = generateCallId();
    return new Promise(function(resolve, reject) {
      pendingCalls[callId] = { resolve: resolve, reject: reject };

      // Send via Photon protocol
      postToHost({
        type: 'photon:call-tool',
        toolName: name,
        args: args,
        callId: callId
      });

      // Timeout after 30s
      setTimeout(function() {
        if (pendingCalls[callId]) {
          delete pendingCalls[callId];
          reject(new Error('Tool call timeout'));
        }
      }, 30000);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. WINDOW.PHOTON - Photon Bridge API
  // ══════════════════════════════════════════════════════════════════════════

  window.photon = {
    get toolInput() { return toolInput; },
    get toolOutput() { return toolOutput; },
    get widgetState() { return widgetState; },
    setWidgetState: function(s) {
      widgetState = s;
      postToHost({ type: 'photon:set-state', state: s });
    },

    onProgress: function(cb) { return subscribe(listeners.progress, cb); },
    onStatus: function(cb) { return subscribe(listeners.status, cb); },
    onStream: function(cb) { return subscribe(listeners.stream, cb); },
    onEmit: function(cb) { return subscribe(listeners.emit, cb); },
    onResult: function(cb) { return subscribe(listeners.result, cb); },
    onError: function(cb) { return subscribe(listeners.error, cb); },
    onThemeChange: function(cb) { return subscribe(listeners.themeChange, cb); },
    onElicitation: function(h) { elicitationHandler = h; return function() { elicitationHandler = null; }; },

    callTool: callTool,
    sendFollowUpMessage: function(msg) {
      postToHost({ type: 'photon:follow-up', message: msg });
    },

    get theme() { return ctx.theme; },
    get locale() { return ctx.locale; },
    get photon() { return ctx.photon; },
    get method() { return ctx.method; },
    get isChatGPT() { return typeof window.openai !== 'undefined'; }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 2. WINDOW.OPENAI - ChatGPT Apps SDK Compatibility
  // ══════════════════════════════════════════════════════════════════════════

  window.openai = {
    // Context properties (reactive via openai:set_globals)
    get theme() { return ctx.theme; },
    get displayMode() { return ctx.displayMode === 'fullscreen' ? 'fullscreen' : 'inline'; },
    get locale() { return ctx.locale; },
    get maxHeight() { return 600; },
    get toolInput() { return toolInput; },
    get toolOutput() { return toolOutput; },
    get widgetState() { return widgetState; },
    get toolResponseMetadata() { return {}; },

    // Methods
    setWidgetState: function(state) {
      widgetState = state;
      postToHost({ type: 'photon:set-state', state: state });
    },

    callTool: callTool,

    sendFollowUpMessage: function(opts) {
      postToHost({ type: 'photon:follow-up', message: opts.prompt });
      return Promise.resolve();
    },

    uploadFile: function(file) {
      console.warn('[BEAM] uploadFile not implemented');
      return Promise.reject(new Error('Not implemented in BEAM'));
    },

    getFileDownloadUrl: function(opts) {
      console.warn('[BEAM] getFileDownloadUrl not implemented');
      return Promise.reject(new Error('Not implemented in BEAM'));
    },

    requestDisplayMode: function(mode) {
      postToHost({ type: 'photon:request-display-mode', mode: mode });
      return Promise.resolve();
    },

    requestModal: function(opts) {
      console.warn('[BEAM] requestModal not implemented');
      return Promise.reject(new Error('Not implemented in BEAM'));
    },

    notifyIntrinsicHeight: function(height) {
      postToHost({ type: 'photon:notify-height', height: height });
    },

    openExternal: function(opts) {
      window.open(opts.href, '_blank', 'noopener,noreferrer');
    },

    setOpenInAppUrl: function(opts) {
      console.warn('[BEAM] setOpenInAppUrl not implemented');
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 3. WINDOW.MCP - Generic MCP Bridge (superset)
  // ══════════════════════════════════════════════════════════════════════════

  window.mcp = {
    // Inherits from photon
    ...window.photon,

    // Additional MCP-specific context
    get hostName() { return ctx.hostName; },
    get hostVersion() { return ctx.hostVersion; },

    // MCP Apps Extension methods
    requestToolCall: callTool,

    // Read a resource
    readResource: function(uri) {
      return callTool('resources/read', { uri: uri });
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 4. OPENAI GLOBAL HOOK - useOpenAiGlobal compatibility
  // ══════════════════════════════════════════════════════════════════════════

  // Dispatch custom event for useOpenAiGlobal hook subscribers
  function dispatchGlobalsEvent() {
    window.dispatchEvent(new CustomEvent('openai:set_globals', {
      detail: {
        theme: ctx.theme,
        displayMode: ctx.displayMode,
        locale: ctx.locale,
        toolInput: toolInput,
        toolOutput: toolOutput,
        widgetState: widgetState
      }
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════════════════

  // Apply initial theme
  applyThemeTokens();

  // Notify host that bridge is ready
  postToHost({ type: 'photon:ready' });

  // Also send MCP Apps ready (JSON-RPC style)
  postToHost({
    jsonrpc: '2.0',
    method: 'ui/ready',
    params: {}
  });

})();
</script>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// HOST-SIDE HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create the MCP Apps ui/initialize message to send to an iframe
 */
export function createMcpAppsInitialize(
  context: PlatformContext,
  dimensions: { width: number; height: number }
): McpAppsInitialize {
  return {
    jsonrpc: '2.0',
    method: 'ui/initialize',
    params: {
      hostContext: {
        name: context.hostName,
        version: context.hostVersion,
      },
      hostCapabilities: {
        toolCalling: true,
        resourceReading: true,
        elicitation: true,
      },
      containerDimensions: {
        mode: 'responsive',
        width: dimensions.width,
        height: dimensions.height,
      },
      theme: getThemeTokens(context.theme),
    },
  };
}

/**
 * Create a theme change notification for all platforms
 */
export function createThemeChangeMessages(theme: 'light' | 'dark'): unknown[] {
  const themeTokens = getThemeTokens(theme);

  return [
    // MCP Apps Extension
    {
      jsonrpc: '2.0',
      method: 'ui/notifications/context',
      params: { theme: themeTokens },
    },
    // Photon Bridge
    {
      type: 'photon:context',
      context: { theme },
      themeTokens,
    },
    // Claude Artifacts
    {
      type: 'theme',
      theme,
    },
    // OpenAI Apps SDK
    {
      type: 'openai:set_globals',
      theme,
    },
  ];
}
