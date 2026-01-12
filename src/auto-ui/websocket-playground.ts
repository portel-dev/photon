/**
 * Enhanced Playground Server with Elicitation Support
 * 
 * Uses SSE for server->client and POST for client->server communication
 */

import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger } from '../shared/logger.js';
import {
  SchemaExtractor,
  executeGenerator,
  isAsyncGenerator,
  type PhotonYield,
  type EmitYield,
  type OutputHandler,
  type InputProvider
} from '@portel/photon-core';

interface PhotonInfo {
  name: string;
  path: string;
  methods: MethodInfo[];
}

interface MethodInfo {
  name: string;
  description: string;
  params: any;
  returns: any;
}

interface InvokeRequest {
  type: 'invoke';
  photon: string;
  method: string;
  args: Record<string, any>;
}

interface ElicitationResponse {
  type: 'elicitation_response';
  value: any;
}

type ClientMessage = InvokeRequest | ElicitationResponse;

export async function startWebSocketPlayground(workingDir: string, port: number): Promise<void> {
  // Discover all photons
  const photonList = await listPhotonMCPs(workingDir);
  
  if (photonList.length === 0) {
    logger.warn('No photons found in ' + workingDir);
    console.log('\nCreate a photon with: photon maker new <name>');
    process.exit(1);
  }

  // Extract metadata for all photons
  const photons: PhotonInfo[] = [];
  const photonInstances = new Map<string, any>();
  
  // Use PhotonLoader for proper dependency management
  const loader = new PhotonLoader(false, logger);

  for (const name of photonList) {
    const photonPath = await resolvePhotonPath(name, workingDir);
    if (!photonPath) continue;

    try {
      // Load photon using PhotonLoader (handles deps, TypeScript, injections)
      const mcp = await loader.loadFile(photonPath);
      const instance = mcp.instance;

      if (!instance) {
        logger.warn(`Failed to get instance for ${name}`);
        continue;
      }

      photonInstances.set(name, instance);

      // Extract schema for UI
      const extractor = new SchemaExtractor();
      const schemas = await extractor.extractFromFile(photonPath);

      // Filter out lifecycle methods
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => ({
          name: schema.name,
          description: schema.description || '',
          params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' }
        }));

      photons.push({
        name,
        path: photonPath,
        methods
      });
    } catch (error) {
      logger.warn(`Failed to load ${name}: ${error}`);
    }
  }

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateWebSocketHTML(photons, port));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    logger.info('Client connected to playground');

    // Send photon list on connection
    ws.send(JSON.stringify({
      type: 'photons',
      data: photons
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        if (message.type === 'invoke') {
          await handleInvoke(ws, message, photonInstances);
        } else if (message.type === 'elicitation_response') {
          // Store response for pending elicitation
          if ((ws as any).pendingElicitation) {
            (ws as any).pendingElicitation.resolve(message.value);
            (ws as any).pendingElicitation = null;
          }
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', () => {
      logger.info('Client disconnected from playground');
    });
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    logger.info(`🎮 Photon Playground running at ${url}`);
    logger.info(`   ${photons.length} photon(s) available`);
    console.log(`\n🎮 Open ${url} in your browser\n`);
  });
}

async function handleInvoke(
  ws: WebSocket, 
  request: InvokeRequest, 
  photonInstances: Map<string, any>
): Promise<void> {
  const { photon, method, args } = request;
  
  const instance = photonInstances.get(photon);
  if (!instance) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Photon not found: ${photon}`
    }));
    return;
  }

  if (typeof instance[method] !== 'function') {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Method not found: ${method}`
    }));
    return;
  }

  try {
    const methodResult = instance[method](args);

    if (isAsyncGenerator(methodResult)) {
      // Handle generator with yields
      const outputHandler: OutputHandler = (yieldValue: PhotonYield) => {
        ws.send(JSON.stringify({
          type: 'yield',
          data: yieldValue
        }));
      };

      const inputProvider: InputProvider = async (yieldValue: PhotonYield): Promise<any> => {
        // Send elicitation request
        ws.send(JSON.stringify({
          type: 'elicitation',
          data: yieldValue
        }));

        // Wait for response
        return new Promise((resolve, reject) => {
          (ws as any).pendingElicitation = { resolve, reject };
          
          // Timeout after 5 minutes
          setTimeout(() => {
            if ((ws as any).pendingElicitation) {
              (ws as any).pendingElicitation = null;
              reject(new Error('Elicitation timeout'));
            }
          }, 300000);
        });
      };

      const result = await executeGenerator(methodResult as AsyncGenerator<PhotonYield, any, any>, { 
        inputProvider,
        outputHandler
      });
      
      ws.send(JSON.stringify({
        type: 'result',
        data: result
      }));
    } else {
      // Regular method
      const result = await methodResult;
      ws.send(JSON.stringify({
        type: 'result',
        data: result
      }));
    }
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }));
  }
}

function generateWebSocketHTML(photons: PhotonInfo[], port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photon Playground</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      display: flex;
      height: 100vh;
    }

    .sidebar {
      width: 280px;
      background: #252525;
      border-right: 1px solid #333;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .sidebar-header {
      padding: 20px;
      border-bottom: 1px solid #333;
    }

    .sidebar-header h1 {
      font-size: 18px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sidebar-header p {
      font-size: 13px;
      color: #888;
    }

    .photon-list {
      flex: 1;
      overflow-y: auto;
    }

    .photon-item {
      border-bottom: 1px solid #333;
    }

    .photon-header {
      padding: 12px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #2a2a2a;
      user-select: none;
    }

    .photon-header:hover {
      background: #303030;
    }

    .photon-header.active {
      background: #1e88e5;
      color: white;
    }

    .photon-name {
      font-weight: 500;
      font-size: 14px;
    }

    .method-count {
      font-size: 12px;
      color: #888;
      background: #333;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .method-list {
      display: none;
      background: #222;
    }

    .method-list.expanded {
      display: block;
    }

    .method-item {
      padding: 10px 20px 10px 40px;
      cursor: pointer;
      font-size: 13px;
      color: #bbb;
    }

    .method-item:hover {
      background: #2a2a2a;
      color: #fff;
    }

    .method-item.selected {
      background: #1565c0;
      color: white;
    }

    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .method-header {
      padding: 20px 30px;
      border-bottom: 1px solid #333;
      background: #202020;
    }

    .method-header h2 {
      font-size: 22px;
      margin-bottom: 8px;
    }

    .method-header p {
      color: #888;
      font-size: 14px;
    }

    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #333;
      background: #202020;
      padding: 0 30px;
    }

    .tab {
      padding: 12px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: #888;
      font-size: 14px;
      font-weight: 500;
    }

    .tab:hover {
      color: #fff;
    }

    .tab.active {
      color: #1e88e5;
      border-bottom-color: #1e88e5;
    }

    .tab-content {
      flex: 1;
      padding: 30px;
      overflow-y: auto;
    }

    .tab-panel {
      display: none;
    }

    .tab-panel.active {
      display: block;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      font-weight: 500;
    }

    .form-group label .required {
      color: #ef5350;
      margin-left: 4px;
    }

    .form-group label .hint {
      color: #888;
      font-weight: normal;
      font-size: 13px;
      margin-left: 8px;
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 10px 12px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 14px;
      font-family: inherit;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #1e88e5;
    }

    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }

    .btn {
      padding: 10px 24px;
      background: #1e88e5;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      text-transform: capitalize;
    }

    .btn:hover {
      background: #1976d2;
    }

    .btn:disabled {
      background: #444;
      cursor: not-allowed;
    }

    .progress-container {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 24px 32px;
      background: #2a2a2a;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      z-index: 100;
      min-width: 280px;
      display: none;
    }

    .progress-container.visible {
      display: block;
    }

    .progress-item {
      padding: 8px 0;
      font-size: 14px;
      color: #e0e0e0;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #444;
      border-top-color: #1e88e5;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-bar {
      flex: 1;
      height: 6px;
      background: #444;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: #1e88e5;
      transition: width 0.3s;
    }

    .result-container {
      margin-top: 20px;
      display: none;
    }

    .result-container.visible {
      display: block;
    }

    .result-header {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .result-content {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 20px;
      font-size: 14px;
      line-height: 1.6;
    }

    .result-list {
      list-style: none;
    }

    .result-list li {
      padding: 15px;
      margin-bottom: 10px;
      background: #222;
      border-radius: 4px;
      border-left: 3px solid #1e88e5;
    }

    .result-list a {
      color: #1e88e5;
      text-decoration: none;
      font-weight: 600;
    }

    .result-list a:hover {
      text-decoration: underline;
    }

    .result-content h1,
    .result-content h2,
    .result-content h3 {
      margin-top: 1em;
      margin-bottom: 0.5em;
    }

    .result-content p {
      margin-bottom: 1em;
    }

    .result-content blockquote {
      border-left: 4px solid #444;
      padding-left: 16px;
      margin: 1em 0;
      color: #888;
    }

    .result-content code {
      background: #222;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9em;
    }

    .result-content pre {
      background: #222;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 1em 0;
    }

    .result-content pre code {
      background: none;
      padding: 0;
    }

    .elicitation-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .elicitation-modal.visible {
      display: flex;
    }

    .elicitation-content {
      background: #2a2a2a;
      padding: 30px;
      border-radius: 8px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    }

    .elicitation-content h3 {
      margin-bottom: 20px;
      font-size: 18px;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .empty-state h3 {
      font-size: 18px;
      margin-bottom: 10px;
    }

    .empty-state p {
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>📸 Photon Playground</h1>
      <p id="photon-count">Loading...</p>
    </div>
    <div class="photon-list" id="photon-list"></div>
  </div>

  <div class="main-content">
    <div id="empty-state" class="empty-state">
      <h3>Select a method to begin</h3>
      <p>Choose a photon and method from the sidebar</p>
    </div>

    <div id="method-view" style="display: none; flex: 1; display: flex; flex-direction: column;">
      <div class="method-header">
        <h2 id="method-title"></h2>
        <p id="method-description"></p>
      </div>

      <div class="tabs">
        <div class="tab active" data-tab="ui">UI</div>
        <div class="tab" data-tab="data">Data</div>
      </div>

      <div class="tab-content">
        <div class="tab-panel active" id="ui-panel">
          <form id="invoke-form"></form>
          <div class="progress-container" id="progress-container"></div>
          <div class="result-container" id="result-container">
            <div class="result-header">Result</div>
            <div class="result-content" id="result-content"></div>
          </div>
        </div>

        <div class="tab-panel" id="data-panel">
          <pre><code id="data-content">No data yet</code></pre>
        </div>
      </div>
    </div>
  </div>

  <div class="elicitation-modal" id="elicitation-modal">
    <div class="elicitation-content">
      <h3 id="elicitation-title"></h3>
      <div id="elicitation-form"></div>
    </div>
  </div>

  <script>
    let ws;
    let photons = [];
    let currentPhoton = null;
    let currentMethod = null;

    function connect() {
      ws = new WebSocket('ws://localhost:${port}');

      ws.onopen = () => {
        console.log('Connected to playground');
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };

      ws.onclose = () => {
        console.log('Disconnected from playground');
        setTimeout(connect, 1000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    }

    function handleMessage(message) {
      switch (message.type) {
        case 'photons':
          photons = message.data;
          renderPhotonList();
          break;
        case 'yield':
          handleYield(message.data);
          break;
        case 'result':
          handleResult(message.data);
          break;
        case 'error':
          handleError(message.message);
          break;
        case 'elicitation':
          showElicitation(message.data);
          break;
      }
    }

    function renderPhotonList() {
      const list = document.getElementById('photon-list');
      const count = document.getElementById('photon-count');
      
      count.textContent = \`\${photons.length} photon(s) available\`;
      
      list.innerHTML = photons.map(photon => \`
        <div class="photon-item">
          <div class="photon-header" onclick="togglePhoton('\${photon.name}')">
            <span class="photon-name">\${photon.name}</span>
            <span class="method-count">\${photon.methods.length}</span>
          </div>
          <div class="method-list" id="methods-\${photon.name}">
            \${photon.methods.map(method => \`
              <div class="method-item" onclick="selectMethod('\${photon.name}', '\${method.name}')">
                \${method.name}
              </div>
            \`).join('')}
          </div>
        </div>
      \`).join('');
    }

    function togglePhoton(photonName) {
      const methodList = document.getElementById(\`methods-\${photonName}\`);
      methodList.classList.toggle('expanded');
    }

    function selectMethod(photonName, methodName) {
      currentPhoton = photons.find(p => p.name === photonName);
      currentMethod = currentPhoton.methods.find(m => m.name === methodName);
      
      // Update selection
      document.querySelectorAll('.method-item').forEach(el => {
        el.classList.remove('selected');
      });
      event.target.classList.add('selected');
      
      // Show method view
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('method-view').style.display = 'flex';
      
      // Update header
      document.getElementById('method-title').textContent = \`\${photonName}.\${methodName}()\`;
      document.getElementById('method-description').textContent = currentMethod.description || 'No description';
      
      // Render form
      renderForm();
      
      // Clear previous results
      document.getElementById('progress-container').classList.remove('visible');
      document.getElementById('result-container').classList.remove('visible');
    }

    function renderForm() {
      const form = document.getElementById('invoke-form');
      const params = currentMethod.params;
      const properties = params.properties || {};
      const required = params.required || [];
      
      let html = '';
      
      for (const [key, schema] of Object.entries(properties)) {
        const isRequired = required.includes(key);
        const description = schema.description || '';
        
        html += \`
          <div class="form-group">
            <label>
              \${key}
              \${isRequired ? '<span class="required">*</span>' : ''}
              \${description ? \`<span class="hint">- \${description}</span>\` : ''}
            </label>
            <input type="text" name="\${key}" \${isRequired ? 'required' : ''} />
          </div>
        \`;
      }
      
      html += \`<button type="submit" class="btn">\${currentMethod.name}</button>\`;
      
      form.innerHTML = html;
      form.onsubmit = handleSubmit;
    }

    function handleSubmit(e) {
      e.preventDefault();
      
      const formData = new FormData(e.target);
      const args = {};
      
      for (const [key, value] of formData.entries()) {
        args[key] = value;
      }
      
      // Clear previous results
      document.getElementById('progress-container').innerHTML = '';
      document.getElementById('progress-container').classList.add('visible');
      document.getElementById('result-container').classList.remove('visible');
      
      // Send invoke request
      ws.send(JSON.stringify({
        type: 'invoke',
        photon: currentPhoton.name,
        method: currentMethod.name,
        args
      }));
    }

    function handleYield(data) {
      const container = document.getElementById('progress-container');
      container.classList.add('visible');

      // Replace content instead of appending - show only current status
      if (data.emit === 'status') {
        container.innerHTML = \`
          <div class="progress-item">
            <div class="spinner"></div>
            <span>\${data.message}</span>
          </div>
        \`;
      } else if (data.emit === 'progress') {
        const percent = Math.round((data.value || 0) * 100);
        container.innerHTML = \`
          <div class="progress-item">
            <span>\${data.message || 'Progress'}</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: \${percent}%"></div>
            </div>
            <span>\${percent}%</span>
          </div>
        \`;
      }
    }

    function handleResult(data) {
      // Hide progress when result arrives
      document.getElementById('progress-container').classList.remove('visible');
      document.getElementById('progress-container').innerHTML = '';

      const container = document.getElementById('result-container');
      const content = document.getElementById('result-content');

      container.classList.add('visible');
      
      if (Array.isArray(data)) {
        content.innerHTML = \`
          <ul class="result-list">
            \${data.map(item => renderResultItem(item)).join('')}
          </ul>
        \`;
      } else if (typeof data === 'string') {
        content.innerHTML = renderMarkdown(data);
      } else {
        content.innerHTML = \`<pre>\${JSON.stringify(data, null, 2)}</pre>\`;
      }
      
      // Update data tab
      document.getElementById('data-content').textContent = JSON.stringify(data, null, 2);
    }

    function renderResultItem(item) {
      if (typeof item === 'string') {
        return \`<li>\${renderMarkdown(item)}</li>\`;
      }
      return \`<li><pre>\${JSON.stringify(item, null, 2)}</pre></li>\`;
    }

    function renderMarkdown(text) {
      // Simple markdown rendering
      let html = text;

      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

      // Bold
      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

      // Italic
      html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

      // Headers
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // Blockquotes (> at start of line)
      html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

      // Code blocks
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // Line breaks within paragraphs
      html = html.replace(/\\n/g, '<br>');

      return html;
    }

    function handleError(message) {
      // Hide progress on error
      document.getElementById('progress-container').classList.remove('visible');
      document.getElementById('progress-container').innerHTML = '';

      const container = document.getElementById('result-container');
      const content = document.getElementById('result-content');

      container.classList.add('visible');
      content.innerHTML = \`<p style="color: #ef5350;">Error: \${message}</p>\`;
    }

    function showElicitation(data) {
      const modal = document.getElementById('elicitation-modal');
      const title = document.getElementById('elicitation-title');
      const form = document.getElementById('elicitation-form');

      title.textContent = data.message || 'Input Required';

      // Render elicitation form based on ask type
      let html = '';

      if (data.ask === 'text' || data.ask === 'password') {
        const inputType = data.ask === 'password' ? 'password' : 'text';
        html = \`
          <div class="form-group">
            <input type="\${inputType}" id="elicitation-input" placeholder="\${data.placeholder || ''}" value="\${data.default || ''}" />
          </div>
        \`;
      } else if (data.ask === 'select') {
        const options = (data.options || []).map(opt => {
          const value = typeof opt === 'string' ? opt : opt.value;
          const label = typeof opt === 'string' ? opt : opt.label;
          return \`<option value="\${value}">\${label}</option>\`;
        }).join('');
        html = \`
          <div class="form-group">
            <select id="elicitation-input">\${options}</select>
          </div>
        \`;
      } else if (data.ask === 'confirm') {
        html = \`
          <div class="form-group" style="display: flex; gap: 10px;">
            <button class="btn" onclick="submitElicitationValue(true)" style="background: #4caf50;">Yes</button>
            <button class="btn" onclick="submitElicitationValue(false)" style="background: #f44336;">No</button>
          </div>
        \`;
        form.innerHTML = html;
        modal.classList.add('visible');
        return;
      } else if (data.ask === 'number') {
        html = \`
          <div class="form-group">
            <input type="number" id="elicitation-input"
              \${data.min !== undefined ? \`min="\${data.min}"\` : ''}
              \${data.max !== undefined ? \`max="\${data.max}"\` : ''}
              \${data.step !== undefined ? \`step="\${data.step}"\` : ''}
              value="\${data.default || ''}" />
          </div>
        \`;
      }

      html += \`<button class="btn" onclick="submitElicitation()">Submit</button>\`;

      form.innerHTML = html;
      modal.classList.add('visible');
    }

    function submitElicitationValue(value) {
      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value
      }));
      document.getElementById('elicitation-modal').classList.remove('visible');
    }

    function submitElicitation() {
      const input = document.getElementById('elicitation-input');
      const value = input.value;
      
      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value
      }));
      
      document.getElementById('elicitation-modal').classList.remove('visible');
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        
        tab.classList.add('active');
        document.getElementById(\`\${tabName}-panel\`).classList.add('active');
      });
    });

    // Connect on load
    connect();
  </script>
</body>
</html>`;
}
