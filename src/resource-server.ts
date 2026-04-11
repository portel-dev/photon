/**
 * ResourceServer — extracted from PhotonServer
 *
 * Encapsulates all MCP resource handling:
 * - ListResources, ListResourceTemplates, ReadResource handlers
 * - UI resource URI resolution (ui:// and photon:// schemes)
 * - Icon image resolution (file → data URI)
 * - Asset serving (UI HTML, prompts, static resources)
 * - MCP Apps bridge script generation for Claude Desktop compatibility
 *
 * Dependency direction: PhotonServer → ResourceServer (never the reverse).
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { readText } from './shared/io.js';
import type { PhotonClassExtended } from '@portel/photon-core';
/** Minimal interface for executing tool calls — avoids importing PhotonLoader */
export interface ResourceToolExecutor {
  executeTool(
    photon: PhotonClassExtended,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any>;
  getLoadedPhotons(): Map<string, PhotonClassExtended>;
}

/** Minimal options subset needed by ResourceServer */
export interface ResourceServerOptions {
  filePath: string;
  embeddedAssets?: { indexHtml: string; bundleJs: string };
  embeddedUITemplates?: Record<string, Record<string, string>>;
}

export class ResourceServer {
  private static readonly ICON_MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };

  /** Cached resolved icons per tool name */
  private resolvedIconsCache = new Map<
    string,
    Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }>
  >();

  constructor(
    private toolExecutor: ResourceToolExecutor,
    private options: ResourceServerOptions
  ) {}

  // ─── URI helpers ────────────────────────────────────────────────────

  /**
   * Build UI resource URI based on detected format
   */
  buildUIResourceUri(photonName: string, uiId: string): string {
    return `ui://${photonName}/${uiId}`;
  }

  /**
   * Build tool metadata for UI based on detected format
   */
  buildUIToolMeta(photonName: string, uiId: string): Record<string, unknown> {
    const uri = this.buildUIResourceUri(photonName, uiId);
    return { ui: { resourceUri: uri } };
  }

  /**
   * Get UI mimeType based on detected format and client capabilities
   */
  getUIMimeType(): string {
    return 'text/html;profile=mcp-app';
  }

  // ─── Icon resolution ────────────────────────────────────────────────

  /**
   * Resolve raw icon image paths to MCP Icon[] format (data URIs).
   * Results are cached so file I/O only happens once per tool.
   */
  resolveIconImages(
    iconImages: Array<{ path: string; sizes?: string; theme?: string }>
  ): Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }> {
    const cacheKey = iconImages.map((i) => i.path).join('|');
    const cached = this.resolvedIconsCache.get(cacheKey);
    if (cached) return cached;

    const photonDir = path.dirname(this.options.filePath);
    const icons: Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }> = [];

    for (const entry of iconImages) {
      try {
        const resolvedPath = path.resolve(photonDir, entry.path);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = ResourceServer.ICON_MIME_TYPES[ext];
        if (!mimeType) continue;

        const data = readFileSync(resolvedPath);
        const dataUri = `data:${mimeType};base64,${data.toString('base64')}`;

        const icon: { src: string; mimeType?: string; sizes?: string; theme?: string } = {
          src: dataUri,
          mimeType,
        };
        if (entry.sizes) icon.sizes = entry.sizes;
        if (entry.theme) icon.theme = entry.theme;
        icons.push(icon);
      } catch {
        // Skip unreadable icon files silently
      }
    }

    this.resolvedIconsCache.set(cacheKey, icons);
    return icons;
  }

  // ─── URI template helpers ───────────────────────────────────────────

  /**
   * Check if a URI is a template (contains {parameters})
   */
  isUriTemplate(uri: string): boolean {
    return /\{[^}]+\}/.test(uri);
  }

  /**
   * Match URI pattern with actual URI
   * Example: github://repos/{owner}/{repo} matches github://repos/foo/bar
   */
  private matchUriPattern(pattern: string, uri: string): boolean {
    const regexPattern = pattern.replace(/\{[^}]+\}/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(uri);
  }

  /**
   * Parse parameters from URI based on pattern
   * Example: pattern="github://repos/{owner}/{repo}", uri="github://repos/foo/bar"
   * Returns: { owner: "foo", repo: "bar" }
   */
  private parseUriParams(pattern: string, uri: string): Record<string, string> {
    const params: Record<string, string> = {};

    const paramNames: string[] = [];
    const paramRegex = /\{([^}]+)\}/g;
    let match;
    while ((match = paramRegex.exec(pattern)) !== null) {
      paramNames.push(match[1]);
    }

    const regexPattern = pattern.replace(/\{[^}]+\}/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);

    const values = uri.match(regex);
    if (values) {
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]] = values[i + 1];
      }
    }

    return params;
  }

  // ─── MCP request handlers ──────────────────────────────────────────

  handleListResources(mcp: PhotonClassExtended | null): { resources: any[] } {
    if (!mcp) {
      return { resources: [] };
    }

    const staticResources = mcp.statics.filter((s) => !this.isUriTemplate(s.uri));

    const resources = staticResources.map((static_) => ({
      uri: static_.uri,
      name: static_.name,
      description: static_.description,
      mimeType: static_.mimeType || 'text/plain',
    }));

    if (mcp.assets) {
      const photonName = mcp.name;

      for (const ui of mcp.assets.ui) {
        const uiUri = ui.uri || this.buildUIResourceUri(photonName, ui.id);
        resources.push({
          uri: uiUri,
          name: `ui:${ui.id}`,
          description: ui.linkedTool
            ? `UI template for ${ui.linkedTool} tool`
            : `UI template: ${ui.id}`,
          // Always use MCP Apps mime type for UI resources — photon-core's
          // getMimeTypeFromPath returns plain text/html which causes Claude
          // Desktop to skip rendering the app UI
          mimeType: this.getUIMimeType(),
        });
      }

      for (const prompt of mcp.assets.prompts) {
        resources.push({
          uri: `photon://${photonName}/prompts/${prompt.id}`,
          name: `prompt:${prompt.id}`,
          description: prompt.description || `Prompt template: ${prompt.id}`,
          mimeType: 'text/markdown',
        });
      }

      for (const resource of mcp.assets.resources) {
        resources.push({
          uri: `photon://${photonName}/resources/${resource.id}`,
          name: `resource:${resource.id}`,
          description: resource.description || `Static resource: ${resource.id}`,
          mimeType: resource.mimeType || 'application/octet-stream',
        });
      }
    }

    // Include sub-photon UI resources (compiled binary mode)
    if (this.options.embeddedAssets) {
      const allLoaded = this.toolExecutor.getLoadedPhotons();
      for (const [, loaded] of allLoaded) {
        if (loaded.name === mcp.name) continue;
        if (loaded.assets?.ui) {
          for (const ui of loaded.assets.ui) {
            const uiUri = ui.uri || `ui://${loaded.name}/${ui.id}`;
            resources.push({
              uri: uiUri,
              name: `ui:${ui.id}`,
              description: ui.linkedTool
                ? `UI template for ${loaded.name}/${ui.linkedTool}`
                : `UI template: ${loaded.name}/${ui.id}`,
              mimeType: ui.mimeType || this.getUIMimeType(),
            });
          }
        }
      }
    }

    return { resources };
  }

  handleListResourceTemplates(mcp: PhotonClassExtended | null): { resourceTemplates: any[] } {
    if (!mcp) {
      return { resourceTemplates: [] };
    }

    const templateResources = mcp.statics.filter((s) => this.isUriTemplate(s.uri));

    return {
      resourceTemplates: templateResources.map((static_) => ({
        uriTemplate: static_.uri,
        name: static_.name,
        description: static_.description,
        mimeType: static_.mimeType || 'text/plain',
      })),
    };
  }

  async handleReadResource(request: any, mcp: PhotonClassExtended | null): Promise<any> {
    if (!mcp) {
      throw new Error('MCP not loaded');
    }

    const { uri: rawUri } = request.params;
    const uri =
      typeof rawUri === 'string'
        ? rawUri.replace(/^ui:\/\/\/([^/]+)\/(.+)$/, 'ui://$1/$2')
        : rawUri;

    const uiMatch = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (uiMatch) {
      const [, uiPhotonName, assetId] = uiMatch;
      // Check main photon first
      if (mcp.assets && uiPhotonName === mcp.name) {
        return this.handleUIAssetRead(uri, assetId, mcp);
      }
      // Check sub-photons (compiled binary mode)
      if (this.options.embeddedAssets) {
        const allLoaded = this.toolExecutor.getLoadedPhotons();
        for (const [, loaded] of allLoaded) {
          if (loaded.name === uiPhotonName && loaded.assets?.ui) {
            return this.handleUIAssetRead(uri, assetId, mcp, loaded);
          }
        }
      }
      // Fallback to main photon
      if (mcp.assets) {
        return this.handleUIAssetRead(uri, assetId, mcp);
      }
    }

    const assetMatch = uri.match(/^photon:\/\/([^/]+)\/(ui|prompts|resources)\/(.+)$/);
    if (assetMatch && mcp.assets) {
      return this.handleAssetRead(uri, assetMatch, mcp);
    }

    return this.handleStaticRead(uri, mcp);
  }

  // ─── Asset reading ──────────────────────────────────────────────────

  /**
   * Handle SEP-1865 ui:// resource read
   */
  private async handleUIAssetRead(
    uri: string,
    assetId: string,
    mcp: PhotonClassExtended,
    photon?: PhotonClassExtended
  ) {
    const target = photon || mcp;
    const photonName = target.name;

    let content: string | undefined;

    // Try embedded templates first (compiled binary mode)
    if (this.options.embeddedUITemplates) {
      const templates = this.options.embeddedUITemplates[photonName];
      if (templates && templates[assetId]) {
        content = templates[assetId];
      }
    }

    // Fall back to disk if not embedded
    if (!content) {
      if (!target.assets?.ui) {
        throw new Error(`UI asset not found: ${uri}`);
      }
      const ui = target.assets.ui.find((u) => u.id === assetId);
      if (!ui || !ui.resolvedPath) {
        throw new Error(`UI asset not found: ${uri}`);
      }
      if (ui.resolvedPath.endsWith('.tsx')) {
        const { compileTsxCached } = await import('./tsx-compiler.js');
        content = await compileTsxCached(ui.resolvedPath);
      } else {
        content = await readText(ui.resolvedPath);
      }
    }

    // Wrap .photon.html fragments in a full HTML document.
    const isFragment =
      !content.trimStart().toLowerCase().startsWith('<!doctype') &&
      !content.trimStart().toLowerCase().startsWith('<html');
    if (isFragment) {
      content = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n<body>\n${content}\n</body>\n</html>`;
    }

    // Inject MCP Apps bridge script for Claude Desktop compatibility
    const bridgeScript = this.generateMcpAppsBridge(mcp);
    content = content.replace('<head>', `<head>\n${bridgeScript}`);

    return {
      contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: content }],
    };
  }

  /**
   * Handle photon:// asset read (Beam format)
   */
  private async handleAssetRead(
    uri: string,
    assetMatch: RegExpMatchArray,
    mcp: PhotonClassExtended
  ) {
    const [, _photonName, assetType, assetId] = assetMatch;

    let resolvedPath: string | undefined;
    let mimeType: string = 'text/plain';

    if (assetType === 'ui') {
      const ui = mcp.assets!.ui.find((u) => u.id === assetId);
      if (ui) {
        resolvedPath = ui.resolvedPath;
        mimeType = ui.mimeType || 'text/html;profile=mcp-app';
      }
    } else if (assetType === 'prompts') {
      const prompt = mcp.assets!.prompts.find((p) => p.id === assetId);
      if (prompt) {
        resolvedPath = prompt.resolvedPath;
        mimeType = 'text/markdown';
      }
    } else if (assetType === 'resources') {
      const resource = mcp.assets!.resources.find((r) => r.id === assetId);
      if (resource) {
        resolvedPath = resource.resolvedPath;
        mimeType = resource.mimeType || 'application/octet-stream';
      }
    }

    if (resolvedPath) {
      let content = await readText(resolvedPath);

      // Inject MCP Apps bridge for UI assets
      if (assetType === 'ui') {
        const bridgeScript = this.generateMcpAppsBridge(mcp);
        content = content.replace('<head>', `<head>\n${bridgeScript}`);
      }

      return {
        contents: [{ uri, mimeType, text: content }],
      };
    }

    throw new Error(`Asset not found: ${uri}`);
  }

  /**
   * Handle static resource read (for both stdio and SSE handlers)
   */
  private async handleStaticRead(uri: string, mcp: PhotonClassExtended) {
    const static_ = mcp.statics.find((s) => s.uri === uri || this.matchUriPattern(s.uri, uri));
    if (!static_) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const params = this.parseUriParams(static_.uri, uri);
    const result = await this.toolExecutor.executeTool(mcp, static_.name, params);
    return this.formatStaticResult(result, static_.mimeType);
  }

  /**
   * Format static result to MCP resource response
   */
  private formatStaticResult(result: any, mimeType?: string): any {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return {
      contents: [
        {
          uri: '',
          mimeType: mimeType || 'text/plain',
          text,
        },
      ],
    };
  }

  // ─── MCP Apps bridge ────────────────────────────────────────────────

  /**
   * Generate minimal MCP Apps bridge script for Claude Desktop compatibility
   * This handles the ui/initialize handshake and tool result delivery
   */
  generateMcpAppsBridge(mcp: PhotonClassExtended | null): string {
    const photonName = mcp?.name || 'photon-app';
    const injectedPhotons = mcp?.injectedPhotons || [];
    return (
      `<script>
(function() {
  'use strict';
  var pendingCalls = {};
  var callIdCounter = 0;
  var toolResult = null;
  var resultListeners = [];
  var emitListeners = [];
  var themeListeners = [];
  var eventListeners = {};  // For specific event subscriptions (e.g., 'taskMove')
  var photonEventListeners = {};  // Namespaced by photon name for injected photons
  var currentTheme = 'dark';
  var injectedPhotons = ${JSON.stringify(injectedPhotons)};

  function generateCallId() {
    return 'call_' + (++callIdCounter) + '_' + Math.random().toString(36).slice(2);
  }

  function postToHost(msg) {
    window.parent.postMessage(msg, '*');
  }

  // Listen for messages from host
  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;

    // Handle JSON-RPC messages
    if (m.jsonrpc === '2.0') {
      // Response to our request (has id, no method)
      if (m.id && !m.method && pendingCalls[m.id]) {
        var pending = pendingCalls[m.id];
        delete pendingCalls[m.id];
        if (m.error) {
          pending.reject(new Error(m.error.message));
        } else {
          // Extract clean data from MCP result format
          var result = m.result;
          var cleanData = result;
          if (result && result.structuredContent) {
            cleanData = result.structuredContent;
          } else if (result && result.content && Array.isArray(result.content)) {
            var textItem = result.content.find(function(i) { return i.type === 'text'; });
            if (textItem && textItem.text) {
              try { cleanData = JSON.parse(textItem.text); } catch(e) { cleanData = textItem.text; }
            }
          }
          pending.resolve(cleanData);
        }
        return;
      }

      // Tool result notification
      if (m.method === 'ui/notifications/tool-result') {
        var result = m.params;
        // Extract data from MCP result format
        if (result.structuredContent) {
          toolResult = result.structuredContent;
        } else if (result.content && Array.isArray(result.content)) {
          var textItem = result.content.find(function(i) { return i.type === 'text'; });
          if (textItem && textItem.text) {
            try { toolResult = JSON.parse(textItem.text); } catch(e) { toolResult = textItem.text; }
          }
        } else {
          toolResult = result;
        }
        // Set __PHOTON_DATA__ for UIs that read it at init
        window.__PHOTON_DATA__ = toolResult;
        // Dispatch event for UIs to re-initialize with new data
        window.dispatchEvent(new CustomEvent('photon:data-ready', { detail: toolResult }));
        resultListeners.forEach(function(cb) { cb(toolResult); });
      }

      // Host context changed (theme + embedded photon events)
      if (m.method === 'ui/notifications/host-context-changed') {
        // Standard theme handling
        if (m.params && m.params.theme) {
          currentTheme = m.params.theme;
          document.documentElement.classList.remove('light', 'dark', 'light-theme');
          document.documentElement.classList.add(m.params.theme);
          document.documentElement.setAttribute('data-theme', m.params.theme);
          // Apply theme token CSS variables (matching platform-compat applyThemeTokens)
          if (m.params.styles && m.params.styles.variables) {
            var root = document.documentElement;
            var vars = m.params.styles.variables;
            for (var key in vars) { root.style.setProperty(key, vars[key]); }
          }
          // Apply background/text colors to match platform-compat bridge
          if (m.params.theme === 'light') {
            document.documentElement.classList.add('light-theme');
            document.documentElement.style.colorScheme = 'light';
            document.documentElement.style.backgroundColor = '#ffffff';
            if (document.body) { document.body.style.backgroundColor = '#ffffff'; document.body.style.color = '#1a1a1a'; }
          } else {
            document.documentElement.style.colorScheme = 'dark';
            document.documentElement.style.backgroundColor = '#0d0d0d';
            if (document.body) { document.body.style.backgroundColor = '#0d0d0d'; document.body.style.color = '#e6e6e6'; }
          }
          themeListeners.forEach(function(cb) { cb(currentTheme); });
        }

        // Extract embedded photon event data
        // This enables real-time sync via standard MCP protocol
        if (m.params && m.params._photon) {
          var photonData = m.params._photon;
          // Route to generic emit listeners
          emitListeners.forEach(function(cb) { cb(photonData); });

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
    }
  });

  // Mark that we're in MCP Apps context (not Beam)
  window.__MCP_APPS_CONTEXT__ = true;

  // Expose photon bridge API
  window.photon = {
    get toolOutput() { return toolResult; },
    onResult: function(cb) {
      resultListeners.push(cb);
      if (toolResult) cb(toolResult);
      return function() {
        var i = resultListeners.indexOf(cb);
        if (i >= 0) resultListeners.splice(i, 1);
      };
    },
    callTool: function(name, args, opts) {
      var callId = generateCallId();
      return new Promise(function(resolve, reject) {
        pendingCalls[callId] = { resolve: resolve, reject: reject };
        var a = args || {};
        if (opts && opts.instance !== undefined) { a = Object.assign({}, a, { _targetInstance: opts.instance }); }
        postToHost({
          jsonrpc: '2.0',
          id: callId,
          method: 'tools/call',
          params: { name: name, arguments: a }
        });
        setTimeout(function() {
          if (pendingCalls[callId]) {
            delete pendingCalls[callId];
            reject(new Error('Tool call timeout'));
          }
        }, 30000);
      });
    },
    invoke: function(name, args, opts) { return window.photon.callTool(name, args, opts); },
    onEmit: function(cb) {
      emitListeners.push(cb);
      return function() {
        var i = emitListeners.indexOf(cb);
        if (i >= 0) emitListeners.splice(i, 1);
      };
    },
    onThemeChange: function(cb) {
      themeListeners.push(cb);
      // Call immediately with current theme
      cb(currentTheme);
      return function() {
        var i = themeListeners.indexOf(cb);
        if (i >= 0) themeListeners.splice(i, 1);
      };
    },
    get theme() { return currentTheme; },

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
  var photonName = '${photonName}';
  window[photonName] = new Proxy({}, {
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
      // e.g., taskMove(args) -> photon.callTool('taskMove', args)
      return function(args) {
        return window.photon.callTool(prop, args);
      };
    }
  });

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

  // Size notification helper
  function sendSizeChanged() {
    var body = document.body;
    var root = document.documentElement;

    // Calculate actual content dimensions
    var width = Math.max(
      body.scrollWidth,
      body.offsetWidth,
      root.clientWidth,
      root.scrollWidth,
      root.offsetWidth
    );
    var height = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      root.clientHeight,
      root.scrollHeight,
      root.offsetHeight
    );

    // Check for scrollable containers with overflow:hidden that hide true content size
    var containers = document.querySelectorAll('.board, [style*="overflow"]');
    containers.forEach(function(el) {
      if (el.scrollWidth > width) width = el.scrollWidth;
      if (el.scrollHeight > height) height = el.scrollHeight;
    });

    // For kanban-style boards, calculate from column count
    var columns = document.querySelectorAll('.column');
    if (columns.length > 0) {
      var columnWidth = 220; // min-width + gap
      var boardPadding = 48;
      var neededWidth = (columns.length * columnWidth) + boardPadding;
      if (neededWidth > width) width = neededWidth;
    }

    // Reasonable minimums, maximums, and padding
    width = Math.max(width, 600) + 32;
    // Force minimum height for kanban-style boards
    // header(120) + column headers(50) + 3-4 cards(450) = 620
    if (columns.length > 0) {
      height = Math.max(height, 620);
    } else {
      height = Math.max(height, 400);
    }

    postToHost({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { width: width, height: height }
    });
  }

  // MCP Apps handshake: send ui/initialize and wait for response
  var initId = generateCallId();
  pendingCalls[initId] = {
    resolve: function(result) {
      // Apply theme from host context (matching platform-compat bridge)
      if (result.hostContext && result.hostContext.theme) {
        currentTheme = result.hostContext.theme;
        document.documentElement.classList.remove('light', 'dark', 'light-theme');
        document.documentElement.classList.add(result.hostContext.theme);
        document.documentElement.setAttribute('data-theme', result.hostContext.theme);
        // Apply theme token CSS variables from host context
        if (result.hostContext.styles && result.hostContext.styles.variables) {
          var root = document.documentElement;
          var vars = result.hostContext.styles.variables;
          for (var key in vars) { root.style.setProperty(key, vars[key]); }
        }
        if (result.hostContext.theme === 'light') {
          document.documentElement.classList.add('light-theme');
          document.documentElement.style.colorScheme = 'light';
        } else {
          document.documentElement.style.colorScheme = 'dark';
        }
      }
      // Complete handshake
      postToHost({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });

      // Set up size notifications after handshake
      setTimeout(sendSizeChanged, 100);
      var resizeObserver = new ResizeObserver(function() {
        sendSizeChanged();
      });
      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);
    },
    reject: function(err) { console.error('MCP Apps init failed:', err); }
  };

  postToHost({
    jsonrpc: '2.0',
    id: initId,
    method: 'ui/initialize',
    params: {
      appInfo: { name: '${photonName}', version: '1.0.0' },
      appCapabilities: {},
      protocolVersion: '2026-01-26'
    }
  });
})();
</` + `script>`
    );
  }
}
