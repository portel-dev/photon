/**
 * Multi-Photon Playground Server
 * 
 * Serves an interactive UI for testing all installed photons
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonServer } from '../server.js';
import { logger } from '../shared/logger.js';
import { SchemaExtractor } from '@portel/photon-core';

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

export async function startPlaygroundServer(workingDir: string, port: number): Promise<void> {
  // Discover all photons
  const photonList = await listPhotonMCPs(workingDir);
  
  if (photonList.length === 0) {
    logger.warn('No photons found in ' + workingDir);
    console.log('\nCreate a photon with: photon maker new <name>');
    process.exit(1);
  }

  // Extract metadata for all photons
  const photons: PhotonInfo[] = [];
  
  for (const name of photonList) {
    const photonPath = await resolvePhotonPath(name, workingDir);
    if (!photonPath) continue;

    try {
      const extractor = new SchemaExtractor();
      const schemas = await extractor.extractFromFile(photonPath);
      
      // Filter out lifecycle methods (onInitialize, etc)
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => ({
          name: schema.name,
          description: schema.description || '',
          params: schema.parameters || { type: 'object', properties: {}, required: [] },
          returns: schema.returns || { type: 'object' }
        }));

      photons.push({
        name,
        path: photonPath,
        methods
      });
    } catch (error) {
      logger.warn(`Failed to extract schema for ${name}: ${error}`);
    }
  }

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Serve playground HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generatePlaygroundHTML(photons, port));
      return;
    }

    // API: List photons
    if (url.pathname === '/api/photons') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(photons));
      return;
    }

    // API: Invoke method
    if (url.pathname === '/api/invoke' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { photon, method, params } = JSON.parse(body);
          
          // Find photon path
          const photonPath = await resolvePhotonPath(photon, workingDir);
          if (!photonPath) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Photon not found' }));
            return;
          }

          // Load and invoke directly
          const { PhotonLoader } = await import('../loader.js');
          const loader = new PhotonLoader(false, logger);
          const mcp = await loader.loadFile(photonPath);
          
          // Get the instance
          const instance = mcp.instance;
          if (!instance) {
            throw new Error('Failed to load photon instance');
          }

          // Invoke the method
          if (typeof instance[method] !== 'function') {
            throw new Error(`Method ${method} not found`);
          }

          const result = await instance[method](params);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (error: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`\n🎮 Photon Playground running at http://localhost:${port}`);
    console.log(`📦 ${photons.length} photon(s) loaded`);
    console.log(`\nPress Ctrl+C to stop\n`);
  });
}

function generatePlaygroundHTML(photons: PhotonInfo[], port: number): string {
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      height: 100vh;
      background: #f5f5f5;
    }
    
    .sidebar {
      width: 300px;
      background: #2c3e50;
      color: white;
      overflow-y: auto;
      border-right: 1px solid #34495e;
    }
    
    .sidebar-header {
      padding: 20px;
      background: #1a252f;
      border-bottom: 1px solid #34495e;
    }
    
    .sidebar-header h1 {
      font-size: 20px;
      margin-bottom: 5px;
    }
    
    .sidebar-header p {
      font-size: 12px;
      color: #95a5a6;
    }
    
    .photon-item {
      border-bottom: 1px solid #34495e;
    }
    
    .photon-header {
      padding: 15px 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.2s;
    }
    
    .photon-header:hover {
      background: #34495e;
    }
    
    .photon-header.active {
      background: #34495e;
    }
    
    .photon-name {
      font-weight: 600;
      font-size: 14px;
    }
    
    .method-count {
      font-size: 12px;
      color: #95a5a6;
    }
    
    .method-list {
      display: none;
      background: #1a252f;
    }
    
    .method-list.expanded {
      display: block;
    }
    
    .method-item {
      padding: 10px 20px 10px 40px;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
      border-left: 3px solid transparent;
    }
    
    .method-item:hover {
      background: #2c3e50;
    }
    
    .method-item.active {
      background: #2c3e50;
      border-left-color: #3498db;
    }
    
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .content-header {
      padding: 20px 30px;
      background: white;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .content-header h2 {
      font-size: 24px;
      margin-bottom: 5px;
    }
    
    .content-header p {
      color: #666;
      font-size: 14px;
    }
    
    .content-body {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
    }
    
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border: none;
      background: none;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: all 0.2s;
    }
    
    .tab:hover {
      color: #3498db;
    }
    
    .tab.active {
      color: #3498db;
      border-bottom-color: #3498db;
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      font-size: 14px;
      color: #333;
    }
    
    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: inherit;
      font-size: 14px;
    }
    
    .form-group textarea {
      min-height: 100px;
      font-family: 'Monaco', 'Menlo', monospace;
    }
    
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-primary {
      background: #3498db;
      color: white;
    }
    
    .btn-primary:hover {
      background: #2980b9;
    }
    
    .btn-primary:disabled {
      background: #95a5a6;
      cursor: not-allowed;
    }
    
    .result-container {
      margin-top: 20px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
    }
    
    .result-container h3 {
      font-size: 16px;
      margin-bottom: 10px;
    }
    
    .result-content {
      background: white;
      padding: 15px;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 10px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    
    .empty-state h3 {
      font-size: 20px;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>🎮 Photon Playground</h1>
      <p>${photons.length} photon(s) available</p>
    </div>
    <div id="photon-tree"></div>
  </div>
  
  <div class="main-content">
    <div class="content-header">
      <h2 id="method-title">Select a method</h2>
      <p id="method-description"></p>
    </div>
    <div class="content-body">
      <div id="empty-state" class="empty-state">
        <h3>👈 Select a method to get started</h3>
        <p>Choose a photon and method from the sidebar</p>
      </div>
      <div id="method-interface" style="display: none;">
        <div class="tabs">
          <button class="tab active" data-tab="ui">UI</button>
          <button class="tab" data-tab="data">Data</button>
        </div>
        
        <div class="tab-content active" data-content="ui">
          <form id="method-form">
            <div id="form-fields"></div>
            <button type="submit" class="btn btn-primary" id="invoke-btn">
              <span id="invoke-label">Invoke</span>
            </button>
          </form>
          <div id="result-ui" style="display: none;"></div>
        </div>
        
        <div class="tab-content" data-content="data">
          <div class="result-container">
            <h3>Response Data</h3>
            <div class="result-content" id="result-data">No data yet</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const photons = ${JSON.stringify(photons)};
    let currentPhoton = null;
    let currentMethod = null;
    let currentResult = null;

    // Render photon tree
    function renderTree() {
      const tree = document.getElementById('photon-tree');
      tree.innerHTML = photons.map(photon => \`
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

    function togglePhoton(name) {
      const methods = document.getElementById(\`methods-\${name}\`);
      const header = methods.previousElementSibling;
      methods.classList.toggle('expanded');
      header.classList.toggle('active');
    }

    function selectMethod(photonName, methodName) {
      currentPhoton = photons.find(p => p.name === photonName);
      currentMethod = currentPhoton.methods.find(m => m.name === methodName);
      currentResult = null;

      // Update UI
      document.querySelectorAll('.method-item').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');

      document.getElementById('method-title').textContent = \`\${photonName}.\${methodName}()\`;
      document.getElementById('method-description').textContent = currentMethod.description;
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('method-interface').style.display = 'block';

      renderForm();
    }

    function renderForm() {
      const fields = document.getElementById('form-fields');
      const properties = currentMethod.params?.properties || {};
      const required = currentMethod.params?.required || [];

      // Update button label with method name (capitalize first letter)
      const invokeLabel = document.getElementById('invoke-label');
      invokeLabel.textContent = currentMethod.name.charAt(0).toUpperCase() + currentMethod.name.slice(1);

      const fieldEntries = Object.entries(properties);
      
      if (fieldEntries.length === 0) {
        fields.innerHTML = '<p style="color: #666; font-size: 14px;">No parameters required</p>';
      } else {
        fields.innerHTML = fieldEntries.map(([name, schema]) => {
          const isRequired = required.includes(name);
          const type = schema.type === 'number' ? 'number' : 'text';
          
          return \`
            <div class="form-group">
              <label>
                \${name}
                \${isRequired ? '<span style="color: red;">*</span>' : ''}
                \${schema.description ? '<span style="color: #666; font-weight: normal; font-size: 12px;"> - \${schema.description}</span>' : ''}
              </label>
              <input 
                type="\${type}" 
                name="\${name}" 
                placeholder="Enter \${name}"
                \${isRequired ? 'required' : ''}
              />
            </div>
          \`;
        }).join('');
      }

      document.getElementById('result-ui').style.display = 'none';
      document.getElementById('result-data').textContent = 'No data yet';
    }

    // Handle form submission
    document.getElementById('method-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const formData = new FormData(e.target);
      const params = {};
      for (const [key, value] of formData.entries()) {
        const schema = currentMethod.params?.properties?.[key];
        if (schema?.type === 'number') {
          params[key] = Number(value);
        } else {
          params[key] = value;
        }
      }

      const btn = document.getElementById('invoke-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Invoking...';

      try {
        const response = await fetch('/api/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photon: currentPhoton.name,
            method: currentMethod.name,
            params
          })
        });

        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }

        currentResult = data.result;
        renderResult();
      } catch (error) {
        alert('Error: ' + error.message);
      } finally {
        btn.disabled = false;
        const label = currentMethod.name.charAt(0).toUpperCase() + currentMethod.name.slice(1);
        btn.innerHTML = '<span id="invoke-label">' + label + '</span>';
      }
    });

    function renderResult() {
      const resultUI = document.getElementById('result-ui');
      const resultData = document.getElementById('result-data');

      // Update Data tab
      resultData.textContent = JSON.stringify(currentResult, null, 2);

      // Update UI tab - clear spinner and show result
      resultUI.style.display = 'block';
      resultUI.innerHTML = \`
        <div class="result-container">
          <h3>Result</h3>
          <div class="result-content">\${formatResult(currentResult)}</div>
        </div>
      \`;
    }

    function formatResult(result) {
      // Handle arrays
      if (Array.isArray(result)) {
        if (result.length === 0) {
          return '<p style="color: #666;">Empty result</p>';
        }
        
        // Check if it's markdown content (has .text property)
        if (result[0]?.text) {
          return '<div style="line-height: 1.6;">' + 
            result.map(item => {
              // Simple markdown rendering
              let text = item.text || '';
              // Convert markdown links to HTML
              text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #3498db;">$1</a>');
              // Convert bold
              text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
              return '<p>' + text + '</p>';
            }).join('') + 
            '</div>';
        }
        
        // Regular array - format as list
        return '<ul style="list-style: none; padding: 0;">' + 
          result.map(item => {
            if (typeof item === 'object') {
              return '<li style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;"><pre style="margin: 0;">' + 
                JSON.stringify(item, null, 2) + '</pre></li>';
            }
            return '<li style="margin: 5px 0;">' + String(item) + '</li>';
          }).join('') + 
          '</ul>';
      }
      
      // Handle objects
      if (typeof result === 'object' && result !== null) {
        return '<pre style="margin: 0;">' + JSON.stringify(result, null, 2) + '</pre>';
      }
      
      // Handle primitives
      return '<p>' + String(result) + '</p>';
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        document.querySelector(\`[data-content="\${tabName}"]\`).classList.add('active');
      });
    });

    // Initialize
    renderTree();
  </script>
</body>
</html>`;
}
