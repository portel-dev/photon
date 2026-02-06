/**
 * Layer 2: Protocol Tests (JSON-RPC Message Flow)
 *
 * Simulates being an MCP Apps host and verifies the exact message flow
 * between host and iframe. Uses a mock browser environment.
 */

import { generateBridgeScript } from '../../dist/auto-ui/bridge/index.js';
import * as vm from 'vm';

const TEST_CONTEXT = {
  photon: 'test-photon',
  method: 'main',
  theme: 'dark' as const,
  locale: 'en-US',
  hostName: 'test-host',
  hostVersion: '1.0.0',
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`❌ ${name}`);
      console.log(`   ${e.message}`);
      failed++;
    }
  })();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: any, expected: any, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n   Expected: ${JSON.stringify(expected)}\n   Actual: ${JSON.stringify(actual)}`);
  }
}

/**
 * Create a mock browser environment that captures postMessage calls
 */
function createMockBrowser() {
  const sentMessages: any[] = [];
  const messageListeners: ((e: { data: any }) => void)[] = [];

  const mockWindow: any = {
    parent: {
      postMessage: (msg: any, _origin: string) => {
        sentMessages.push(msg);
      },
    },
    addEventListener: (event: string, handler: any) => {
      if (event === 'message') {
        messageListeners.push(handler);
      }
    },
    removeEventListener: () => {},
    open: () => {},
    dispatchEvent: () => {},
    CustomEvent: class CustomEvent {
      constructor(public type: string, public detail: any) {}
    },
  };

  const mockDocument: any = {
    documentElement: {
      classList: {
        _classes: new Set(),
        add(c: string) { this._classes.add(c); },
        remove(c: string) { this._classes.delete(c); },
        contains(c: string) { return this._classes.has(c); },
      },
      style: {
        _props: {} as Record<string, string>,
        setProperty(name: string, value: string) { this._props[name] = value; },
        getPropertyValue(name: string) { return this._props[name]; },
        colorScheme: '',
        backgroundColor: '',
      },
      setAttribute: () => {},
    },
    body: {
      style: { backgroundColor: '', color: '' },
      scrollWidth: 800,
      scrollHeight: 600,
    },
    querySelector: (selector: string) => {
      // Mock mcp:ui-size meta tag
      if (selector === 'meta[name="mcp:ui-size"]') {
        return {
          getAttribute: () => 'minWidth=1000;minHeight=500;maxHeight=800',
        };
      }
      return null;
    },
  };

  // Function to simulate host sending a message to the iframe
  const sendToIframe = (msg: any) => {
    messageListeners.forEach((listener) => listener({ data: msg }));
  };

  // Function to get messages sent by the iframe
  const getMessages = () => [...sentMessages];
  const clearMessages = () => { sentMessages.length = 0; };
  const getLastMessage = () => sentMessages[sentMessages.length - 1];

  return {
    window: mockWindow,
    document: mockDocument,
    sendToIframe,
    getMessages,
    clearMessages,
    getLastMessage,
  };
}

/**
 * Execute the bridge script in a mock browser context
 */
function executeBridgeScript(mock: ReturnType<typeof createMockBrowser>) {
  const script = generateBridgeScript(TEST_CONTEXT);

  // Extract just the JavaScript (remove script tags)
  const jsCode = script
    .replace('<script>', '')
    .replace('</script>', '')
    .trim();

  // Track timeouts for manual control
  const pendingTimeouts: { fn: () => void; ms: number; id: number }[] = [];
  let timeoutIdCounter = 0;

  // Create execution context with mock browser globals
  const context = vm.createContext({
    window: mock.window,
    document: mock.document,
    console,
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++timeoutIdCounter;
      pendingTimeouts.push({ fn, ms, id });
      return id;
    },
    clearTimeout: (id: number) => {
      const idx = pendingTimeouts.findIndex((t) => t.id === id);
      if (idx >= 0) pendingTimeouts.splice(idx, 1);
    },
    Promise,
    Error,
    JSON,
    Array,
    Object,
    Math,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });

  // Expose timeout control
  (mock as any).runTimeouts = () => {
    const toRun = [...pendingTimeouts];
    pendingTimeouts.length = 0;
    toRun.forEach((t) => t.fn());
  };

  // Execute the script
  vm.runInContext(jsCode, context);

  return context.window;
}

console.log('🧪 Layer 2: Protocol Tests (JSON-RPC Message Flow)\n');

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION HANDSHAKE
// ═══════════════════════════════════════════════════════════════════════════════

await test('Bridge sends photon:ready on initialization', () => {
  const mock = createMockBrowser();
  executeBridgeScript(mock);

  const messages = mock.getMessages();
  const readyMsg = messages.find((m: any) => m.type === 'photon:ready');
  assert(readyMsg !== undefined, 'Should send photon:ready');
});

await test('Bridge sends ui/initialize request', () => {
  const mock = createMockBrowser();
  executeBridgeScript(mock);

  const messages = mock.getMessages();
  const initMsg = messages.find((m: any) =>
    m.jsonrpc === '2.0' && m.method === 'ui/initialize'
  );
  assert(initMsg !== undefined, 'Should send ui/initialize');
  assert(initMsg.id !== undefined, 'Should have request id');
  assert(initMsg.params.appInfo !== undefined, 'Should include appInfo');
  assert(initMsg.params.protocolVersion !== undefined, 'Should include protocolVersion');
});

await test('Bridge sends ui/notifications/initialized after successful init', () => {
  const mock = createMockBrowser();
  executeBridgeScript(mock);

  // Find the init request to get its id
  const messages = mock.getMessages();
  const initMsg = messages.find((m: any) => m.method === 'ui/initialize');
  assert(initMsg !== undefined, 'Should have sent ui/initialize request');

  mock.clearMessages();

  // Host responds to ui/initialize
  mock.sendToIframe({
    jsonrpc: '2.0',
    id: initMsg.id,
    result: {
      hostContext: {
        theme: 'dark',
        styles: { variables: { '--color-text-primary': '#fff' } },
      },
    },
  });

  const newMessages = mock.getMessages();
  const initializedMsg = newMessages.find((m: any) =>
    m.method === 'ui/notifications/initialized'
  );
  assert(initializedMsg !== undefined, 'Should send initialized notification');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CALLS
// ═══════════════════════════════════════════════════════════════════════════════

await test('window.photon.invoke sends tools/call request', async () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  // Call invoke - this starts the async operation
  const invokePromise = win.photon.invoke('testTool', { arg1: 'value1' });

  // Get messages sent (should include tools/call)
  const messages = mock.getMessages();
  const toolCall = messages.find((m: any) => m.method === 'tools/call');

  assert(toolCall !== undefined, 'Should send tools/call');
  assertEqual(toolCall.params.name, 'testTool', 'Should include tool name');
  assertEqual(toolCall.params.arguments, { arg1: 'value1' }, 'Should include arguments');
  assert(toolCall.id !== undefined, 'Should have request id');

  // Respond immediately (before any timeout)
  mock.sendToIframe({
    jsonrpc: '2.0',
    id: toolCall.id,
    result: { content: [{ type: 'text', text: '{"success": true}' }] },
  });

  // Now the promise should resolve
  const result = await invokePromise;
  assertEqual(result, { success: true }, 'Should return parsed result');
});

await test('window.photon.invoke extracts structuredContent when available', async () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  const invokePromise = win.photon.invoke('testTool', {});

  const toolCall = mock.getLastMessage();

  // Respond with structuredContent
  mock.sendToIframe({
    jsonrpc: '2.0',
    id: toolCall.id,
    result: {
      content: [{ type: 'text', text: 'fallback' }],
      structuredContent: { data: 'preferred' },
    },
  });

  const result = await invokePromise;
  assertEqual(result, { data: 'preferred' }, 'Should prefer structuredContent');
});

await test('window.photon.invoke rejects on isError', async () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  const invokePromise = win.photon.invoke('failingTool', {});

  const toolCall = mock.getLastMessage();

  // Respond with error
  mock.sendToIframe({
    jsonrpc: '2.0',
    id: toolCall.id,
    result: {
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true,
    },
  });

  try {
    await invokePromise;
    assert(false, 'Should have rejected');
  } catch (e: any) {
    assert(e.message.includes('Something went wrong'), 'Should include error message');
  }
});

await test('window.photon.invoke rejects on JSON-RPC error', async () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  const invokePromise = win.photon.invoke('unknownTool', {});

  const toolCall = mock.getLastMessage();

  // Respond with JSON-RPC error
  mock.sendToIframe({
    jsonrpc: '2.0',
    id: toolCall.id,
    error: { code: -32601, message: 'Method not found' },
  });

  try {
    await invokePromise;
    assert(false, 'Should have rejected');
  } catch (e: any) {
    assert(e.message.includes('Method not found'), 'Should include error message');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL RESULT NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

await test('ui/notifications/tool-result triggers onResult callback', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let receivedData: any = null;
  win.photon.onResult((data: any) => {
    receivedData = data;
  });

  mock.sendToIframe({
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-result',
    params: {
      result: {
        structuredContent: { boards: ['board1', 'board2'] },
      },
    },
  });

  assertEqual(receivedData, { boards: ['board1', 'board2'] }, 'Should receive result data');
});

await test('legacy photon:result triggers onResult callback', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let receivedData: any = null;
  win.photon.onResult((data: any) => {
    receivedData = data;
  });

  mock.sendToIframe({
    type: 'photon:result',
    data: { tasks: [1, 2, 3] },
  });

  assertEqual(receivedData, { tasks: [1, 2, 3] }, 'Should receive legacy result data');
});

// ═══════════════════════════════════════════════════════════════════════════════
// THEME CHANGES
// ═══════════════════════════════════════════════════════════════════════════════

await test('ui/notifications/host-context-changed updates theme', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let newTheme: string | null = null;
  win.photon.onThemeChange((theme: string) => {
    newTheme = theme;
  });

  mock.sendToIframe({
    jsonrpc: '2.0',
    method: 'ui/notifications/host-context-changed',
    params: {
      theme: 'light',
      styles: { variables: { '--color-text-primary': '#000' } },
    },
  });

  assertEqual(newTheme, 'light', 'Should receive new theme');
  assertEqual(win.photon.theme, 'light', 'Should update theme property');
});

await test('legacy photon:theme-change updates theme', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let newTheme: string | null = null;
  win.photon.onThemeChange((theme: string) => {
    newTheme = theme;
  });

  mock.sendToIframe({
    type: 'photon:theme-change',
    theme: 'light',
  });

  assertEqual(newTheme, 'light', 'Should receive new theme from legacy message');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM PHOTON NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

await test('photon/notifications/progress triggers onProgress', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let receivedProgress: any = null;
  win.photon.onProgress((data: any) => {
    receivedProgress = data;
  });

  mock.sendToIframe({
    jsonrpc: '2.0',
    method: 'photon/notifications/progress',
    params: { percent: 50, message: 'Halfway there' },
  });

  assertEqual(receivedProgress, { percent: 50, message: 'Halfway there' }, 'Should receive progress');
});

await test('photon/notifications/status triggers onStatus', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let receivedStatus: any = null;
  win.photon.onStatus((data: any) => {
    receivedStatus = data;
  });

  mock.sendToIframe({
    jsonrpc: '2.0',
    method: 'photon/notifications/status',
    params: { type: 'success', message: 'Operation complete' },
  });

  assertEqual(
    receivedStatus,
    { type: 'success', message: 'Operation complete' },
    'Should receive status'
  );
});

await test('photon/notifications/emit triggers onEmit', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let receivedEmit: any = null;
  win.photon.onEmit((data: any) => {
    receivedEmit = data;
  });

  mock.sendToIframe({
    jsonrpc: '2.0',
    method: 'photon/notifications/emit',
    params: { event: 'taskCreated', data: { id: '123' } },
  });

  assertEqual(receivedEmit, { event: 'taskCreated', data: { id: '123' } }, 'Should receive emit');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIZE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

await test('sendSizeChanged sends ui/notifications/size-changed', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  win.photon.sendSizeChanged({ width: 1000, height: 600 });

  const sizeMsg = mock.getLastMessage();
  assertEqual(sizeMsg.method, 'ui/notifications/size-changed', 'Should send size-changed');
  assertEqual(sizeMsg.params, { width: 1000, height: 600 }, 'Should include dimensions');
});

await test('parseSizeMeta extracts constraints from meta tag', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  const constraints = win.photon.parseSizeMeta();

  assertEqual(constraints.minWidth, 1000, 'Should extract minWidth');
  assertEqual(constraints.minHeight, 500, 'Should extract minHeight');
  assertEqual(constraints.maxHeight, 800, 'Should extract maxHeight');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCE TEARDOWN
// ═══════════════════════════════════════════════════════════════════════════════

await test('ui/resource-teardown sends response', () => {
  const mock = createMockBrowser();
  executeBridgeScript(mock);

  mock.clearMessages();

  mock.sendToIframe({
    jsonrpc: '2.0',
    id: 'teardown-123',
    method: 'ui/resource-teardown',
    params: {},
  });

  const response = mock.getLastMessage();
  assertEqual(response.id, 'teardown-123', 'Should respond with same id');
  assertEqual(response.result, {}, 'Should return empty result');
});

// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

await test('window.openai.callTool is same as window.photon.invoke', async () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  // Start a call via openai
  const callPromise = win.openai.callTool('testTool', { x: 1 });

  const toolCall = mock.getLastMessage();
  assert(toolCall.method === 'tools/call', 'Should send tools/call');

  // Respond
  mock.sendToIframe({
    jsonrpc: '2.0',
    id: toolCall.id,
    result: { content: [{ type: 'text', text: '"ok"' }] },
  });

  const result = await callPromise;
  assertEqual(result, 'ok', 'Should return result');
});

await test('window.openai.notifyIntrinsicHeight sends size-changed', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  mock.clearMessages();

  win.openai.notifyIntrinsicHeight(500);

  const sizeMsg = mock.getLastMessage();
  assertEqual(sizeMsg.method, 'ui/notifications/size-changed', 'Should send size-changed');
  assertEqual(sizeMsg.params, { height: 500 }, 'Should include height');
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNSUBSCRIBE
// ═══════════════════════════════════════════════════════════════════════════════

await test('onResult returns unsubscribe function', () => {
  const mock = createMockBrowser();
  const win = executeBridgeScript(mock);

  let callCount = 0;
  const unsubscribe = win.photon.onResult(() => {
    callCount++;
  });

  mock.sendToIframe({ type: 'photon:result', data: {} });
  assertEqual(callCount, 1, 'Should receive first event');

  unsubscribe();

  mock.sendToIframe({ type: 'photon:result', data: {} });
  assertEqual(callCount, 1, 'Should not receive after unsubscribe');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Layer 2 Results: ${passed} passed, ${failed} failed`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (failed > 0) {
  process.exit(1);
}
