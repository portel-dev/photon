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

import { getThemeTokens, type ThemeMode } from './design-system/tokens.js';
import type { PlatformContext } from '@portel/photon-core';

// Re-export MCP Apps standard types and helpers from core
export {
  type McpAppsInitialize,
  type McpAppsToolInput,
  type McpAppsToolResult,
  type McpAppsHostContextChanged,
  type McpAppsResourceTeardown,
  type McpAppsModelContextUpdate,
  type PlatformContext,
  createMcpAppsInitialize,
  createThemeChangeMessages,
} from '@portel/photon-core';

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
    toolInputPartial: [],
    toolInput: [],
    result: [],
    error: [],
    themeChange: []
  };
  var elicitationHandler = null;
  var teardownHandler = null;

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
    // Security: validate message origin (allow same-origin, parent, or null for sandboxed iframes)
    if (e.origin !== window.location.origin && e.origin !== 'null' && e.source !== window.parent) {
      return;
    }
    var m = e.data;
    if (!m || typeof m !== 'object') return;

    // ─────────────────────────────────────────────────────────────────────────
    // MCP Apps Extension (JSON-RPC 2.0)
    // ─────────────────────────────────────────────────────────────────────────

    // Helper to extract data from MCP result format
    function extractMcpResultData(result) {
      if (!result) return result;
      // Prefer structuredContent if available
      if (result.structuredContent) return result.structuredContent;
      // Extract from content array
      if (Array.isArray(result.content)) {
        var textItem = result.content.find(function(item) { return item.type === 'text'; });
        if (textItem && textItem.text) {
          try { return JSON.parse(textItem.text); } catch (e) { return textItem.text; }
        }
      }
      return result;
    }

    if (m.jsonrpc === '2.0') {
      // JSON-RPC response (from tools/call) - has id but no method
      if (m.id && !m.method) {
        var pending = pendingCalls[m.id];
        if (pending) {
          delete pendingCalls[m.id];
          if (m.error) {
            pending.reject(new Error(m.error.message || 'Tool call failed'));
          } else if (m.result && m.result.isError) {
            // Tool returned an error (isError flag in MCP result)
            var errorData = extractMcpResultData(m.result);
            var errorMsg = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
            pending.reject(new Error(errorMsg || 'Tool returned an error'));
          } else {
            pending.resolve(extractMcpResultData(m.result));
          }
        }
        return;
      }
      if (m.method === 'ui/initialize') {
        // Standard: hostContext.styles.variables; Legacy: params.theme
        var initTokens = (m.params.hostContext && m.params.hostContext.styles && m.params.hostContext.styles.variables) || m.params.theme;
        if (initTokens) themeTokens = initTokens;
        // Extract theme name from hostContext or fall back
        if (m.params.hostContext && m.params.hostContext.theme) ctx.theme = m.params.hostContext.theme;
        applyThemeTokens();
      }
      else if (m.method === 'ui/notifications/tool-input-partial') {
        listeners.toolInputPartial.forEach(function(cb) { cb(m.params); });
      }
      else if (m.method === 'ui/notifications/tool-input') {
        toolInput = m.params.input || {};
        listeners.toolInput.forEach(function(cb) { cb(m.params); });
      }
      else if (m.method === 'ui/notifications/tool-result') {
        toolOutput = m.params.result;
        // Set __PHOTON_DATA__ and fire photon:data-ready for apps that rely on
        // these patterns (e.g. kanban board.html reads initial data this way)
        window.__PHOTON_DATA__ = m.params.result;
        window.dispatchEvent(new CustomEvent('photon:data-ready', { detail: m.params.result }));
        listeners.result.forEach(function(cb) { cb(m.params.result); });
      }
      else if (m.method === 'ui/resource-teardown' && m.id != null) {
        var teardownResult = teardownHandler ? teardownHandler() : undefined;
        var sendTeardownResponse = function() {
          postToHost({ jsonrpc: '2.0', id: m.id, result: {} });
        };
        if (teardownResult && typeof teardownResult.then === 'function') {
          teardownResult.then(sendTeardownResponse).catch(sendTeardownResponse);
        } else {
          sendTeardownResponse();
        }
      }
      else if (m.method === 'ui/notifications/context' || m.method === 'ui/notifications/host-context-changed') {
        // Standard spec: host-context-changed with styles.variables
        var ctxParams = m.params || {};
        if (ctxParams.styles && ctxParams.styles.variables) {
          themeTokens = ctxParams.styles.variables;
          applyThemeTokens();
        }
        if (ctxParams.theme) {
          ctx.theme = ctxParams.theme;
          applyThemeClass();
          listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
        }
        // Legacy: flat merge (sanitize to prevent prototype pollution)
        var safeParams = {};
        Object.keys(ctxParams).forEach(function(k) {
          if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
            safeParams[k] = ctxParams[k];
          }
        });
        Object.assign(ctx, safeParams);
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
      else if (m.type === 'photon:theme-change') {
        // Theme change from BEAM
        ctx.theme = m.theme || 'dark';
        // Update theme tokens if provided
        if (m.themeTokens) {
          themeTokens = m.themeTokens;
          applyThemeTokens();
        }
        applyThemeClass();
        listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
      }
      else if (m.type === 'photon:upload-file-response') {
        var pending = pendingCalls[m.callId];
        if (pending) {
          delete pendingCalls[m.callId];
          if (m.error) pending.reject(new Error(m.error));
          else pending.resolve({ fileId: m.fileId });
        }
      }
      else if (m.type === 'photon:get-file-url-response') {
        var pending = pendingCalls[m.callId];
        if (pending) {
          delete pendingCalls[m.callId];
          if (m.error) pending.reject(new Error(m.error));
          else pending.resolve(m.url);
        }
      }
      else if (m.type === 'photon:request-modal-response') {
        var pending = pendingCalls[m.callId];
        if (pending) {
          delete pendingCalls[m.callId];
          if (m.error) pending.reject(new Error(m.error));
          else pending.resolve(m.result);
        }
      }
      else if (m.type === 'photon:init-state') {
        // Restore persisted widget state from host
        if (m.state !== null && m.state !== undefined) {
          widgetState = m.state;
          // Dispatch event for apps listening to state changes
          window.dispatchEvent(new CustomEvent('photon:state-restored', { detail: m.state }));
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
    // Set safe area inset CSS variables
    var insets = ctx.safeAreaInsets || { top: 0, bottom: 0, left: 0, right: 0 };
    root.style.setProperty('--safe-area-inset-top', insets.top + 'px');
    root.style.setProperty('--safe-area-inset-bottom', insets.bottom + 'px');
    root.style.setProperty('--safe-area-inset-left', insets.left + 'px');
    root.style.setProperty('--safe-area-inset-right', insets.right + 'px');
    applyThemeClass();
  }

  function applyThemeClass() {
    document.documentElement.classList.remove('light', 'dark', 'light-theme');
    document.documentElement.classList.add(ctx.theme);

    // Define colors for each theme (must match design-system/tokens.ts)
    var lightBg = '#ffffff';
    var lightText = '#1a1a1a';
    var darkBg = '#0d0d0d';
    var darkText = '#e6e6e6';

    if (ctx.theme === 'light') {
      document.documentElement.classList.add('light-theme');
      document.documentElement.style.colorScheme = 'light';
      document.documentElement.style.backgroundColor = lightBg;
      if (document.body) {
        document.body.style.backgroundColor = lightBg;
        document.body.style.color = lightText;
      }
    } else {
      document.documentElement.style.colorScheme = 'dark';
      document.documentElement.style.backgroundColor = darkBg;
      if (document.body) {
        document.body.style.backgroundColor = darkBg;
        document.body.style.color = darkText;
      }
    }
    document.documentElement.setAttribute('data-theme', ctx.theme);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CALL TOOL HELPER
  // ══════════════════════════════════════════════════════════════════════════

  function callTool(name, args) {
    var callId = generateCallId();
    return new Promise(function(resolve, reject) {
      pendingCalls[callId] = { resolve: resolve, reject: reject };

      // MCP Apps standard: JSON-RPC tools/call
      postToHost({
        jsonrpc: '2.0',
        id: callId,
        method: 'tools/call',
        params: { name: name, arguments: args || {} }
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
    onToolInputPartial: function(cb) { return subscribe(listeners.toolInputPartial, cb); },
    onToolInput: function(cb) { return subscribe(listeners.toolInput, cb); },
    onElicitation: function(h) { elicitationHandler = h; return function() { elicitationHandler = null; }; },
    onTeardown: function(h) { teardownHandler = h; return function() { teardownHandler = null; }; },

    updateModelContext: function(opts) {
      var callId = generateCallId();
      return new Promise(function(resolve, reject) {
        pendingCalls[callId] = { resolve: resolve, reject: reject };
        postToHost({
          jsonrpc: '2.0',
          id: callId,
          method: 'ui/update-model-context',
          params: { content: opts.content, structuredContent: opts.structuredContent }
        });
        setTimeout(function() {
          if (pendingCalls[callId]) {
            delete pendingCalls[callId];
            reject(new Error('Model context update timeout'));
          }
        }, 10000);
      });
    },

    get safeAreaInsets() {
      return ctx.safeAreaInsets || { top: 0, bottom: 0, left: 0, right: 0 };
    },

    callTool: callTool,
    invoke: callTool, // Alias for callTool - used by custom UI templates
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
      var callId = generateCallId();
      return new Promise(function(resolve, reject) {
        pendingCalls[callId] = { resolve: resolve, reject: reject };

        // Read file as base64
        var reader = new FileReader();
        reader.onload = function() {
          var base64 = reader.result;
          postToHost({
            type: 'photon:upload-file',
            callId: callId,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            data: base64
          });
        };
        reader.onerror = function() {
          delete pendingCalls[callId];
          reject(new Error('Failed to read file'));
        };
        reader.readAsDataURL(file);

        // Timeout after 60s
        setTimeout(function() {
          if (pendingCalls[callId]) {
            delete pendingCalls[callId];
            reject(new Error('File upload timeout'));
          }
        }, 60000);
      });
    },

    getFileDownloadUrl: function(opts) {
      var callId = generateCallId();
      return new Promise(function(resolve, reject) {
        pendingCalls[callId] = { resolve: resolve, reject: reject };

        postToHost({
          type: 'photon:get-file-url',
          callId: callId,
          fileId: opts.fileId
        });

        // Timeout after 30s
        setTimeout(function() {
          if (pendingCalls[callId]) {
            delete pendingCalls[callId];
            reject(new Error('Get file URL timeout'));
          }
        }, 30000);
      });
    },

    requestDisplayMode: function(mode) {
      postToHost({ type: 'photon:request-display-mode', mode: mode });
      return Promise.resolve();
    },

    requestModal: function(opts) {
      var callId = generateCallId();
      return new Promise(function(resolve, reject) {
        pendingCalls[callId] = { resolve: resolve, reject: reject };

        postToHost({
          type: 'photon:request-modal',
          callId: callId,
          template: opts.template,
          params: opts.params
        });

        // Timeout after 5 minutes (modals may take user input)
        setTimeout(function() {
          if (pendingCalls[callId]) {
            delete pendingCalls[callId];
            reject(new Error('Modal request timeout'));
          }
        }, 300000);
      });
    },

    notifyIntrinsicHeight: function(height) {
      postToHost({ type: 'photon:notify-height', height: height });
    },

    openExternal: function(opts) {
      window.open(opts.href, '_blank', 'noopener,noreferrer');
    },

    setOpenInAppUrl: function(opts) {
      postToHost({ type: 'photon:set-open-in-app-url', href: opts.href });
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

  // Notify host that bridge is ready (Photon/BEAM protocol)
  postToHost({ type: 'photon:ready' });

  // Request persisted state from host
  postToHost({ type: 'photon:get-state' });

  // MCP Apps Extension: Send ui/initialize REQUEST and handle response
  // This is the official handshake required by Claude Desktop and other MCP Apps hosts
  var initCallId = generateCallId();
  pendingCalls[initCallId] = {
    resolve: function(result) {
      // Store host context from response
      if (result.hostContext) {
        Object.assign(ctx, result.hostContext);
        if (result.hostContext.theme) ctx.theme = result.hostContext.theme;
        if (result.hostContext.styles && result.hostContext.styles.variables) {
          themeTokens = result.hostContext.styles.variables;
        }
        applyThemeTokens();
      }
      // Send ui/notifications/initialized to complete handshake
      postToHost({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
        params: {}
      });
    },
    reject: function(err) {
      console.error('MCP Apps init failed:', err);
    }
  };

  postToHost({
    jsonrpc: '2.0',
    id: initCallId,
    method: 'ui/initialize',
    params: {
      appInfo: { name: ctx.photon || 'photon-app', version: '1.0.0' },
      appCapabilities: {},
      protocolVersion: '2026-01-26'
    }
  });

})();
</script>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// HOST-SIDE HELPERS
// ════════════════════════════════════════════════════════════════════════════════
