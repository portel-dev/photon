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
  BridgeMethodMeta,
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
        // Set __PHOTON_DATA__ and fire photon:data-ready for apps that rely on
        // these patterns (e.g. kanban board.html reads initial data this way)
        window.__PHOTON_DATA__ = toolOutput;
        window.dispatchEvent(new CustomEvent('photon:data-ready', { detail: toolOutput }));
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
        // Re-render data-method elements so renderers pick up new colors
        if (ctxParams.styles || ctxParams.theme) {
          setTimeout(function() {
            _boundElements.forEach(function(rerender) { rerender(); });
          }, 0);
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
        // Also dispatch to named event listeners (proxy.onResult uses photon.on('result', cb))
        if (eventListeners['result']) {
          eventListeners['result'].forEach(function(cb) { cb(m.data); });
        }
      }
      else if (m.type === 'photon:theme-change') {
        ctx.theme = m.theme || 'dark';
        if (m.themeTokens) themeTokens = m.themeTokens;
        applyThemeTokens();
        applyThemeClass();
        listeners.themeChange.forEach(function(cb) { cb(ctx.theme); });
        // Re-render all data-method bound elements so renderers pick up new colors
        setTimeout(function() {
          _boundElements.forEach(function(rerender) { rerender(); });
        }, 0);
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

    if (ctx.theme === 'light') {
      document.documentElement.classList.add('light-theme');
    }

    // Set bg/text from theme tokens so custom UIs using var(--bg) get the right values.
    // Use token values when available, fall back to sensible defaults.
    var bg = themeTokens['--bg'] || (ctx.theme === 'light' ? '#ffffff' : '#0d0d0d');
    var text = themeTokens['--text'] || (ctx.theme === 'light' ? '#1a1a1a' : '#e6e6e6');
    document.documentElement.style.backgroundColor = bg;
    if (document.body) {
      document.body.style.backgroundColor = bg;
      document.body.style.color = text;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL CALLING
  // ═══════════════════════════════════════════════════════════════════════════

  function callTool(name, args, options) {
    var callId = generateCallId();
    return new Promise(function(resolve, reject) {
      pendingCalls[callId] = { resolve: resolve, reject: reject };
      var callArgs = args || {};
      if (options && options.instance !== undefined) {
        callArgs = Object.assign({}, callArgs, { _targetInstance: options.instance });
      }
      // Auto-attach widgetState as _clientState so photon methods can see UI context
      if (widgetState && Object.keys(widgetState).length > 0) {
        callArgs = Object.assign({}, callArgs, { _clientState: widgetState });
      }
      postToHost({
        jsonrpc: '2.0',
        id: callId,
        method: 'tools/call',
        params: { name: name, arguments: callArgs }
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
    },

    // Render a QR code into a container element (convenience shortcut)
    // Usage: photon.renderQR(element, 'https://example.com', { size: 256 })
    renderQR: function(container, text, opts) {
      opts = opts || {};
      var size = opts.size || 256;
      if (!container || !text) return;
      container.innerHTML = '';

      // Load qrcode-generator on demand (once), with queuing to handle concurrent calls
      if (window._photonQR) {
        doRender();
      } else if (window._photonQRLoading) {
        // Script is still loading — queue this render
        window._photonQRQueue = window._photonQRQueue || [];
        window._photonQRQueue.push(doRender);
      } else {
        window._photonQRLoading = true;
        window._photonQRQueue = [doRender];
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
        script.onload = function() {
          window._photonQR = true;
          window._photonQRLoading = false;
          var queue = window._photonQRQueue || [];
          window._photonQRQueue = [];
          queue.forEach(function(fn) { fn(); });
        };
        script.onerror = function() {
          window._photonQRLoading = false;
          var queue = window._photonQRQueue || [];
          window._photonQRQueue = [];
          var fallback = '<pre style="font-size:9px;background:#fff;color:#000;padding:8px;border-radius:4px;word-break:break-all;max-width:300px;">' + text + '</pre>';
          // Fall back for the current container; other queued renders also get fallback
          container.innerHTML = fallback;
          queue.forEach(function(fn) {
            try { fn(); } catch(e) { /* already fell back */ }
          });
        };
        document.head.appendChild(script);
      }

      function doRender() {
        try {
          var qr = qrcode(0, opts.errorCorrection || 'L');
          qr.addData(text);
          qr.make();
          var cellSize = Math.max(1, Math.floor(size / (qr.getModuleCount() + 8)));
          container.innerHTML = qr.createSvgTag({ cellSize: cellSize, margin: 4 });
        } catch(e) {
          container.innerHTML = '<pre style="font-size:9px;background:#fff;color:#000;padding:8px;border-radius:4px;word-break:break-all;max-width:300px;">' + text + '</pre>';
        }
      }
    },

    // Render data in any auto UI format: table, chart:bar, gauge, metric, etc.
    // Usage: photon.render(container, data, 'chart:bar', { label: 'name', value: 'count' })
    // Accepts optional motion config: photon.render(el, data, 'table', { enter: 'scale-in', transition: 'matte:radial' })
    // Lazy-loads the renderer bundle on first call.
    render: function(container, data, format, opts) {
      if (!container) return;
      format = format || 'json';
      opts = opts || {};

      // Extract motion options
      var motionEnter = opts.enter;
      var motionTransition = opts.transition;

      function doRender() {
        // Capture existing content for matte transition
        var existingHTML = '';
        if (motionTransition && container.innerHTML.trim()) {
          existingHTML = container.innerHTML;
        }

        window._photonRenderers.render(container, data, format, opts);

        // Apply matte transition if there was previous content
        if (existingHTML && motionTransition) {
          var matteType = motionTransition.replace('matte:', '');
          var outgoing = document.createElement('div');
          outgoing.innerHTML = existingHTML;
          outgoing.style.position = 'absolute';
          outgoing.style.inset = '0';

          var incoming = document.createElement('div');
          while (container.firstChild) incoming.appendChild(container.firstChild);

          container.style.position = 'relative';
          container.appendChild(outgoing);
          container.appendChild(incoming);

          // Apply matte class
          if (matteType === 'radial' || matteType === 'diagonal') {
            incoming.classList.add('motion-matte-' + matteType);
          } else {
            incoming.classList.add('motion-matte-reveal');
            incoming.style.maskImage = "url('" + matteType + "')";
            incoming.style.webkitMaskImage = "url('" + matteType + "')";
          }

          // Clean up after animation
          incoming.addEventListener('animationend', function() {
            outgoing.remove();
            while (incoming.firstChild) container.appendChild(incoming.firstChild);
            incoming.remove();
            container.style.position = '';
          }, { once: true });
        } else if (motionEnter) {
          // Simple enter animation on the container
          container.classList.add('motion-' + motionEnter);
        }
      }

      if (window._photonRenderers) { doRender(); return; }

      // Lazy-load renderers script
      if (window._photonRenderersLoading) {
        // Queue this render call
        window._photonRenderersQueue = window._photonRenderersQueue || [];
        window._photonRenderersQueue.push(doRender);
        return;
      }
      window._photonRenderersLoading = true;
      window._photonRenderersQueue = [doRender];

      var s = document.createElement('script');
      var origin = '';
      try { origin = window.parent.location.origin; } catch(e) { origin = window.location.origin; }
      s.src = origin + '/api/photon-renderers.js';
      s.onload = function() {
        var queue = window._photonRenderersQueue || [];
        window._photonRenderersQueue = [];
        queue.forEach(function(fn) { fn(); });
      };
      s.onerror = function() {
        container.innerHTML = '<pre style="font-size:11px;color:#888;">' + JSON.stringify(data, null, 2) + '</pre>';
      };
      document.head.appendChild(s);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // MOTION API
    // Usage: photon.motion.enter(el, 'slide-up')
    //        photon.motion.exit(el, 'fade-out').then(() => console.log('removed'))
    //        photon.motion.stagger(container)
    //        photon.motion.depth(el, 'float')
    // ─────────────────────────────────────────────────────────────────────────
    motion: {
      enter: function(el, effect) {
        if (!el) return;
        effect = effect || 'fade-in';
        el.classList.add('motion-' + effect);
      },
      exit: function(el, effect) {
        if (!el) return Promise.resolve();
        effect = effect || 'fade-out';

        // Respect reduced motion
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          el.remove();
          return Promise.resolve();
        }

        el.classList.add('motion-' + effect);
        return new Promise(function(resolve) {
          function onEnd() {
            el.removeEventListener('animationend', onEnd);
            el.remove();
            resolve();
          }
          el.addEventListener('animationend', onEnd);
          // Safety timeout
          setTimeout(function() {
            if (el.parentElement) {
              el.removeEventListener('animationend', onEnd);
              el.remove();
              resolve();
            }
          }, 1000);
        });
      },
      stagger: function(container) {
        if (!container) return;
        container.classList.add('motion-stagger');
      },
      depth: function(el, preset) {
        if (!el) return;
        preset = preset || 'float';
        // Ensure parent has perspective
        var parent = el.parentElement;
        if (parent && !parent.classList.contains('motion-perspective')) {
          parent.classList.add('motion-perspective');
        }
        if (preset === 'tilt' || preset === 'tilt-right') {
          el.classList.add('motion-' + preset);
        } else {
          el.classList.add('motion-depth-' + preset);
        }
      }
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

  // ═══════════════════════════════════════════════════════════════════════════
  // MOTION STYLES INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function _injectMotionStyles() {
    var style = document.createElement('style');
    style.id = 'photon-motion';
    style.textContent = [
      '/* ═══ TIMING TOKENS ═══ */',
      ':root {',
      '  --motion-fast: 0.15s;',
      '  --motion-normal: 0.3s;',
      '  --motion-slow: 0.5s;',
      '  --motion-slower: 0.8s;',
      '  --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);',
      '  --motion-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);',
      '  --motion-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);',
      '}',
      '',
      '/* ═══ ENTER ANIMATIONS ═══ */',
      '@keyframes motion-fade-in { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes motion-slide-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }',
      '@keyframes motion-slide-down { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }',
      '@keyframes motion-slide-in-right { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }',
      '@keyframes motion-slide-in-left { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }',
      '@keyframes motion-scale-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }',
      '@keyframes motion-scale-up { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }',
      '@keyframes motion-flip-in { from { opacity: 0; transform: perspective(800px) rotateY(90deg); } to { opacity: 1; transform: perspective(800px) rotateY(0deg); } }',
      '@keyframes motion-drop-in { from { opacity: 0; transform: translateY(-40px) scale(0.95); } 60% { opacity: 1; transform: translateY(4px) scale(1.01); } to { opacity: 1; transform: translateY(0) scale(1); } }',
      '',
      '/* ═══ EXIT ANIMATIONS ═══ */',
      '@keyframes motion-fade-out { from { opacity: 1; } to { opacity: 0; } }',
      '@keyframes motion-slide-out-down { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(16px); } }',
      '@keyframes motion-scale-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.92); } }',
      '@keyframes motion-zoom-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.5); } }',
      '@keyframes motion-flip-out { from { opacity: 1; transform: perspective(800px) rotateY(0deg); } to { opacity: 0; transform: perspective(800px) rotateY(-90deg); } }',
      '',
      '/* ═══ PERSISTENT EFFECTS ═══ */',
      '@keyframes motion-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }',
      '@keyframes motion-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }',
      '@keyframes motion-glow { 0%, 100% { box-shadow: 0 0 0 0 var(--glow-primary, rgba(100, 180, 255, 0)); } 50% { box-shadow: 0 0 12px 2px var(--glow-primary, rgba(100, 180, 255, 0.3)); } }',
      '',
      '/* ═══ ENTER CLASSES ═══ */',
      '.motion-fade-in { animation: motion-fade-in var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-slide-up { animation: motion-slide-up var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-slide-down { animation: motion-slide-down var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-slide-in-right { animation: motion-slide-in-right var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-slide-in-left { animation: motion-slide-in-left var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-scale-in { animation: motion-scale-in var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-scale-up { animation: motion-scale-up var(--motion-normal) var(--motion-ease-spring) both; }',
      '.motion-flip-in { animation: motion-flip-in var(--motion-slow) var(--motion-ease-out) both; }',
      '.motion-drop-in { animation: motion-drop-in var(--motion-slow) var(--motion-ease-out) both; }',
      '',
      '/* ═══ EXIT CLASSES ═══ */',
      '.motion-fade-out { animation: motion-fade-out var(--motion-normal) var(--motion-ease-in-out) both; }',
      '.motion-slide-out-down { animation: motion-slide-out-down var(--motion-normal) var(--motion-ease-in-out) both; }',
      '.motion-scale-out { animation: motion-scale-out var(--motion-normal) var(--motion-ease-in-out) both; }',
      '.motion-zoom-out { animation: motion-zoom-out var(--motion-normal) var(--motion-ease-in-out) both; }',
      '.motion-flip-out { animation: motion-flip-out var(--motion-slow) var(--motion-ease-in-out) both; }',
      '',
      '/* ═══ PERSISTENT CLASSES ═══ */',
      '.motion-float { animation: motion-float 3s ease-in-out infinite; }',
      '.motion-pulse { animation: motion-pulse 2s ease-in-out infinite; }',
      '.motion-glow { animation: motion-glow 2s ease-in-out infinite; }',
      '',
      '/* ═══ STAGGER ═══ */',
      '.motion-stagger > * { animation: motion-slide-up var(--motion-normal) var(--motion-ease-out) both; }',
      '.motion-stagger > *:nth-child(1) { animation-delay: 0ms; }',
      '.motion-stagger > *:nth-child(2) { animation-delay: 50ms; }',
      '.motion-stagger > *:nth-child(3) { animation-delay: 100ms; }',
      '.motion-stagger > *:nth-child(4) { animation-delay: 150ms; }',
      '.motion-stagger > *:nth-child(5) { animation-delay: 200ms; }',
      '.motion-stagger > *:nth-child(6) { animation-delay: 250ms; }',
      '.motion-stagger > *:nth-child(7) { animation-delay: 300ms; }',
      '.motion-stagger > *:nth-child(8) { animation-delay: 350ms; }',
      '.motion-stagger > *:nth-child(9) { animation-delay: 400ms; }',
      '.motion-stagger > *:nth-child(10) { animation-delay: 450ms; }',
      '.motion-stagger > *:nth-child(n+11) { animation-delay: 500ms; }',
      '',
      '.motion-stagger-fast > * { animation: motion-fade-in var(--motion-fast) var(--motion-ease-out) both; }',
      '.motion-stagger-fast > *:nth-child(1) { animation-delay: 0ms; }',
      '.motion-stagger-fast > *:nth-child(2) { animation-delay: 30ms; }',
      '.motion-stagger-fast > *:nth-child(3) { animation-delay: 60ms; }',
      '.motion-stagger-fast > *:nth-child(4) { animation-delay: 90ms; }',
      '.motion-stagger-fast > *:nth-child(5) { animation-delay: 120ms; }',
      '.motion-stagger-fast > *:nth-child(n+6) { animation-delay: 150ms; }',
      '',
      '/* ═══ DEPTH / PERSPECTIVE ═══ */',
      '.motion-perspective { perspective: 1200px; perspective-origin: center; }',
      '.motion-depth-front { transform: translateZ(30px); }',
      '.motion-depth-back { transform: translateZ(-20px) scale(1.04); filter: blur(0.5px); opacity: 0.85; }',
      '.motion-depth-float { transform: translateZ(15px); filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.25)); }',
      '.motion-tilt { transform: rotateY(-5deg) rotateX(2deg); transition: transform var(--motion-slow) var(--motion-ease-out); }',
      '.motion-tilt:hover { transform: rotateY(0deg) rotateX(0deg); }',
      '.motion-tilt-right { transform: rotateY(5deg) rotateX(2deg); transition: transform var(--motion-slow) var(--motion-ease-out); }',
      '.motion-tilt-right:hover { transform: rotateY(0deg) rotateX(0deg); }',
      '',
      '/* ═══ MATTE TRANSITIONS ═══ */',
      '.motion-matte-reveal { mask-size: 0% auto; mask-repeat: no-repeat; mask-position: center; animation: motion-matte-wipe var(--motion-slower) var(--motion-ease-out) forwards; }',
      '@keyframes motion-matte-wipe { to { mask-size: 300% auto; } }',
      '.motion-matte-radial { mask-image: radial-gradient(circle, white, black); mask-size: 0% 0%; mask-position: center; mask-repeat: no-repeat; animation: motion-matte-radial-reveal var(--motion-slower) var(--motion-ease-out) forwards; }',
      '@keyframes motion-matte-radial-reveal { to { mask-size: 200% 200%; } }',
      '.motion-matte-diagonal { mask-image: linear-gradient(135deg, white 0%, black 100%); mask-size: 300% 300%; mask-position: 100% 100%; animation: motion-matte-diagonal-reveal var(--motion-slower) var(--motion-ease-out) forwards; }',
      '@keyframes motion-matte-diagonal-reveal { to { mask-position: 0% 0%; } }',
      '',
      '/* ═══ REDUCED MOTION ═══ */',
      '@media (prefers-reduced-motion: reduce) {',
      '  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }',
      '  .motion-float, .motion-pulse, .motion-glow { animation: none !important; }',
      '}'
    ].join('\\n');
    document.head.appendChild(style);
  }

  _injectMotionStyles();

  // ═══════════════════════════════════════════════════════════════════════════
  // DECLARATIVE DATA BINDING (Datastar-inspired, metadata-driven)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Minimal: just data-method is enough. Everything else auto-inferred.
  //
  //   <div data-method="cpu"></div>
  //     → format from @format tag, live from @stateful, trigger=load (div)
  //
  //   <button data-method="restart" data-target="#status">Restart</button>
  //     → trigger=click (button), swaps innerHTML of #status
  //
  //   <span data-method="stats" data-field="users.active"></span>
  //     → extracts nested field, trigger=load (span)
  //
  // Override attributes (optional — only when you need to deviate from metadata):
  //   data-format="gauge"       Override @format from docblock
  //   data-trigger="click"      Override auto-inferred trigger
  //   data-target="#panel"      Where to render (default: self)
  //   data-swap="outerHTML"     How to replace: innerHTML(default), outerHTML,
  //                             beforeend, afterend, beforebegin, afterbegin
  //   data-args='{"id":1}'     Parameters to pass
  //   data-field="name.first"  Extract nested field from result
  //   data-live                Force live mode (override @stateful inference)
  //   data-refresh="5s"        Force polling (override @scheduled inference)

  var _methodMeta = ctx.methodMeta || {};
  var _isStateful = ctx.stateful || false;

  // Interactive elements default to click trigger, content elements to load
  var _clickTags = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1 };

  // Track bound elements and their last results for theme-change re-rendering
  var _boundElements = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM CSS (injected once on first form generation)
  // ═══════════════════════════════════════════════════════════════════════════
  var _formCSSInjected = false;
  function _injectFormCSS() {
    if (_formCSSInjected) return;
    _formCSSInjected = true;
    var style = document.createElement('style');
    style.id = 'photon-form-css';
    style.textContent = [
      '.photon-auto-form { font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; }',
      '.photon-auto-form .pf-group { margin-bottom: 12px; }',
      '.photon-auto-form label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: var(--color-on-surface, var(--text, #c0caf5)); }',
      '.photon-auto-form label .pf-req { color: var(--color-error, var(--error, #f7768e)); margin-left: 2px; }',
      '.photon-auto-form input, .photon-auto-form select, .photon-auto-form textarea {',
      '  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px;',
      '  border: 1px solid var(--color-outline-variant, var(--border, #3b3d57)); background: var(--color-surface-container, var(--input, #1e2030));',
      '  color: var(--color-on-surface, var(--text, #c0caf5)); font-size: 14px; font-family: inherit; outline: none;',
      '}',
      '.photon-auto-form input:focus, .photon-auto-form select:focus, .photon-auto-form textarea:focus {',
      '  border-color: var(--color-primary, var(--accent, #7aa2f7));',
      '}',
      '.photon-auto-form input[type="checkbox"] { width: auto; margin-right: 8px; }',
      '.photon-auto-form .pf-check-group { display: flex; align-items: center; }',
      '.photon-auto-form .pf-desc { font-size: 11px; color: var(--color-on-surface-muted, var(--muted, #565f89)); margin-top: 2px; }',
      '.photon-auto-form button[type="submit"] {',
      '  margin-top: 16px; padding: 10px 24px; border-radius: 6px; border: none; cursor: pointer;',
      '  background: var(--color-primary, var(--accent, #7aa2f7)); color: var(--color-on-primary, #fff); font-size: 14px; font-weight: 500;',
      '  font-family: inherit; width: 100%;',
      '}',
      '.photon-auto-form button[type="submit"]:hover { opacity: 0.9; }',
      '.photon-auto-form button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }',
      '.photon-auto-form .pf-result { margin-top: 16px; }',
      '.photon-auto-form .pf-error { color: var(--color-error, var(--error, #f7768e)); font-size: 13px; margin-top: 8px; }',
    ].join('\\n');
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM GENERATION (vanilla JS from JSON Schema)
  // ═══════════════════════════════════════════════════════════════════════════

  function _shouldShowForm(meta, args) {
    // Explicit data-view overrides auto-detection
    // Otherwise: show form if any required params are missing from args
    var schema = meta.inputSchema;
    if (!schema || !schema.properties) return false; // no params → result
    var required = schema.required || [];
    if (required.length === 0) return false; // no required params → result
    for (var i = 0; i < required.length; i++) {
      if (!(required[i] in args)) return true; // missing required → form
    }
    return false; // all required present → result
  }

  function _escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _generateForm(el, method, meta, args, proxy, format, renderResult) {
    _injectFormCSS();
    var schema = meta.inputSchema;
    var props = schema.properties || {};
    var required = schema.required || [];
    var keys = Object.keys(props);

    var form = document.createElement('form');
    form.className = 'photon-auto-form';
    form.setAttribute('autocomplete', 'off');

    for (var i = 0; i < keys.length; i++) {
      (function(key) {
        var prop = props[key];
        var isReq = required.indexOf(key) !== -1;
        var type = prop.type || 'string';
        var group = document.createElement('div');
        group.className = 'pf-group';

        var prefilled = args[key] !== undefined ? args[key] : (prop.default !== undefined ? prop.default : '');

        if (type === 'boolean') {
          group.className += ' pf-check-group';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.name = key;
          cb.id = 'pf-' + key;
          if (prefilled === true || prefilled === 'true') cb.checked = true;
          var lbl = document.createElement('label');
          lbl.htmlFor = 'pf-' + key;
          lbl.textContent = prop.title || key;
          group.appendChild(cb);
          group.appendChild(lbl);
        } else {
          var lbl = document.createElement('label');
          lbl.htmlFor = 'pf-' + key;
          lbl.innerHTML = _escHtml(prop.title || key) + (isReq ? '<span class="pf-req">*</span>' : '');
          group.appendChild(lbl);

          var input;
          if (prop.enum && prop.enum.length > 0) {
            input = document.createElement('select');
            input.name = key;
            input.id = 'pf-' + key;
            var placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select...';
            input.appendChild(placeholder);
            for (var j = 0; j < prop.enum.length; j++) {
              var opt = document.createElement('option');
              opt.value = prop.enum[j];
              opt.textContent = prop.enum[j];
              if (String(prefilled) === String(prop.enum[j])) opt.selected = true;
              input.appendChild(opt);
            }
          } else if (type === 'number' || type === 'integer') {
            input = document.createElement('input');
            input.type = 'number';
            input.name = key;
            input.id = 'pf-' + key;
            if (prop.minimum !== undefined) input.min = String(prop.minimum);
            if (prop.maximum !== undefined) input.max = String(prop.maximum);
            if (type === 'integer') input.step = '1';
            if (prefilled !== '') input.value = String(prefilled);
          } else if (prop.format === 'date') {
            input = document.createElement('input');
            input.type = 'date';
            input.name = key;
            input.id = 'pf-' + key;
            if (prefilled) input.value = String(prefilled);
          } else if (prop.maxLength && prop.maxLength > 200) {
            input = document.createElement('textarea');
            input.name = key;
            input.id = 'pf-' + key;
            input.rows = 4;
            if (prefilled) input.value = String(prefilled);
          } else {
            input = document.createElement('input');
            input.type = 'text';
            input.name = key;
            input.id = 'pf-' + key;
            if (prefilled !== '') input.value = String(prefilled);
          }

          if (isReq) input.required = true;
          if (prop.description) input.placeholder = prop.description;
          group.appendChild(input);

          if (prop.description) {
            var desc = document.createElement('div');
            desc.className = 'pf-desc';
            desc.textContent = prop.description;
            group.appendChild(desc);
          }
        }

        form.appendChild(group);
      })(keys[i]);
    }

    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Run';
    form.appendChild(submitBtn);

    var resultDiv = document.createElement('div');
    resultDiv.className = 'pf-result';
    form.appendChild(resultDiv);

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Running...';

      // Collect form values
      var formArgs = {};
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var prop = props[key];
        var type = prop.type || 'string';
        var inputEl = form.querySelector('[name="' + key + '"]');
        if (!inputEl) continue;
        if (type === 'boolean') {
          formArgs[key] = inputEl.checked;
        } else if (type === 'number' || type === 'integer') {
          var val = inputEl.value;
          if (val !== '') formArgs[key] = type === 'integer' ? parseInt(val, 10) : parseFloat(val);
        } else {
          var val = inputEl.value;
          if (val !== '') formArgs[key] = val;
        }
      }

      try {
        var p = proxy[method](formArgs);
        if (p && typeof p.then === 'function') {
          p.then(function(r) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Run';
            resultDiv.innerHTML = '';
            if (format) {
              window.photon.render(resultDiv, r, format);
            } else {
              renderResult(r);
            }
          }).catch(function(err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Run';
            resultDiv.innerHTML = '<div class="pf-error">Error: ' + _escHtml(err.message) + '</div>';
          });
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Run';
        resultDiv.innerHTML = '<div class="pf-error">Error: ' + _escHtml(err.message) + '</div>';
      }
    });

    el.innerHTML = '';
    el.appendChild(form);
  }

  function _bindElements() {
    if (!ctx.photon) return;
    var proxy = window[ctx.photon];
    if (!proxy) return;

    var els = document.querySelectorAll('[data-method]');
    for (var i = 0; i < els.length; i++) {
      (function(el) {
        var method = el.getAttribute('data-method');
        if (!method) return;

        // ── Resolve metadata (docblock tags) ──
        var meta = _methodMeta[method] || {};

        // ── Format: explicit attr > @format tag > fallback to raw rendering ──
        var format = el.getAttribute('data-format') || meta.format || null;

        // ── Field extraction (optional) ──
        var field = el.getAttribute('data-field');

        // ── Args (optional) ──
        var argsStr = el.getAttribute('data-args');
        var args = {};
        if (argsStr) {
          try { args = JSON.parse(argsStr); } catch(e) {
            console.warn('[photon] Invalid data-args JSON:', argsStr);
          }
        }

        // ── Target: explicit attr or self ──
        var targetSel = el.getAttribute('data-target');
        function getTarget() {
          if (targetSel) {
            return document.querySelector(targetSel) || el;
          }
          return el;
        }

        // ── Swap mode ──
        var swap = el.getAttribute('data-swap') || 'innerHTML';

        // ── Render result into target ──
        function renderResult(result) {
          var target = getTarget();
          if (field) {
            var parts = field.split('.');
            var val = result;
            for (var j = 0; j < parts.length && val != null; j++) {
              val = val[parts[j]];
            }
            var text = val != null ? String(val) : '';
            if (swap === 'outerHTML') {
              target.outerHTML = text;
            } else {
              target.textContent = text;
            }
          } else if (format) {
            // Use photon renderer for structured formats (table, gauge, chart, etc.)
            if (swap === 'outerHTML') {
              // Render into a temp container, then replace
              var tmp = document.createElement('div');
              tmp.id = target.id;
              tmp.className = target.className;
              window.photon.render(tmp, result, format);
              target.replaceWith(tmp);
            } else if (swap === 'innerHTML') {
              window.photon.render(target, result, format);
            } else {
              // beforeend, afterend, etc. — render to temp, then insert
              var frag = document.createElement('div');
              window.photon.render(frag, result, format);
              target.insertAdjacentHTML(swap, frag.innerHTML);
            }
          } else {
            // No format, no field: render as text or JSON
            var raw = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
            if (swap === 'outerHTML') {
              target.outerHTML = raw;
            } else if (swap === 'innerHTML') {
              target.textContent = raw;
            } else {
              target.insertAdjacentText(swap, raw);
            }
          }
        }

        // Track for theme-change re-rendering (only format-rendered elements)
        var _lastResult = undefined;
        if (format) {
          _boundElements.push(function() {
            if (_lastResult !== undefined) renderResult(_lastResult);
          });
        }

        // Wrap renderResult to cache last result
        var _originalRender = renderResult;
        renderResult = function(result) {
          _lastResult = result;
          _originalRender(result);
        };

        // ── Auto-detect: form vs result ──
        // data-view="form" forces form, data-view="result" forces invoke
        // Otherwise: show form if required params are missing from args
        var viewOverride = el.getAttribute('data-view');
        var showForm = false;
        if (viewOverride === 'form') {
          showForm = true;
        } else if (viewOverride === 'result') {
          showForm = false;
        } else {
          showForm = _shouldShowForm(meta, args);
        }

        if (showForm && meta.inputSchema) {
          _generateForm(el, method, meta, args, proxy, format, renderResult);
          return; // form handles its own lifecycle
        }

        // ── Call method and render ──
        function load() {
          el.classList.add('photon-loading');
          try {
            var p = proxy[method](args);
            if (p && typeof p.then === 'function') {
              p.then(function(r) {
                el.classList.remove('photon-loading');
                renderResult(r);
              }).catch(function(e) {
                el.classList.remove('photon-loading');
                var target = getTarget();
                target.textContent = 'Error: ' + e.message;
              });
            } else {
              el.classList.remove('photon-loading');
              renderResult(p);
            }
          } catch (e) {
            el.classList.remove('photon-loading');
            var target = getTarget();
            target.textContent = 'Error: ' + e.message;
          }
        }

        // ── Trigger: explicit attr > auto-infer from element type ──
        var trigger = el.getAttribute('data-trigger');
        if (!trigger) {
          trigger = _clickTags[el.tagName] ? 'click' : 'load';
        }

        if (trigger === 'load') {
          // Content elements: call method immediately on page load
          load();
        } else {
          // Interactive elements: bind event handler
          el.addEventListener(trigger, function(e) {
            e.preventDefault();
            load();
          });
        }

        // ── Live updates: explicit data-live > auto from @stateful ──
        var isLive = el.hasAttribute('data-live') || _isStateful;
        if (isLive) {
          var onFn = proxy['onResult'];
          if (onFn) {
            onFn(function(data) {
              if (data && data.method === method) {
                renderResult(data.result);
              }
            });
          }
        }

        // ── Refresh: explicit data-refresh > auto from @scheduled ──
        var refreshAttr = el.getAttribute('data-refresh');
        if (!refreshAttr && meta.scheduled) {
          // @scheduled cron exists — default to 60s polling as reasonable interval
          // (cron precision varies; polling is a simple client-side approximation)
          refreshAttr = '60s';
        }
        if (refreshAttr) {
          var ms = parseFloat(refreshAttr) * 1000;
          if (/s$/i.test(refreshAttr)) ms = parseFloat(refreshAttr) * 1000;
          else if (/m$/i.test(refreshAttr)) ms = parseFloat(refreshAttr) * 60000;
          if (ms > 0 && isFinite(ms)) {
            setInterval(load, Math.max(ms, 1000));
          }
        }
      })(els[i]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEWPORT-FILL SCALING (for standalone pure-view pages)
  // ═══════════════════════════════════════════════════════════════════════════
  function _setupViewportScaling() {
    var container = document.getElementById('pure-view');
    if (!container) return; // not a standalone pure-view page

    var observer = new ResizeObserver(function() {
      // Get the rendered content's natural size
      var content = container.firstElementChild;
      if (!content) return;

      // Don't scale forms — they should stay at natural size
      if (content.classList && content.classList.contains('photon-auto-form')) return;

      var viewportH = window.innerHeight;
      var viewportW = window.innerWidth;
      var contentH = content.scrollHeight || content.offsetHeight;
      var contentW = content.scrollWidth || content.offsetWidth;

      if (contentH < 10 || contentW < 10) return; // not yet rendered

      var pad = 32;
      var zoomH = (viewportH - pad) / contentH;
      var zoomW = (viewportW - pad) / contentW;
      var zoom = Math.min(zoomH, zoomW);
      var clamped = Math.max(0.5, Math.min(3, zoom));

      if (clamped > 1.02 || clamped < 0.95) {
        container.style.zoom = String(clamped);
      } else {
        container.style.zoom = '';
      }
    });

    observer.observe(container);
    window.addEventListener('resize', function() {
      // Re-trigger observer measurement
      if (container.firstElementChild) {
        observer.unobserve(container);
        observer.observe(container);
      }
    });
  }

  // Only run declarative data binding for .photon.html templates
  // (signaled by <meta name="photon-template"> injected by custom-ui-renderer)
  function _maybeBindElements() {
    if (document.querySelector('meta[name="photon-template"]')) {
      _bindElements();
      // Set up viewport scaling after binding (for pure-view standalone pages)
      _setupViewportScaling();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _maybeBindElements);
  } else {
    setTimeout(_maybeBindElements, 0);
  }

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
