/**
 * Playground HTML Template
 *
 * Generates the interactive playground UI for testing MCP tools.
 * This is used by PhotonServer when serving the playground at /playground.
 */

export interface PlaygroundOptions {
  name: string;
  port: number;
}

/**
 * Generate playground HTML for interactive testing
 */
export function generatePlaygroundHTML(options: PlaygroundOptions): string {
  const { name, port } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} - Playground</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f;
      --card: #12121a;
      --border: #1e1e2e;
      --text: #e4e4e7;
      --muted: #71717a;
      --accent: #6366f1;
      --green: #22c55e;
      --orange: #f97316;
      --blue: #3b82f6;
      --purple: #a855f7;
      --cyan: #06b6d4;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .header {
      background: var(--card);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header h1::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--green);
    }
    .badge {
      background: var(--accent);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .container {
      display: grid;
      grid-template-columns: 320px 1fr;
      height: calc(100vh - 57px);
    }
    .status-panel {
      background: white;
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 15px 30px rgba(15, 23, 42, 0.08);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 999px;
      font-weight: 600;
      background: #eef2ff;
      color: var(--accent);
    }
    .status-pill.success {
      background: #dcfce7;
      color: #16a34a;
    }
    .status-pill.error {
      background: #fee2e2;
      color: #ef4444;
    }
    .status-pill.warn {
      background: #fef3c7;
      color: #d97706;
    }
    .status-detail {
      margin-top: 12px;
      color: var(--muted);
      font-size: 14px;
    }
    .status-warnings {
      margin-top: 12px;
      padding: 12px;
      border-radius: 12px;
      background: #fff7ed;
      color: #b45309;
      font-size: 13px;
      display: none;
    }
    .status-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(4, minmax(80px, 1fr));
      gap: 12px;
    }
    .status-card {
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: #f8fafc;
    }
    .status-card-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .status-card-value {
      font-size: 20px;
      font-weight: 600;
      color: var(--text);
    }
    .sidebar {
      background: var(--card);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 16px;
    }
    .sidebar h2 {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    .tool-item {
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tool-item:hover, .tool-item.active {
      border-color: var(--accent);
      background: rgba(99, 102, 241, 0.1);
    }
    .tool-name {
      font-weight: 500;
      font-size: 14px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tool-name .ui-badge {
      background: rgba(34, 197, 94, 0.2);
      color: var(--green);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    .tool-desc {
      font-size: 12px;
      color: var(--muted);
    }
    .main {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .toolbar {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar h3 {
      font-size: 16px;
      flex: 1;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover:not(:disabled) {
      background: #5558e3;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      background: var(--card);
    }
    .tab {
      padding: 12px 24px;
      font-size: 14px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--muted);
      transition: all 0.2s;
    }
    .tab:hover {
      color: var(--text);
    }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .tab-content {
      flex: 1;
      overflow: hidden;
      display: none;
    }
    .tab-content.active {
      display: flex;
      flex-direction: column;
    }
    .panel {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
    }
    .panel-header {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--muted);
    }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      padding: 10px 12px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
    }
    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    .form-note {
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 12px;
      color: var(--muted);
    }
    .form-note strong {
      color: var(--accent);
    }
    #data-form-container {
      margin-bottom: 16px;
    }
    .json-output {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: 'SF Mono', Monaco, 'Fira Code', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-x: auto;
      line-height: 1.5;
    }
    .json-key { color: var(--cyan); }
    .json-string { color: var(--green); }
    .json-number { color: var(--orange); }
    .json-boolean { color: var(--purple); }
    .json-null { color: var(--muted); }
    .json-bracket { color: var(--text); }
    #ui-preview {
      min-height: 200px;
    }
    #ui-preview iframe {
      width: 100%;
      border: none;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--muted);
      text-align: center;
      padding: 40px;
    }
    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(10, 10, 15, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    .loading {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .status-bar {
      padding: 8px 16px;
      background: var(--card);
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
      display: inline-block;
    }
    .dot.success { background: var(--green); }
    .dot.error { background: #ef4444; }
    .dot.loading { background: var(--orange); animation: pulse 1s infinite; }
    .dot.warn { background: #d97706; animation: pulse 1s infinite; }
    .ui-overlay {
      position: absolute;
      inset: 0;
      background: rgba(8, 9, 15, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 30;
    }
    .ui-overlay.active {
      display: flex;
    }
    .overlay-card {
      background: rgba(18, 20, 30, 0.9);
      border: 1px solid rgba(99, 102, 241, 0.4);
      border-radius: 12px;
      padding: 24px 32px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(10, 10, 15, 0.5);
      max-width: 360px;
      width: 100%;
    }
    .overlay-spinner {
      width: 36px;
      height: 36px;
      border: 4px solid rgba(255, 255, 255, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      margin: 0 auto 16px;
      animation: spin 0.8s linear infinite;
    }
    .overlay-progress {
      display: none;
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
    }
    .overlay-progress-bar {
      flex: 1;
      height: 8px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      overflow: hidden;
    }
    .overlay-progress-fill {
      height: 100%;
      width: 0;
      background: var(--accent);
      border-radius: inherit;
      transition: width 0.2s ease;
    }
    .overlay-progress-percent {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
      min-width: 36px;
      text-align: right;
    }
    .overlay-title {
      font-size: 16px;
      font-weight: 600;
      color: white;
      margin-bottom: 6px;
    }
    .overlay-text {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.75);
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${name}</h1>
    <span class="badge">Playground</span>
  </div>
  <div class="container">
    <div class="sidebar">
      <h2>Tools</h2>
      <div id="tools-list">Loading...</div>
    </div>
    <div class="main">
      <div class="status-panel">
        <div class="status-pill" id="status-pill">
          <span class="dot loading" id="status-pill-dot"></span>
          <span id="status-pill-text">Checking status…</span>
        </div>
        <div class="status-detail" id="status-detail">Initializing runtime…</div>
        <div class="status-warnings" id="status-warning"></div>
        <div class="status-grid">
          <div class="status-card">
            <div class="status-card-label">Methods</div>
            <div class="status-card-value" id="summary-tools">0</div>
          </div>
          <div class="status-card">
            <div class="status-card-label">Linked UI</div>
            <div class="status-card-value" id="summary-ui">0</div>
          </div>
          <div class="status-card">
            <div class="status-card-label">Prompts</div>
            <div class="status-card-value" id="summary-prompts">0</div>
          </div>
          <div class="status-card">
            <div class="status-card-label">Resources</div>
            <div class="status-card-value" id="summary-resources">0</div>
          </div>
        </div>
      </div>
      <div class="toolbar">
        <h3 id="selected-tool">Select a tool</h3>
        <button class="btn btn-primary" id="run-btn" disabled style="display: none;">Run</button>
      </div>
      <div class="tabs" id="tabs" style="display: none;">
        <div class="tab active" data-tab="ui">UI</div>
        <div class="tab" data-tab="data">Data</div>
      </div>
      <div class="tab-content active" id="tab-ui">
        <div class="panel">
          <div id="ui-form-container"></div>
          <div class="panel-header" id="ui-results-header" style="display: none;">Results</div>
          <div id="ui-preview">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <p>Select a tool and fill the form to see results</p>
            </div>
          </div>
        </div>
      </div>
      <div class="tab-content" id="tab-data">
        <div class="panel">
          <div class="panel-header">Raw JSON Data</div>
          <div class="json-output" id="output">// Run a tool to see raw JSON data</div>
        </div>
      </div>
      <div class="status-bar">
        <span class="dot" id="status-dot"></span>
        <span id="status-text">Ready</span>
      </div>
      <div class="ui-overlay" id="execution-overlay">
        <div class="overlay-card">
          <div class="overlay-spinner" id="overlay-spinner"></div>
          <div class="overlay-progress" id="overlay-progress">
            <div class="overlay-progress-bar">
              <div class="overlay-progress-fill" id="overlay-progress-fill"></div>
            </div>
            <div class="overlay-progress-percent" id="overlay-progress-percent">0%</div>
          </div>
          <div class="overlay-title" id="overlay-title">Preparing tool...</div>
          <div class="overlay-text" id="overlay-text">Please wait while the tool runs.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let photons = [];
    let tools = [];
    let selectedTool = null;
    let selectedPhoton = null;
    let lastResult = null;
    let currentProgressToken = null;
    let currentRequestId = null;

    const overlayElement = document.getElementById('execution-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayText = document.getElementById('overlay-text');
    const overlaySpinner = document.getElementById('overlay-spinner');
    const overlayProgress = document.getElementById('overlay-progress');
    const overlayProgressFill = document.getElementById('overlay-progress-fill');
    const overlayProgressPercent = document.getElementById('overlay-progress-percent');
    const statusElements = {
      pill: document.getElementById('status-pill'),
      pillDot: document.getElementById('status-pill-dot'),
      pillText: document.getElementById('status-pill-text'),
      detail: document.getElementById('status-detail'),
      warning: document.getElementById('status-warning'),
      summaryTools: document.getElementById('summary-tools'),
      summaryUI: document.getElementById('summary-ui'),
      summaryPrompts: document.getElementById('summary-prompts'),
      summaryResources: document.getElementById('summary-resources'),
    };
    let statusSource = null;

    function showOverlay(title, text, progress = null) {
      overlayElement.classList.add('active');
      overlayTitle.textContent = title || 'Working...';
      overlayText.textContent = text || '';
      updateOverlayProgress(progress);
    }

    function hideOverlay() {
      overlayElement.classList.remove('active');
      updateOverlayProgress(null);
    }

    function updateOverlayProgress(progress) {
      if (typeof progress === 'number' && !Number.isNaN(progress)) {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        overlaySpinner.style.display = 'none';
        overlayProgress.style.display = 'flex';
        overlayProgressFill.style.width = percent + '%';
        overlayProgressPercent.textContent = percent + '%';
      } else {
        overlaySpinner.style.display = 'block';
        overlayProgress.style.display = 'none';
        overlayProgressFill.style.width = '0%';
        overlayProgressPercent.textContent = '';
      }
    }

    async function loadTools() {
      const res = await fetch('/api/photons');
      const data = await res.json();
      photons = data.photons;
      // Flatten all tools from all photons
      tools = photons.flatMap(p => p.tools.map(t => ({
        ...t,
        photon: p.name,
        photonFile: p.file
      })));
      renderToolsList();
    }

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        renderStatus(data);
      } catch (error) {
        if (statusElements.pill) {
          statusElements.pill.className = 'status-pill warn';
          statusElements.pillDot.className = 'dot warn';
          statusElements.pillText.textContent = 'Status unavailable';
          statusElements.detail.textContent = 'Unable to connect to Photon runtime.';
        }
      }
    }

    function subscribeStatus() {
      if (statusSource) {
        statusSource.close();
      }
      const source = new EventSource('/api/status-stream');
      statusSource = source;
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          renderStatus(payload);
        } catch (error) {
          // ignore malformed payloads
        }
      };
      source.onerror = () => {
        source.close();
        setTimeout(subscribeStatus, 3000);
      };
    }

    function renderStatus(data) {
      if (!data || !statusElements.pill) return;
      const state = data.status || {};
      const type = state.type || 'info';
      statusElements.pill.className = 'status-pill ' + type;
      const dotClass = type === 'success' ? 'dot success' : type === 'error' ? 'dot error' : type === 'warn' ? 'dot warn' : 'dot loading';
      statusElements.pillDot.className = dotClass;
      statusElements.pillText.textContent = state.message || 'Ready';

      if (data.hotReloadDisabled) {
        statusElements.detail.textContent = 'Hot reload paused after repeated errors. Restart dev server after fixing issues.';
      } else if (data.devMode) {
        statusElements.detail.textContent = 'Dev mode with hot reload and live playground.';
      } else {
        statusElements.detail.textContent = 'Standard runtime mode.';
      }

      const warnings = data.warnings || [];
      if (warnings.length > 0) {
        statusElements.warning.style.display = 'block';
        statusElements.warning.innerHTML = warnings.map(w => '⚠️ ' + w).join('<br>');
      } else {
        statusElements.warning.style.display = 'none';
        statusElements.warning.innerHTML = '';
      }

      const summary = data.summary || {};
      statusElements.summaryTools.textContent = summary.toolCount ?? tools.length;
      statusElements.summaryUI.textContent = summary.uiAssets?.length ?? 0;
      statusElements.summaryPrompts.textContent = summary.promptCount ?? 0;
      statusElements.summaryResources.textContent = summary.resourceCount ?? 0;
    }

    function renderToolsList() {
      const container = document.getElementById('tools-list');
      if (photons.length === 0) {
        container.innerHTML = '<div style="color: var(--muted); padding: 12px; text-align: center;">No photons found</div>';
        return;
      }

      container.innerHTML = photons.map(photon => {
        const toolsHtml = photon.tools.map(t => \`
          <div class="tool-item" data-tool="\${t.name}" data-photon="\${photon.name}">
            <div class="tool-name">
              \${t.name}
              \${t.ui ? '<span class="ui-badge">UI</span>' : ''}
            </div>
            <div class="tool-desc">\${t.description || 'No description'}</div>
          </div>
        \`).join('');

        return \`
          <div class="photon-group">
            <div class="photon-header" data-photon="\${photon.name}">
              <span class="photon-toggle">▶</span>
              <span class="photon-name">\${photon.name}</span>
              <span class="photon-count">\${photon.tools.length}</span>
            </div>
            <div class="photon-tools collapsed">
              \${toolsHtml}
            </div>
          </div>
        \`;
      }).join('');

      // Add click handlers for photon headers
      container.querySelectorAll('.photon-header').forEach(el => {
        el.addEventListener('click', () => {
          const toolsDiv = el.nextElementSibling;
          const toggle = el.querySelector('.photon-toggle');
          toolsDiv.classList.toggle('collapsed');
          toggle.textContent = toolsDiv.classList.contains('collapsed') ? '▶' : '▼';
        });
      });

      // Add click handlers for tools
      container.querySelectorAll('.tool-item').forEach(el => {
        el.addEventListener('click', () => {
          selectedPhoton = el.dataset.photon;
          selectTool(el.dataset.tool);
        });
      });

      // Auto-expand first photon
      const firstToggle = container.querySelector('.photon-toggle');
      const firstTools = container.querySelector('.photon-tools');
      if (firstToggle && firstTools) {
        firstTools.classList.remove('collapsed');
        firstToggle.textContent = '▼';
      }
    }

    function setUIPreviewMessage(title, description) {
      document.getElementById('ui-preview').innerHTML = \`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <p style="font-weight: 600; color: var(--text);">\${title}</p>
          \${description ? '<p style="margin-top: 6px; color: var(--muted); font-size: 13px;">' + description + '</p>' : ''}
        </div>
      \`;
    }

    function selectTool(name) {
      selectedTool = tools.find(t => t.name === name);
      document.querySelectorAll('.tool-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tool === name);
      });
      document.getElementById('selected-tool').textContent = name;

      // Show tabs
      document.getElementById('tabs').style.display = 'flex';

      // Clear previous forms/placeholders
      setUIPreviewMessage('Fill the form to see results', 'Enter parameters below and run the tool.');
      document.getElementById('ui-form-container').innerHTML = '';

      const hasUI = Boolean(selectedTool.ui);

      // Check if tool has required parameters
      const props = selectedTool.inputSchema?.properties || {};
      const required = selectedTool.inputSchema?.required || [];
      const hasRequiredParams = required.length > 0;

      // Always switch to UI tab and show form
      switchTab('ui');

      if (hasRequiredParams) {
        showParamsForm();
      } else {
        // Auto-run for tools with no params
        setUIPreviewMessage('Running tool...', 'Loading results...');
        runTool();
      }
    }

    function showParamsForm() {
      const props = selectedTool.inputSchema?.properties || {};
      const required = selectedTool.inputSchema?.required || [];

      const formHtml = \`
        <div class="form-note">
          <strong>Input Parameters</strong><br>
          Fill in the parameters below and click Run to execute the tool.
        </div>
        <div id="params-form">
          \${Object.entries(props).map(([name, schema]) => {
            const isRequired = required.includes(name);
            const desc = schema.description || '';
            if (schema.enum) {
              return \`
                <div class="form-group">
                  <label>\${name}\${isRequired ? ' *' : ''}</label>
                  <select name="\${name}">
                    <option value="">Select...</option>
                    \${schema.enum.map(v => \`<option value="\${v}">\${v}</option>\`).join('')}
                  </select>
                  \${desc ? \`<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">\${desc}</div>\` : ''}
                </div>
              \`;
            }
            const inputType = schema.type === 'number' ? 'number' : 'text';
            const isLongText = desc.length > 50 || name.toLowerCase().includes('content') || name.toLowerCase().includes('body');
            if (isLongText && schema.type === 'string') {
              return \`
                <div class="form-group">
                  <label>\${name}\${isRequired ? ' *' : ''}</label>
                  <textarea name="\${name}" placeholder="\${desc}"></textarea>
                </div>
              \`;
            }
            return \`
              <div class="form-group">
                <label>\${name}\${isRequired ? ' *' : ''}</label>
                <input type="\${inputType}" name="\${name}" placeholder="\${desc}" />
              </div>
            \`;
          }).join('')}
        </div>
        <button class="btn btn-primary" onclick="runTool()" style="margin-top: 16px;">Run Tool</button>
      \`;

      // Always render form in UI tab
      document.getElementById('ui-form-container').innerHTML = formHtml;
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tabName));
    }

    function syntaxHighlight(json) {
      if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
      }
      return json.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
            match = match.slice(0, -1) + '</span><span class="json-bracket">:</span>';
            return '<span class="' + cls + '">' + match;
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      });
    }

    function setStatus(status, text, progress = null) {
      const dot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      const dotState = status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'warn' ? 'warn' : 'loading';
      dot.className = 'dot ' + dotState;
      statusText.textContent = text;

      // Remove existing progress bar if any
      const existingBar = document.getElementById('status-progress');
      if (existingBar) existingBar.remove();

      if (progress !== null) {
        const bar = document.createElement('div');
        bar.id = 'status-progress';
        bar.style.width = '100px';
        bar.style.height = '4px';
        bar.style.background = 'var(--border)';
        bar.style.borderRadius = '2px';
        bar.style.marginLeft = '12px';
        bar.style.overflow = 'hidden';

        const fill = document.createElement('div');
        fill.style.width = (progress * 100) + '%';
        fill.style.height = '100%';
        fill.style.background = 'var(--accent)';
        fill.style.transition = 'width 0.2s';

        bar.appendChild(fill);
        statusText.parentElement.appendChild(bar);
      }
    }

    async function runTool() {
      if (!selectedTool) return;

      const progressToken = 'progress_' + Date.now();
      const requestId = 'req_' + Date.now();
      currentProgressToken = progressToken;
      currentRequestId = requestId;

      setStatus('loading', 'Executing ' + selectedTool.name + '...');
      showOverlay('Executing ' + selectedTool.name, 'Starting tool...');

      const args = {};
      document.querySelectorAll('#params-form input, #params-form select, #params-form textarea').forEach(el => {
        if (el.value) {
          const schema = selectedTool.inputSchema?.properties?.[el.name];
          args[el.name] = schema?.type === 'number' ? Number(el.value) : el.value;
        }
      });

      // Clear output
      document.getElementById('output').textContent = '// Waiting for response...';

      try {
        const response = await fetch('/api/call-stream', {
          method: 'POST',
          body: JSON.stringify({ tool: selectedTool.name, args, progressToken, requestId }),
        });

        if (!response.ok || !response.body) {
          throw new Error('Unable to start tool execution');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const segments = buffer.split('\\n\\n');
          buffer = segments.pop() || '';

          for (const segment of segments) {
            const dataLine = segment.split('\\n').find(line => line.startsWith('data: '));
            if (!dataLine) continue;
            let payload;
            try {
              payload = JSON.parse(dataLine.slice(6));
            } catch (e) {
              console.error('Invalid payload from server', e);
              continue;
            }
            if (handleServerMessage(payload)) {
              finished = true;
              break;
            }
          }
        }
      } catch (err) {
        document.getElementById('output').innerHTML = '<span style="color: #ef4444;">Error: ' + err.message + '</span>';
        switchTab('data');
        setStatus('error', 'Error: ' + err.message);
      }
    }

    function handleServerMessage(payload) {
      if (!payload) {
        return false;
      }

      if (payload.method === 'notifications/progress') {
        const params = payload.params || {};
        const total = typeof params.total === 'number' ? params.total : 100;
        const rawProgress = typeof params.progress === 'number' ? params.progress : 0;
        const ratio = total ? rawProgress / total : rawProgress;
        const normalized = Math.max(0, Math.min(ratio <= 1 ? ratio : ratio / 100, 1));
        const message = params.message || 'Processing...';
        setStatus('loading', message, normalized);
        showOverlay('Processing', message, normalized);
        return false;
      }

      if (payload.method === 'notifications/status') {
        const params = payload.params || {};
        const statusType = params.type || 'info';
        const message = params.message || 'Working...';
        const target = statusType === 'success' ? 'success' : statusType === 'error' ? 'error' : 'loading';
        setStatus(target, message);
        if (statusType === 'error') {
          showOverlay('Action needed', message);
        }
        return false;
      }

      if (payload.method === 'notifications/emit') {
        const event = payload.params?.event;
        if (event?.emit === 'status') {
          setStatus('loading', event.message || 'Working...');
        }
        return false;
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
        hideOverlay();
        if (payload.error) {
          document.getElementById('output').innerHTML = '<span style="color: #ef4444;">Error: ' + (payload.error.message || JSON.stringify(payload.error)) + '</span>';
          switchTab('data');
          setStatus('error', 'Error: ' + (payload.error.message || 'Unknown error'));
        } else if (payload.result) {
          handleResult(payload.result);
        }
        return true;
      }

      return false;
    }

    async function handleResult(result) {
      lastResult = result.data;

      // Update data tab with syntax highlighting
      document.getElementById('output').innerHTML = syntaxHighlight(JSON.stringify(result.data, null, 2));

      // Clear form from UI tab
      document.getElementById('ui-form-container').innerHTML = '';
      document.getElementById('ui-results-header').style.display = 'block';

      // If tool has linked UI, render it in iframe
      if (selectedTool.ui) {
        const uiRes = await fetch('/api/ui/' + selectedTool.ui.id);
        let html = await uiRes.text();
        html = html.replace('window.__PHOTON_DATA__', JSON.stringify(result.data));
        const blob = new Blob([html], { type: 'text/html' });
        document.getElementById('ui-preview').innerHTML = \`<iframe src="\${URL.createObjectURL(blob)}" style="width: 100%; height: 600px; border: 1px solid var(--border); border-radius: 8px;"></iframe>\`;
      } else {
        // Auto-render data using Auto-UI components
        document.getElementById('ui-preview').innerHTML = renderAutoUI(result.data);
      }

      setStatus('success', 'Completed successfully');
    }

    function renderAutoUI(data) {
      // Auto-detect data structure and render appropriately
      if (Array.isArray(data)) {
        if (data.length === 0) {
          return '<div class="empty-state"><p>No results found</p></div>';
        }
        // Render as list of cards
        return \`<div style="display: flex; flex-direction: column; gap: 12px; padding: 16px;">\${data.map(item => renderCard(item)).join('')}</div>\`;
      } else if (typeof data === 'object' && data !== null) {
        // Single object - render as card
        return \`<div style="padding: 16px;">\${renderCard(data)}</div>\`;
      } else {
        // Primitive value
        return \`<div style="padding: 16px; color: var(--text);">\${String(data)}</div>\`;
      }
    }

    function renderCard(item) {
      if (typeof item !== 'object' || item === null) {
        return \`<div style="padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 8px;">\${String(item)}</div>\`;
      }

      const entries = Object.entries(item);
      const title = item.title || item.name || item.id || entries[0]?.[1] || 'Item';
      const description = item.description || item.snippet || item.summary || '';
      const url = item.url || item.link || item.href || '';

      return \`
        <div style="padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: 8px;">
          <div style="font-weight: 600; font-size: 15px; color: var(--text); margin-bottom: 6px;">\${escapeHtml(String(title))}</div>
          \${description ? \`<div style="color: var(--muted); font-size: 13px; margin-bottom: 8px;">\${escapeHtml(String(description))}</div>\` : ''}
          \${url ? \`<a href="\${escapeHtml(url)}" target="_blank" style="color: var(--accent); font-size: 12px; text-decoration: none;">View →</a>\` : ''}
          \${!description && !url ? \`<div style="color: var(--muted); font-size: 12px; margin-top: 6px;">\${entries.slice(1).map(([k, v]) => \`<div><strong>\${k}:</strong> \${String(v)}</div>\`).join('')}</div>\` : ''}
        </div>
      \`;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    loadTools();
    loadStatus();
    subscribeStatus();
  </script>
</body>
</html>`;
}
