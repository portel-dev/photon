import { describe, expect, test } from 'vitest';
import { generateBridgeScript } from '../src/auto-ui/bridge/index.js';

describe('Beam-aligned Web Components UI Kit in Platform Bridge', () => {
  test('generateBridgeScript bundles photon-tool-card and photon-log-streamer', () => {
    const context: any = {
      theme: 'dark',
      photon: 'test-photon',
      method: 'echo',
      hostName: 'beam',
      hostVersion: '1.5.0',
      injectedPhotons: [],
      stateful: true,
      methodMeta: {
        echo: {
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    };

    const script = generateBridgeScript(context);
    expect(script).toBeDefined();

    // Assert components are defined in the output script string
    expect(script).toContain("customElements.define('photon-tool-card'");
    expect(script).toContain("customElements.define('photon-log-streamer'");
    expect(script).toContain('class PhotonToolCard extends HTMLElement');
    expect(script).toContain('class PhotonLogStreamer extends HTMLElement');
    expect(script).toContain('disconnectedCallback()');
    expect(script).toContain('this._unsubscribers.forEach');
  });
});
