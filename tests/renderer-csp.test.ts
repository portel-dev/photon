/**
 * CSP contract for the canonical browser renderer runtime.
 *
 * The renderer is intentionally exercised with every network request blocked:
 * chart, QR, map, and network output must come from the generated runtime,
 * not from a public script, stylesheet, tile server, or graph service.
 */

import { strict as assert } from 'assert';
import { chromium } from 'playwright';
import { generateRenderersScript } from '../src/auto-ui/bridge/renderers.js';

async function run(): Promise<void> {
  const script = generateRenderersScript();

  assert.doesNotMatch(script, /(?:cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|openstreetmap\.org)/i);
  assert.doesNotMatch(script, /document\.createElement\(['"](?:script|link)['"]\)/);
  assert.doesNotMatch(script, /\beval\s*\(|new\s+Function\s*\(/);
  assert.match(script, /renderers\[['"]chart['"]\]/);
  assert.match(script, /renderers\.qr\s*=\s*function/);
  assert.match(script, /renderers\.map\s*=\s*function/);
  assert.match(script, /renderers\.network\s*=\s*renderers\.graph/);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const externalRequests: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === 'about:blank' || url.startsWith('data:')) return route.continue();
      externalRequests.push(url);
      return route.abort();
    });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: script });

    const results = await page.evaluate(async () => {
      const cases: Array<[string, unknown]> = [
        [
          'chart:bar',
          [
            { month: 'Jan', revenue: 42 },
            { month: 'Feb', revenue: 57 },
          ],
        ],
        ['qr', 'https://example.com/csp'],
        ['map', [{ name: 'Photon', lat: 12.97, lng: 77.59 }]],
        [
          'network',
          {
            nodes: [
              { id: 'api', label: 'API' },
              { id: 'db', label: 'DB' },
            ],
            edges: [{ from: 'api', to: 'db' }],
          },
        ],
      ];
      const outputs: Record<string, { html: string; text: string }> = {};
      for (const [format, data] of cases) {
        const container = document.createElement('div');
        document.body.appendChild(container);
        (window as any)._photonRenderers.render(container, data, format);
        await new Promise((resolve) => setTimeout(resolve, 50));
        outputs[format] = { html: container.innerHTML, text: container.textContent || '' };
      }
      return outputs;
    });

    assert.ok(results['chart:bar'].html.includes('<svg'), 'chart should render inline SVG');
    assert.match(results['chart:bar'].html, /Jan|42|Feb|57/);
    assert.ok(results.qr.html.includes('<svg'), 'QR should render an inline SVG');
    assert.match(results.qr.text, /https:\/\/example\.com\/csp/);
    assert.ok(results.map.html.includes('<svg'), 'map should render an inline SVG');
    assert.match(results.map.text, /Photon/);
    assert.ok(results.network.html.includes('<svg'), 'network should render an inline SVG');
    assert.match(results.network.text, /API|DB/);
    assert.deepEqual(externalRequests, [], 'renderer formats must not make external requests');
  } finally {
    await browser.close();
  }

  console.log('✅ renderer CSP contract passed');
}

run().catch((error) => {
  console.error('❌ renderer CSP contract failed:', error);
  process.exit(1);
});
