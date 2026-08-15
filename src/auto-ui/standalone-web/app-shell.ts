import type { ApplicationManifest } from '../app-manifest.js';
import { MCP_PROTOCOL_VERSIONS } from '../../mcp/protocol/versions.js';

export interface StandaloneWebShellOptions {
  photonName: string;
  title: string;
  description?: string;
  icon?: string;
  manifest?: ApplicationManifest;
  /**
   * Build-time manifest retained for callers that already compute one. Its
   * screen names and metadata are never serialized into the generated page;
   * navigation is derived from the authorized runtime tools/list catalog.
   */
  browserInvocableMethods?: ReadonlySet<string>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[char] || char;
  });
}

function safeScriptJson(value: unknown): string {
  return (JSON.stringify(value) || 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const INITIALIZE_PARAMS = {
  protocolVersion: MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25,
  clientInfo: { name: 'photon-standalone-web', version: '1.0.0' },
  capabilities: {
    tools: {},
    extensions: {
      'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
      'dev.portel.photon': { version: '1.0.0' },
    },
  },
};

/**
 * Generate the Beam-hosted standalone application shell.
 *
 * The generated page uses only existing browser contracts: `/mcp` for the
 * negotiated MCP session, `tools/list` for per-session authorization, the
 * canonical renderer endpoint, and the existing invoke-form bundle. It does
 * not create an HTTP route for any Photon method.
 */
export function generateStandaloneWebShell(options: StandaloneWebShellOptions): string {
  const title = escapeHtml(options.title);
  const description = escapeHtml(options.description || '');
  const icon = escapeHtml(options.icon || '◌');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light dark;
      --standalone-bg: var(--bg-app, #101114);
      --standalone-panel: var(--bg-panel, var(--bg-glass-strong, #17191e));
      --standalone-text: var(--t-primary, #eceef2);
      --standalone-muted: var(--t-muted, #aeb4c0);
      --standalone-border: var(--border-glass, #2b2e35);
      --standalone-accent: var(--accent-secondary, #78e6ff);
      font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
      background: var(--standalone-bg);
      color: var(--standalone-text);
    }
    @media (prefers-color-scheme: light) {
      :root {
        --standalone-bg: var(--bg-app, #f6f7f9);
        --standalone-panel: var(--bg-panel, var(--bg-glass-strong, #ffffff));
        --standalone-text: var(--t-primary, #1c2027);
        --standalone-muted: var(--t-muted, #5e6877);
        --standalone-border: var(--border-glass, #d9dee7);
        --standalone-accent: var(--accent-secondary, #1769aa);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--standalone-bg); color: var(--standalone-text); }
    .app-shell { min-height: 100vh; display: grid; grid-template-columns: 240px minmax(0, 1fr); }
    .sidebar { padding: 24px 16px; border-right: 1px solid var(--standalone-border); background: var(--standalone-panel); }
    .brand { display: flex; gap: 10px; align-items: center; margin: 0 8px 24px; font-weight: 700; }
    .brand-icon { font-size: 22px; }
    nav { display: grid; gap: 6px; }
    nav button { border: 0; border-radius: 8px; padding: 10px 12px; text-align: left; color: var(--standalone-muted); background: transparent; cursor: pointer; font: inherit; }
    nav button:hover, nav button[aria-current="page"] { color: var(--standalone-text); background: color-mix(in srgb, var(--standalone-border) 65%, transparent); }
    .content { min-width: 0; padding: 40px clamp(20px, 5vw, 72px); }
    .content-header { max-width: 860px; margin-bottom: 24px; }
    h1, h2, p { margin-top: 0; }
    h1 { margin-bottom: 8px; font-size: clamp(24px, 4vw, 38px); }
    .description { color: var(--standalone-muted); line-height: 1.6; }
    .screen { max-width: 860px; padding: 24px; border: 1px solid var(--standalone-border); border-radius: 14px; background: var(--standalone-panel); }
    .screen h2 { margin-bottom: 8px; }
    .screen-description { color: var(--standalone-muted); line-height: 1.5; }
    .form-host { margin-top: 20px; }
    .result { margin-top: 24px; min-height: 24px; }
    .result pre { overflow: auto; padding: 16px; border-radius: 8px; background: color-mix(in srgb, var(--standalone-bg) 80%, #000); color: var(--standalone-text); }
    .error { color: #b42318; }
    .empty-state { max-width: 620px; margin: 12vh auto; padding: 32px; text-align: center; border: 1px dashed var(--standalone-border); border-radius: 14px; color: var(--standalone-muted); }
    .empty-icon { margin-bottom: 16px; font-size: 44px; color: var(--standalone-accent); }
    .empty-state h2 { color: var(--standalone-text); }
    @media (prefers-color-scheme: dark) { .error { color: #ff9e9e; } }
    @media (max-width: 700px) { .app-shell { display: block; } .sidebar { border-right: 0; border-bottom: 1px solid var(--standalone-border); } nav { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); } .content { padding: 24px 16px; } }
  </style>
</head>
<body>
  <div id="standalone-app" class="app-shell">
    <aside class="sidebar" aria-label="Application navigation">
      <div class="brand"><span class="brand-icon" id="brand-icon">${icon}</span><span id="brand-title">${title}</span></div>
      <nav id="app-navigation"></nav>
    </aside>
    <main class="content">
      <header class="content-header"><h1 id="app-title">${title}</h1><p id="app-description" class="description">${description}</p></header>
      <div id="app-view"><div class="screen"><p>Loading application…</p></div></div>
    </main>
  </div>
  <script>
    const PHOTON = ${safeScriptJson(options.photonName)};
    const MCP_INITIALIZE_PARAMS = ${safeScriptJson(INITIALIZE_PARAMS)};
    const appNavigation = document.getElementById('app-navigation');
    const appView = document.getElementById('app-view');
    let sessionId = null;
    let requestId = 1;
    let tools = new Map();
    let activeScreen;

    function methodName(name) {
      const slashless = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
      return slashless.includes('.') ? slashless.slice(slashless.lastIndexOf('.') + 1) : slashless;
    }

    function fallbackLabel(value) {
      return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    function catalogNavigationItems(catalog) {
      return catalog
        .filter((tool) => typeof tool.name === 'string' && !tool.name.startsWith('photon_') && !tool.name.startsWith('_'))
        .map((tool) => {
          const method = methodName(tool.name);
          const renderMeta = tool._meta && tool._meta['photon/render'];
          const label = (tool.annotations && tool.annotations.title) || tool.title ||
            tool['x-button-label'] || (renderMeta && renderMeta.buttonLabel) || fallbackLabel(method);
          const icon = tool['x-icon'] || (renderMeta && renderMeta.icon);
          return { id: method, method, label: String(label), ...(icon ? { icon: String(icon) } : {}) };
        });
    }

    function showEmpty(message) {
      appView.innerHTML = '<section class="empty-state" aria-live="polite"><div class="empty-icon">◌</div><h2>No screens available</h2><p></p></section>';
      appView.querySelector('p').textContent = message || 'This application has no browser-invocable screens yet.';
    }

    function navigationItems() {
      return catalogNavigationItems(Array.from(tools.values()));
    }

    function drawNavigation(items) {
      appNavigation.replaceChildren();
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.screen = item.id;
        button.setAttribute('aria-current', item.id === activeScreen ? 'page' : 'false');
        button.textContent = (item.icon ? item.icon + ' ' : '') + item.label;
        button.addEventListener('click', () => selectScreen(item.id));
        appNavigation.appendChild(button);
      }
    }

    function toolForScreen(screen) {
      return tools.get(screen && screen.method);
    }

    function parseToolResult(result) {
      if (result && result.structuredContent !== undefined) return result.structuredContent;
      const text = (result && result.content || []).find((part) => part.type === 'text');
      if (text && text.text !== undefined) {
        try { return JSON.parse(text.text); } catch { return text.text; }
      }
      const image = (result && result.content || []).find((part) => part.type === 'image' && part.data && part.mimeType);
      return image ? 'data:' + image.mimeType + ';base64,' + image.data : null;
    }

    async function mcpRequest(method, params, retry = true) {
      if (method !== 'initialize' && !sessionId) await mcpRequest('initialize', MCP_INITIALIZE_PARAMS);
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
      const response = await fetch('/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }), signal: AbortSignal.timeout(60000) });
      const returnedSession = response.headers.get('mcp-session-id');
      if (returnedSession) sessionId = returnedSession;
      const payload = await response.json();
      if (payload.error) {
        if (retry && method !== 'initialize' && /session/i.test(payload.error.message || '')) { sessionId = null; return mcpRequest(method, params, false); }
        throw new Error(payload.error.message || 'MCP request failed');
      }
      return payload.result;
    }

    async function loadTools() {
      await mcpRequest('initialize', MCP_INITIALIZE_PARAMS);
      const listed = await mcpRequest('tools/list', {});
      const wanted = new Map();
      for (const tool of listed.tools || []) {
        const name = String(tool.name || '');
        const slash = PHOTON + '/';
        const dot = PHOTON + '.';
        if (name.startsWith(slash)) wanted.set(name.slice(slash.length), tool);
        else if (name.startsWith(dot)) wanted.set(name.slice(dot.length), tool);
        else if (!name.includes('/') && !name.includes('.')) wanted.set(name, tool);
      }
      tools = wanted;
    }

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-standalone-src="' + src + '"]');
        if (existing) { resolve(); return; }
        const script = document.createElement('script');
        script.type = 'module'; script.src = src; script.dataset.standaloneSrc = src;
        script.onload = resolve; script.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(script);
      });
    }

    async function renderResult(target, data, meta) {
      const format = (meta && meta.format) || 'json';
      try {
        await loadScript('/api/photon-renderers.js');
        if (window._photonRenderers) { window._photonRenderers.render(target, data, format, { host: 'web', ...(meta && meta.layoutHints ? meta.layoutHints : {}) }); return; }
      } catch { /* safe fallback below */ }
      const pre = document.createElement('pre'); pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2); target.replaceChildren(pre);
    }

    async function invoke(tool, args, resultTarget, form) {
      if (form) form.loading = true;
      resultTarget.textContent = 'Running…'; resultTarget.className = 'result';
      try {
        const result = await mcpRequest('tools/call', { name: tool.name, arguments: args || {} });
        if (result && result.isError) throw new Error(parseToolResult(result) || 'Tool returned an error');
        await renderResult(resultTarget, parseToolResult(result), result && result._meta && result._meta['photon/render']);
      } catch (error) { resultTarget.textContent = error instanceof Error ? error.message : String(error); resultTarget.className = 'result error'; }
      finally { if (form) form.loading = false; }
    }

    function renderScreen(screen) {
      const tool = toolForScreen(screen);
      if (!tool) { showEmpty('This screen is not available to the current browser session.'); return; }
      appView.replaceChildren();
      const card = document.createElement('section'); card.className = 'screen';
      const heading = document.createElement('h2'); heading.textContent = screen.label || screen.method; card.appendChild(heading);
      if (tool.description) { const description = document.createElement('p'); description.className = 'screen-description'; description.textContent = tool.description; card.appendChild(description); }
      const formHost = document.createElement('div'); formHost.className = 'form-host'; card.appendChild(formHost);
      const resultTarget = document.createElement('div'); resultTarget.className = 'result'; card.appendChild(resultTarget);
      appView.appendChild(card);
      loadScript('/photon-form.bundle.js').catch(() => loadScript('/beam-form.bundle.js')).then(() => {
        const form = document.createElement('invoke-form');
        form.params = tool.inputSchema || { type: 'object', properties: {} };
        form.photonName = PHOTON; form.methodName = screen.method;
        form.addEventListener('submit', (event) => invoke(tool, event.detail && event.detail.args, resultTarget, form));
        formHost.appendChild(form);
      }).catch((error) => { resultTarget.textContent = error.message; resultTarget.className = 'result error'; });
    }

    function selectScreen(screenId) {
      const screen = navigationItems().find((candidate) => candidate.id === screenId);
      if (!screen || !tools.has(screen.method)) return;
      activeScreen = screen.id; history.pushState({}, '', '?screen=' + encodeURIComponent(activeScreen));
      drawNavigation(navigationItems()); renderScreen(screen);
    }

    window.addEventListener('popstate', () => { const id = new URLSearchParams(location.search).get('screen'); if (id) selectScreen(id); });
    window.addEventListener('message', async (event) => {
      const message = event.data;
      if (event.source !== window || !message || message.jsonrpc !== '2.0' || message.method !== 'tools/call' || message.id == null) return;
      try {
        const tool = tools.get(String(message.params && message.params.name || '').split('/').pop());
        if (!tool) throw new Error('Tool is not available to this browser session');
        const result = await mcpRequest('tools/call', { name: tool.name, arguments: message.params.arguments || {} });
        window.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
      } catch (error) { window.postMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }, '*'); }
    });

    loadTools().then(() => {
      const available = navigationItems();
      drawNavigation(available);
      if (!available.length) { showEmpty(); return; }
      const requested = new URLSearchParams(location.search).get('screen');
      activeScreen = (requested && available.some((item) => item.id === requested) ? requested : available[0].id);
      drawNavigation(available); renderScreen(available.find((screen) => screen.id === activeScreen));
    }).catch((error) => showEmpty(error instanceof Error ? error.message : 'Unable to load application capabilities.'));
  </script>
</body>
</html>`;
}
