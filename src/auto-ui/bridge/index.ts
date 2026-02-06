/**
 * Unified UI Bridge Architecture
 *
 * Uses @modelcontextprotocol/ext-apps SDK as the foundation for ALL UI communication.
 * Beam becomes just another MCP Apps host.
 *
 * Key principle: No Beam-specific protocol layer. All features achieved via
 * MCP Apps Extension spec + custom JSON-RPC notifications that any host can implement.
 */
import type { PhotonBridgeContext, SizeConstraints } from './types.js';
import { getThemeTokens } from '../design-system/tokens.js';

// Re-export types (server-safe)
export type {
  PhotonBridgeContext,
  SizeConstraints,
  PhotonAPI,
  OpenAIAPI,
  ProgressNotification,
  StatusNotification,
  StreamNotification,
  EmitNotification,
  ChannelEventNotification,
} from './types.js';

// Note: PhotonApp and createOpenAIShim are browser-only code
// They are embedded in the generated bridge script, not exported for server use

/**
 * Generate the complete bridge script for injection into iframes
 *
 * This script provides:
 * - window.photon API (PhotonApp-based)
 * - window.openai API (compatibility shim)
 * - Automatic theme application
 * - MCP Apps protocol handshake
 */
export function generateBridgeScript(context: PhotonBridgeContext): string {
  // Get theme tokens for the specified theme (light or dark)
  const themeTokens = getThemeTokens(context.theme);
  const themeTokensJson = JSON.stringify(themeTokens);
  const contextJson = JSON.stringify(context);

  return `
<script>
(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED STATE
  // ═══════════════════════════════════════════════════════════════════════════

  var ctx = ${contextJson};
  var themeTokens = ${themeTokensJson};
  var toolInput = {};
  var toolOutput = null;
  var widgetState = {};
  var hostContext = null;
  var pendingCalls = {};
  var callIdCounter = 0;

  // Event listeners
  var listeners = {
    result: [],
    themeChange: [],
    progress: [],
    status: [],
    stream: [],
    emit: []
  };
  var eventListeners = {};  // For specific event subscriptions (e.g., 'taskMove')
  var photonEventListeners = {};  // Namespaced by photon name for injected photons
  var injectedPhotons = ctx.injectedPhotons || [];

  function subscribe(arr, cb) {
    arr.push(cb);
    return function() {
      var i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  function postToHost(msg) {
    window.parent.postMessage(msg, '*');
  }

  function generateCallId() {
    return 'call_' + (++callIdCounter) + '_' + Math.random().toString(36).slice(2);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA EXTRACTION (MCP result format -> clean data)
  // ═══════════════════════════════════════════════════════════════════════════

  function extractData(result) {
    if (!result) return result;
    if (result.structuredContent) return result.structuredContent;
    if (Array.isArray(result.content)) {
      var textItem = result.content.find(function(item) { return item.type === 'text'; });
      if (textItem && textItem.text) {
        try { return JSON.parse(textItem.text); } catch (e) { return textItem.text; }
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;

    // ─────────────────────────────────────────────────────────────────────────
    // JSON-RPC 2.0 (MCP Apps Extension protocol)
    // ─────────────────────────────────────────────────────────────────────────
    if (m.jsonrpc === '2.0') {
      // Response to our call (has id, no method)
      if (m.id && !m.method) {
        var pending = pendingCalls[m.id];
        if (pending) {
          delete pendingCalls[m.id];
          if (m.error) {
            pending.reject(new Error(m.error.message || 'Call failed'));
          } else if (m.result && m.result.isError) {
            var errorData = extractData(m.result);
            var errorMsg = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
            pending.reject(new Error(errorMsg || 'Tool returned an error'));
          } else {
            pending.resolve(extractData(m.result));
          }
        }
        return;
      }

      // Handle notifications and requests from host
      if (m.method === 'ui/initialize') {
        var params = m.params || {};
        hostContext = params.hostContext;
        if (params.hostContext) {
          if (params.hostContext.theme) ctx.theme = params.hostContext.theme;
          if (params.hostContext.styles && params.hostContext.styles.variables) {
            themeTokens = params.hostContext.styles.variables;
          }
        }
        applyThemeTokens();
        // Send initialized notification
        postToHost({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
      }
      else if (m.method === 'ui/notifications/tool-result') {
        toolOutput = extractData(m.params && m.params.result);
        listeners.result.forEach(function(cb) { cb(toolOutput); });
      }
      else if (m.method === 'ui/notifications/tool-input') {
        toolInput = (m.params && m.params.input) || {};
      }
      else if (m.method === 'ui/notifications/host-context-changed' || m.method === 'ui/notifications/context') {
        var ctxParams = m.params || {};
        // Standard theme/styles handling
        if (ctxParams.styles && ctxParams.styles.variables) {
          themeTokens = ctxParams.styles.variables;
          applyThemeTokens();
        }
        if (ctxParams.theme) {
          ctx.theme = ctxParams.theme;
          applyThemeClass();
          listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
        }

        // Extract embedded photon event data (for real-time sync)
        if (ctxParams._photon) {
          var photonData = ctxParams._photon;
          // Route to generic emit listeners
          listeners.emit.forEach(function(cb) { cb(photonData); });

          var eventName = photonData.event;
          var sourcePhoton = photonData.data && photonData.data._source;

          // Route to photon-specific listeners if _source is specified (injected photon events)
          if (sourcePhoton && photonEventListeners[sourcePhoton] && photonEventListeners[sourcePhoton][eventName]) {
            photonEventListeners[sourcePhoton][eventName].forEach(function(cb) {
              cb(photonData.data);
            });
          }

          // Also route to global event listeners (main photon events, or fallback)
          if (eventName && eventListeners[eventName]) {
            eventListeners[eventName].forEach(function(cb) {
              cb(photonData.data);
            });
          }
        }
      }
      else if (m.method === 'ui/resource-teardown' && m.id != null) {
        postToHost({ jsonrpc: '2.0', id: m.id, result: {} });
      }
      // Custom Photon notifications
      else if (m.method === 'photon/notifications/progress') {
        listeners.progress.forEach(function(cb) { cb(m.params); });
      }
      else if (m.method === 'photon/notifications/status') {
        listeners.status.forEach(function(cb) { cb(m.params); });
      }
      else if (m.method === 'photon/notifications/stream') {
        listeners.stream.forEach(function(cb) { cb(m.params); });
      }
      else if (m.method === 'photon/notifications/emit') {
        listeners.emit.forEach(function(cb) { cb(m.params); });
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy photon: messages (backward compatibility)
    // ─────────────────────────────────────────────────────────────────────────
    if (typeof m.type === 'string' && m.type.indexOf('photon:') === 0) {
      if (m.type === 'photon:result') {
        toolOutput = m.data;
        listeners.result.forEach(function(cb) { cb(m.data); });
      }
      else if (m.type === 'photon:theme-change') {
        ctx.theme = m.theme || 'dark';
        if (m.themeTokens) themeTokens = m.themeTokens;
        applyThemeTokens();
        applyThemeClass();
        listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
      }
      else if (m.type === 'photon:context') {
        Object.assign(ctx, m.context);
        if (m.themeTokens) {
          themeTokens = m.themeTokens;
          applyThemeTokens();
        }
        if (m.context && m.context.theme) {
          applyThemeClass();
          listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
        }
      }
      else if (m.type === 'photon:emit') {
        var ev = m.event;
        listeners.emit.forEach(function(cb) { cb(ev); });
        if (ev.emit === 'progress') listeners.progress.forEach(function(cb) { cb(ev); });
        else if (ev.emit === 'status') listeners.status.forEach(function(cb) { cb(ev); });
        else if (ev.emit === 'stream') listeners.stream.forEach(function(cb) { cb(ev); });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME APPLICATION
  // ═══════════════════════════════════════════════════════════════════════════

  function applyThemeTokens() {
    var root = document.documentElement;
    for (var key in themeTokens) {
      root.style.setProperty(key, themeTokens[key]);
    }
    applyThemeClass();
  }

  function applyThemeClass() {
    document.documentElement.classList.remove('light', 'dark', 'light-theme');
    document.documentElement.classList.add(ctx.theme);
    document.documentElement.style.colorScheme = ctx.theme;
    document.documentElement.setAttribute('data-theme', ctx.theme);

    var lightBg = '#ffffff';
    var lightText = '#1a1a1a';
    var darkBg = '#0d0d0d';
    var darkText = '#e6e6e6';

    if (ctx.theme === 'light') {
      document.documentElement.classList.add('light-theme');
      document.documentElement.style.backgroundColor = lightBg;
      if (document.body) {
        document.body.style.backgroundColor = lightBg;
        document.body.style.color = lightText;
      }
    } else {
      document.documentElement.style.backgroundColor = darkBg;
      if (document.body) {
        document.body.style.backgroundColor = darkBg;
        document.body.style.color = darkText;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL CALLING
  // ═══════════════════════════════════════════════════════════════════════════

  function callTool(name, args) {
    var callId = generateCallId();
    return new Promise(function(resolve, reject) {
      pendingCalls[callId] = { resolve: resolve, reject: reject };
      postToHost({
        jsonrpc: '2.0',
        id: callId,
        method: 'tools/call',
        params: { name: name, arguments: args || {} }
      });
      setTimeout(function() {
        if (pendingCalls[callId]) {
          delete pendingCalls[callId];
          reject(new Error('Tool call timeout'));
        }
      }, 30000);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIZE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  function parseSizeMeta() {
    var meta = document.querySelector('meta[name="mcp:ui-size"]');
    if (!meta) return {};
    var content = meta.getAttribute('content') || '';
    var constraints = {};
    var pairs = content.split(';');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (kv[0] && kv[1]) {
        var num = parseInt(kv[1], 10);
        if (!isNaN(num)) constraints[kv[0]] = num;
      }
    }
    return constraints;
  }

  function sendSizeChanged(size) {
    postToHost({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: size
    });
  }

  function setupAutoResize(element) {
    var target = element || document.body;
    var constraints = parseSizeMeta();
    var hostMax = hostContext && hostContext.containerDimensions;

    var observer = new ResizeObserver(function() {
      var width = target.scrollWidth;
      var height = target.scrollHeight;

      if (constraints.minWidth) width = Math.max(width, constraints.minWidth);
      if (constraints.minHeight) height = Math.max(height, constraints.minHeight);
      if (hostMax && hostMax.maxWidth) width = Math.min(width, hostMax.maxWidth);
      if (hostMax && hostMax.maxHeight) height = Math.min(height, hostMax.maxHeight);
      if (constraints.maxWidth) width = Math.min(width, constraints.maxWidth);
      if (constraints.maxHeight) height = Math.min(height, constraints.maxHeight);

      sendSizeChanged({ width: width, height: height });
    });

    observer.observe(target);
    return function() { observer.disconnect(); };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WINDOW.PHOTON API
  // ═══════════════════════════════════════════════════════════════════════════

  window.photon = {
    get toolOutput() { return toolOutput; },
    get toolInput() { return toolInput; },
    get widgetState() { return widgetState; },
    setWidgetState: function(s) {
      widgetState = s;
      postToHost({ type: 'photon:set-state', state: s });
    },

    onResult: function(cb) { return subscribe(listeners.result, cb); },
    onThemeChange: function(cb) { return subscribe(listeners.themeChange, cb); },
    onProgress: function(cb) { return subscribe(listeners.progress, cb); },
    onStatus: function(cb) { return subscribe(listeners.status, cb); },
    onStream: function(cb) { return subscribe(listeners.stream, cb); },
    onEmit: function(cb) { return subscribe(listeners.emit, cb); },

    invoke: callTool,
    callTool: callTool,

    get theme() { return ctx.theme; },
    get locale() { return ctx.locale || 'en-US'; },
    get photon() { return ctx.photon; },
    get method() { return ctx.method; },
    get hostContext() { return hostContext; },

    sendSizeChanged: sendSizeChanged,
    setupAutoResize: setupAutoResize,
    parseSizeMeta: parseSizeMeta,

    // Generic event subscription for real-time sync
    // Usage: photon.on('taskMove', function(data) { ... })
    on: function(eventName, cb) {
      if (!eventListeners[eventName]) eventListeners[eventName] = [];
      eventListeners[eventName].push(cb);
      return function() {
        var i = eventListeners[eventName].indexOf(cb);
        if (i >= 0) eventListeners[eventName].splice(i, 1);
      };
    },

    // Photon-specific event subscription (for injected photon events)
    // Usage: photon.onPhoton('notifications', 'alertCreated', function(data) { ... })
    onPhoton: function(photonName, eventName, cb) {
      if (!photonEventListeners[photonName]) photonEventListeners[photonName] = {};
      if (!photonEventListeners[photonName][eventName]) photonEventListeners[photonName][eventName] = [];
      photonEventListeners[photonName][eventName].push(cb);
      return function() {
        var i = photonEventListeners[photonName][eventName].indexOf(cb);
        if (i >= 0) photonEventListeners[photonName][eventName].splice(i, 1);
      };
    }
  };

  // Create direct window object: window.{photonName}
  // This provides a clean class-like API that mirrors server methods:
  //   Server: this.emit('taskMove', data)
  //   Client: kanban.onTaskMove(cb) - subscribe to events
  //   Client: kanban.taskMove(args) - call server method
  if (ctx.photon) {
    window[ctx.photon] = new Proxy({}, {
      get: function(target, prop) {
        if (typeof prop !== 'string') return undefined;

        // onEventName -> subscribe to 'eventName' event
        // e.g., onTaskMove -> subscribe to 'taskMove'
        if (prop.startsWith('on') && prop.length > 2) {
          var eventName = prop.charAt(2).toLowerCase() + prop.slice(3);
          return function(cb) {
            return window.photon.on(eventName, cb);
          };
        }

        // methodName -> call server tool
        // e.g., taskMove(args) -> photon.callTool(prop, args)
        return function(args) {
          return window.photon.callTool(prop, args);
        };
      }
    });
  }

  // Create proxies for injected photons (for event subscriptions)
  // e.g., notifications.onAlertCreated(cb) subscribes to 'alertCreated' from 'notifications' photon
  injectedPhotons.forEach(function(injectedName) {
    window[injectedName] = new Proxy({}, {
      get: function(target, prop) {
        if (typeof prop !== 'string') return undefined;

        // onEventName -> subscribe to photon-specific event
        if (prop.startsWith('on') && prop.length > 2) {
          var eventName = prop.charAt(2).toLowerCase() + prop.slice(3);
          return function(cb) {
            return window.photon.onPhoton(injectedName, eventName, cb);
          };
        }

        // Method calls on injected photons are not supported from client
        // (injected photon methods are only available server-side)
        return undefined;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WINDOW.OPENAI API (ChatGPT Apps SDK Compatibility)
  // ═══════════════════════════════════════════════════════════════════════════

  window.openai = {
    get theme() { return ctx.theme; },
    get displayMode() { return 'inline'; },
    get locale() { return ctx.locale || 'en-US'; },
    get maxHeight() { return 800; },
    get toolInput() { return toolInput; },
    get toolOutput() { return toolOutput; },
    get widgetState() { return widgetState; },
    get toolResponseMetadata() { return {}; },

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
      return Promise.reject(new Error('File upload not supported'));
    },
    getFileDownloadUrl: function(opts) {
      return Promise.reject(new Error('File download not supported'));
    },
    requestDisplayMode: function(mode) {
      return Promise.resolve();
    },
    requestModal: function(opts) {
      return Promise.reject(new Error('Modal not supported'));
    },
    notifyIntrinsicHeight: function(height) {
      sendSizeChanged({ height: height });
    },
    openExternal: function(opts) {
      window.open(opts.href, '_blank', 'noopener,noreferrer');
    },
    setOpenInAppUrl: function(opts) {}
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  // Apply initial theme
  applyThemeTokens();

  // Notify host that bridge is ready (legacy)
  postToHost({ type: 'photon:ready' });

  // MCP Apps Extension: Send ui/initialize REQUEST
  var initCallId = generateCallId();
  pendingCalls[initCallId] = {
    resolve: function(result) {
      if (result && result.hostContext) {
        hostContext = result.hostContext;
        if (result.hostContext.theme) ctx.theme = result.hostContext.theme;
        if (result.hostContext.styles && result.hostContext.styles.variables) {
          themeTokens = result.hostContext.styles.variables;
        }
        applyThemeTokens();
      }
      // Send initialized notification
      postToHost({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    },
    reject: function(err) {
      console.debug('MCP Apps init - no response (host may not support full protocol)');
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

  // Timeout for init - continue anyway if no response
  setTimeout(function() {
    if (pendingCalls[initCallId]) {
      delete pendingCalls[initCallId];
    }
  }, 5000);

})();
</script>`;
}

/**
 * Generate bridge script with legacy compatibility
 *
 * This is a drop-in replacement for generatePlatformBridgeScript from platform-compat.ts
 */
export function generatePlatformBridgeScript(context: {
  theme: 'light' | 'dark';
  locale?: string;
  displayMode?: string;
  photon?: string;
  method?: string;
  hostName?: string;
  hostVersion?: string;
  injectedPhotons?: string[];
}): string {
  return generateBridgeScript({
    theme: context.theme,
    locale: context.locale,
    photon: context.photon || '',
    method: context.method || '',
    hostName: context.hostName,
    hostVersion: context.hostVersion,
    injectedPhotons: context.injectedPhotons,
  });
}
