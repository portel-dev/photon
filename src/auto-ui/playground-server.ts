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
import { PhotonLoader } from '../loader.js';
import { PhotonServer } from '../server.js';
import { logger } from '../shared/logger.js';
import {
  SchemaExtractor,
  executeGenerator,
  isAsyncGenerator,
  type PhotonYield,
  type EmitYield,
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

export async function startPlaygroundServer(workingDir: string, port: number): Promise<void> {
  // Discover all photons
  const photonList = await listPhotonMCPs(workingDir);

  if (photonList.length === 0) {
    logger.warn('No photons found in ' + workingDir);
    console.log('\nCreate a photon with: photon maker new <name>');
    process.exit(1);
  }

  // Extract metadata for all photons (use PhotonLoader for proper dependency handling)
  const photons: PhotonInfo[] = [];
  const loader = new PhotonLoader(false, logger);

  for (const name of photonList) {
    const photonPath = await resolvePhotonPath(name, workingDir);
    if (!photonPath) continue;

    try {
      // Load photon using PhotonLoader (handles deps, TypeScript, injections)
      const mcp = await loader.loadFile(photonPath);
      if (!mcp.instance) {
        logger.warn(`Failed to get instance for ${name}`);
        continue;
      }

      // Extract schema for UI
      const extractor = new SchemaExtractor();
      const schemas = await extractor.extractFromFile(photonPath);

      // Filter out lifecycle methods (onInitialize, etc)
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => ({
          name: schema.name,
          description: schema.description || '',
          params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' },
        }));

      photons.push({
        name,
        path: photonPath,
        methods,
      });
    } catch (error) {
      logger.warn(`Failed to load ${name}: ${error}`);
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
      req.on('data', (chunk) => (body += chunk));
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

          // Call method with params object - photon methods expect a single params object
          const methodResult = instance[method](params);

          // Check if it's a generator - use SSE for streaming
          let result: any;
          if (isAsyncGenerator(methodResult)) {
            // Setup SSE for streaming progress
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });

            try {
              result = await executeGenerator(
                methodResult as AsyncGenerator<PhotonYield, any, any>,
                {
                  inputProvider: async (ask) => {
                    // Send ask event to client
                    res.write(`data: ${JSON.stringify({ type: 'ask', data: ask })}\n\n`);
                    // For now, throw error - playground doesn't support interactive input yet
                    throw new Error(
                      `Interactive input not supported in playground: ${ask.message}`
                    );
                  },
                  outputHandler: async (emit) => {
                    // Stream progress updates to client
                    res.write(`data: ${JSON.stringify({ type: 'progress', data: emit })}\n\n`);
                  },
                }
              );

              // Send final result
              res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            } catch (error: any) {
              res.write(
                `data: ${JSON.stringify({ type: 'error', data: { message: error.message } })}\n\n`
              );
              res.end();
            }
          } else {
            // Non-generator: regular JSON response
            if (methodResult && typeof methodResult.then === 'function') {
              result = await methodResult;
            } else {
              result = methodResult;
            }

            logger.info(`Sending result to client:`, result);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result }));
          }
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      height: 100vh;
      background: #f5f5f5;
      line-height: 1.6;
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
      font-family: inherit;
      font-size: 14px;
      white-space: normal;
      word-break: break-word;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .progress-container {
      display: flex;
      align-items: center;
      padding: 20px;
      background: white;
      border-radius: 4px;
      color: #3498db;
      font-size: 14px;
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

    // Markdown helpers for rendering doc blocks  
    const markdownLinkRegex = /\\[([^\\]]+)\\]\\(([^)]+)\\)/g;
    const markdownBoldRegex = /\\*\\*([^*]+)\\*\\*/g;

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
                \${schema.description ? '<span style="color: #666; font-weight: normal; font-size: 12px;"> - ' + schema.description + '</span>' : ''}
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

      // Show progress area
      const resultUI = document.getElementById('result-ui');
      resultUI.style.display = 'block';
      resultUI.innerHTML = '<div class="progress-container"><div class="spinner"></div> <span id="progress-text">Starting...</span></div>';

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

        // Check if it's SSE (for generators)
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/event-stream')) {
          // Handle SSE streaming
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\\n\\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const event = JSON.parse(data);
                
                if (event.type === 'progress') {
                  // Update progress display
                  const resultUI = document.getElementById('result-ui');
                  if (resultUI) {
                    const emit = event.data;
                    let progressHTML = '';

                    if (emit.emit === 'progress' && emit.value !== undefined) {
                      // Show progress bar for percentage-based progress
                      const percent = Math.round((emit.value || 0) * 100);
                      progressHTML = \`
                        <div class="progress-container">
                          <div style="margin-bottom: 8px;">\${emit.message || 'Processing...'}</div>
                          <div style="background: #e0e0e0; height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="background: #3498db; height: 100%; width: \${percent}%; transition: width 0.3s;"></div>
                          </div>
                          <div style="margin-top: 4px; font-size: 12px; color: #666;">\${percent}%</div>
                        </div>
                      \`;
                    } else {
                      // Show spinner for status messages or unknown progress
                      const message = emit.message || emit.data?.message || 'Processing...';
                      progressHTML = \`
                        <div class="progress-container">
                          <div class="spinner"></div>
                          <span id="progress-text">\${message}</span>
                        </div>
                      \`;
                    }

                    resultUI.innerHTML = progressHTML;
                  }
                } else if (event.type === 'result') {
                  currentResult = event.data;
                  renderResult();
                } else if (event.type === 'error') {
                  throw new Error(event.data.message);
                }
              } catch (e) {
                console.error('Failed to parse SSE event:', e);
              }
            }
          }
        } else {
          // Regular JSON response (non-generator)
          const data = await response.json();
          
          if (data.error) {
            throw new Error(data.error);
          }

          currentResult = data.result;
          renderResult();
        }
      } catch (error) {
        alert('Error: ' + error.message);
        resultUI.innerHTML = '<p style="color: #d32f2f;">Error: ' + error.message + '</p>';
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
      // Handle null/undefined
      if (result === null || result === undefined) {
        return '<p style="color: #666;">No result returned</p>';
      }
      
      // Handle arrays
      if (Array.isArray(result)) {
        if (result.length === 0) {
          return '<p style="color: #666;">Empty result</p>';
        }
        
        // Check if array contains markdown strings
        if (typeof result[0] === 'string') {
          return '<div class="markdown-list" style="line-height: 1.8;">' + 
            result.map((item, idx) => {
              let text = String(item);
              // Convert markdown links to bold HTML links (no underline)
              text = text.replace(markdownLinkRegex, '<a href="$2" target="_blank" style="color: #3498db; text-decoration: none; font-weight: 600;">$1</a>');
              // Convert bold
              text = text.replace(markdownBoldRegex, '<strong>$1</strong>');
              // Convert blockquotes (lines starting with >)
              text = text.replace(/^&gt;\\s*(.*)$/gm, '<blockquote style="margin: 10px 0; padding: 10px 15px; background: #ecf0f1; border-left: 4px solid #95a5a6; color: #555;">$1</blockquote>');
              text = text.replace(/^>\\s*(.*)$/gm, '<blockquote style="margin: 10px 0; padding: 10px 15px; background: #ecf0f1; border-left: 4px solid #95a5a6; color: #555;">$1</blockquote>');
              // Convert headers
              text = text.replace(/^### (.*$)/gm, '<h4 style="margin: 15px 0 8px 0; font-size: 16px; font-weight: 600;">$1</h4>');
              text = text.replace(/^## (.*$)/gm, '<h3 style="margin: 20px 0 10px 0; font-size: 18px; font-weight: 600;">$1</h3>');
              // Convert line breaks
              text = text.replace(/\\n/g, '<br/>');
              
              return '<div style="margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #3498db;"><div style="font-size: 12px; color: #95a5a6; margin-bottom: 8px;">Entry ' + (idx + 1) + '</div>' + text + '</div>';
            }).join('') + 
            '</div>';
        }
        
        // Check if it's markdown content objects (has .text property)
        if (result[0]?.text) {
          return '<div class="markdown-list" style="line-height: 1.8;">' + 
            result.map((item, idx) => {
              let text = item.text || '';
              // Convert markdown links to bold HTML links (no underline)
              text = text.replace(markdownLinkRegex, '<a href="$2" target="_blank" style="color: #3498db; text-decoration: none; font-weight: 600;">$1</a>');
              // Convert bold
              text = text.replace(markdownBoldRegex, '<strong>$1</strong>');
              // Convert blockquotes
              text = text.replace(/^&gt;\\s*(.*)$/gm, '<blockquote style="margin: 10px 0; padding: 10px 15px; background: #ecf0f1; border-left: 4px solid #95a5a6; color: #555;">$1</blockquote>');
              text = text.replace(/^>\\s*(.*)$/gm, '<blockquote style="margin: 10px 0; padding: 10px 15px; background: #ecf0f1; border-left: 4px solid #95a5a6; color: #555;">$1</blockquote>');
              // Add title if present
              if (item.title) {
                return '<div style="margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #3498db;"><div style="font-size: 12px; color: #95a5a6; margin-bottom: 8px;">Entry ' + (idx + 1) + '</div><strong style="font-size: 16px;">' + item.title + '</strong><br/><div style="margin-top: 8px;">' + text + '</div></div>';
              }
              return '<div style="margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #3498db;"><div style="font-size: 12px; color: #95a5a6; margin-bottom: 8px;">Entry ' + (idx + 1) + '</div>' + text + '</div>';
            }).join('') + 
            '</div>';
        }
        
        // Regular array - format as list
        return '<ul style="list-style: none; padding: 0;">' + 
          result.map((item, idx) => {
            if (typeof item === 'object') {
              return '<li style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;"><pre style="margin: 0;">' + 
                JSON.stringify(item, null, 2) + '</pre></li>';
            }
            return '<li style="margin: 5px 0; padding: 8px; background: #f8f9fa; border-radius: 4px;"><strong>Item ' + (idx + 1) + ':</strong> ' + String(item) + '</li>';
          }).join('') + 
          '</ul>';
      }
      
      // Handle objects
      if (typeof result === 'object' && result !== null) {
        return '<pre style="margin: 0; padding: 15px; background: #f8f9fa; border-radius: 6px; overflow-x: auto;">' + JSON.stringify(result, null, 2) + '</pre>';
      }
      
      // Handle strings (apply markdown rendering)
      if (typeof result === 'string') {
        let text = result;
        // Convert markdown links to bold HTML links (no underline)
        text = text.replace(markdownLinkRegex, '<a href="$2" target="_blank" style="color: #3498db; text-decoration: none; font-weight: 600;">$1</a>');
        // Convert bold
        text = text.replace(markdownBoldRegex, '<strong>$1</strong>');
        // Convert blockquotes (lines starting with >)
        text = text.replace(/^&gt;\\s*(.*)$/gm, '<blockquote style="margin: 10px 0; padding: 10px 15px; background: #ecf0f1; border-left: 4px solid #95a5a6; color: #555;">$1</blockquote>');
        text = text.replace(/^>\\s*(.*)$/gm, '<blockquote style="margin: 10px 0; padding: 10px 15px; background: #ecf0f1; border-left: 4px solid #95a5a6; color: #555;">$1</blockquote>');
        // Convert headers
        text = text.replace(/^### (.*$)/gm, '<h4 style="margin: 15px 0 8px 0; font-size: 16px; font-weight: 600;">$1</h4>');
        text = text.replace(/^## (.*$)/gm, '<h3 style="margin: 20px 0 10px 0; font-size: 18px; font-weight: 600;">$1</h3>');
        text = text.replace(/^# (.*$)/gm, '<h2 style="margin: 20px 0 10px 0; font-size: 20px; font-weight: 600;">$1</h2>');
        // Convert line breaks
        text = text.replace(/\\n/g, '<br/>');
        return '<div style="padding: 15px; background: #f8f9fa; border-radius: 6px; line-height: 1.8;">' + text + '</div>';
      }
      
      // Handle other primitives
      return '<div style="padding: 15px; background: #f8f9fa; border-radius: 6px;">' + String(result) + '</div>';
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
