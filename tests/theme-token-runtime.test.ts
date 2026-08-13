import { describe, expect, it } from 'vitest';
import * as vm from 'node:vm';
import { generateBridgeScript } from '../dist/auto-ui/bridge/index.js';
import { generatePlatformBridgeScript } from '../dist/auto-ui/platform-compat.js';
import { ResourceServer } from '../dist/resource-server.js';

type ThemeHarness = {
  window: Record<string, any>;
  document: Record<string, any>;
  messages: any[];
  send: (message: any) => void;
};

function createHarness(script: string): ThemeHarness {
  const messages: any[] = [];
  const listeners: Array<(event: { data: any }) => void> = [];
  const classes = new Set<string>();
  const rootStyle: Record<string, any> = {
    setProperty(name: string, value: string) {
      this[name] = value;
    },
  };
  const bodyStyle: Record<string, string> = {};
  const document = {
    documentElement: {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
        contains: (name: string) => classes.has(name),
      },
      style: rootStyle,
      setAttribute: (name: string, value: string) => {
        rootStyle[`@${name}`] = value;
      },
    },
    body: { style: bodyStyle, scrollWidth: 800, scrollHeight: 600 },
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
  } as any;

  const window: Record<string, any> = {
    parent: { postMessage: (message: any) => messages.push(message) },
    addEventListener: (type: string, listener: (event: { data: any }) => void) => {
      if (type === 'message') listeners.push(listener);
    },
    removeEventListener() {},
    dispatchEvent() {},
    open() {},
    location: { origin: 'http://test.local', pathname: '/' },
    CustomEvent: class {
      constructor(
        public type: string,
        public init?: any
      ) {}
    },
  };
  window.window = window;

  const source = script.replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  vm.runInContext(
    source,
    vm.createContext({
      window,
      document,
      HTMLElement: class HTMLElement {},
      customElements: {
        define() {},
        get() {
          return undefined;
        },
      },
      CustomEvent: window.CustomEvent,
      console,
      Promise,
      Object,
      Array,
      Math,
      JSON,
      Error,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      setTimeout: () => 1,
      clearTimeout() {},
    })
  );

  return {
    window,
    document,
    messages,
    send: (message: any) => listeners.forEach((listener) => listener({ data: message })),
  };
}

function css(harness: ThemeHarness, name: string): string {
  return harness.document.documentElement.style[name];
}

const context = {
  photon: 'theme-test',
  method: 'main',
  theme: 'dark' as const,
  locale: 'en-US',
  hostName: 'test-host',
  hostVersion: '1.0.0',
};

describe('MCP client theme-token runtime contract', () => {
  it('applies Photon defaults before host initialization', () => {
    const harness = createHarness(generateBridgeScript(context));
    expect(css(harness, '--color-surface')).toBe('#0d0d0d');
    expect(css(harness, '--color-on-surface')).toBe('#e6e6e6');
    expect(css(harness, '--primary')).toBe('#79aef0');
  });

  it('merges a client partial token map without losing Photon tokens', () => {
    const harness = createHarness(generateBridgeScript(context));
    const init = harness.messages.find((message) => message.method === 'ui/initialize');
    harness.send({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        hostContext: {
          theme: 'dark',
          styles: { variables: { '--color-primary': '#ff00aa' } },
        },
      },
    });

    expect(css(harness, '--color-primary')).toBe('#ff00aa');
    expect(css(harness, '--color-surface')).toBe('#0d0d0d');
    expect(css(harness, '--color-on-surface')).toBe('#e6e6e6');
  });

  it('switches client themes and removes stale overrides by restoring the new defaults', () => {
    const harness = createHarness(generateBridgeScript(context));
    harness.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'light', styles: { variables: { '--color-primary': '#123456' } } },
    });

    expect(css(harness, '--color-primary')).toBe('#123456');
    expect(css(harness, '--color-surface')).toBe('#FFFFFF');
    expect(harness.document.documentElement.classList.contains('light')).toBe(true);

    harness.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'dark', styles: { variables: {} } },
    });
    expect(css(harness, '--color-primary')).toBe('#79aef0');
    expect(css(harness, '--color-surface')).toBe('#0d0d0d');
    expect(harness.document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('orders platform host theme selection before token application', () => {
    const script = generatePlatformBridgeScript(context as any);
    const selectTheme = script.indexOf('ctx.theme = m.params.hostContext.theme');
    const mergeTokens = script.indexOf('setThemeContext(ctx.theme, initTokens)');
    expect(selectTheme).toBeGreaterThan(-1);
    expect(mergeTokens).toBeGreaterThan(selectTheme);
  });

  it('applies the same contract through the Cloudflare/ResourceServer bridge', () => {
    const bridge = new ResourceServer({}, { filePath: '' }).generateMcpAppsBridge({
      name: 'theme-test',
      injectedPhotons: [],
    } as any);
    const harness = createHarness(bridge);
    const init = harness.messages.find((message) => message.method === 'ui/initialize');
    harness.send({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        hostContext: {
          theme: 'light',
          styles: { variables: { '--color-primary': '#cc5500' } },
        },
      },
    });
    expect(css(harness, '--color-primary')).toBe('#cc5500');
    expect(css(harness, '--color-surface')).toBe('#FFFFFF');
    expect(css(harness, '--color-on-surface')).toBe('#0D1420');
  });
});
