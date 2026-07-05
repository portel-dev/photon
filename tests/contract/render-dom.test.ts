/**
 * Format DOM render contract
 *
 * Executes every FORMAT_CATALOG entry through the REAL bridge renderers
 * (generateRenderersScript) in a real Chromium DOM and asserts:
 *
 *   1. The format has an actual renderer registered (the dispatcher
 *      silently falls back to json for unknown formats — that fallback
 *      must never mask a missing renderer for a cataloged format).
 *   2. Rendering the catalog's own example throws no page error and
 *      produces non-empty DOM.
 *   3. For data formats, the example's leaf values actually appear in
 *      the rendered output — data reaches pixels, not just transport.
 *
 * Closes the chain started by src/formats/format-registry.ts (coverage
 * declared) and tests/conformance (data survives transport): this proves
 * the renderer turns data into visible DOM.
 *
 * External-library formats (chart loads Chart.js from CDN, map/graph
 * load leaflet/vis) run with network blocked for hermeticity; for those
 * we assert structure-only (non-empty, no crash), since their data pass
 * happens inside the external lib.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { FORMAT_CATALOG, generateRenderersScript } from '../../dist/auto-ui/bridge/renderers.js';

// Formats whose visible output is produced by an external library or is
// inherently non-textual. Structure-only assertions apply. Every entry
// must have a reason — additions without one should be rejected in review.
// chart:* is NOT here: with the network blocked, charts degrade to a data
// table fallback, so their data-presence assertion exercises exactly that
// fallback path (the one that used to crash with "Chart is not defined").
const STRUCTURE_ONLY: Record<string, string> = {
  map: 'leaflet from CDN; blocked network shows fallback message',
  network: 'vis-network from CDN draws into canvas',
  graph: 'graph library from CDN',
  qr: 'QR code is pixels, not text',
  image: 'renders <img>, no text content',
  sparkline: 'inline SVG path, no text',
  gallery: 'renders <img> grid',
  carousel: 'renders <img> slides',
  embed: 'renders <iframe>',
};

/**
 * Collect probe tokens from example data: whole numbers plus the WORDS of
 * string leaves. Word-level because transforming renderers (markdown,
 * code highlighting) restructure strings — "# Title" becomes <h1>Title</h1>,
 * so the raw leaf never appears but its words must.
 */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.length > 0) {
    for (const word of value.match(/[A-Za-z0-9][A-Za-z0-9.-]{2,}/g) ?? []) out.push(word);
  } else if (typeof value === 'number' && Number.isFinite(value)) out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) leaves(v, out);
  return out;
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}: ${detail}`);
  }
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try {
      await fs.access(chromePath);
      return await chromium.launch({ headless: true, executablePath: chromePath });
    } catch {
      throw error;
    }
  }
}

async function main() {
  console.log('\n🖼  Format DOM render contract\n');

  let browser: Browser | null = null;
  try {
    browser = await launchChromium();
    const page: Page = await browser.newPage();

    // Hermetic: no CDN fetches. External-lib renderers must degrade
    // gracefully (their own fallback paths), never hang the contract.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('http://localhost') || url.startsWith('data:') || url === 'about:blank') {
        return route.continue();
      }
      return route.abort();
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: generateRenderersScript() });

    const registered: string[] = await page.evaluate(
      () => (window as any)._photonRenderers.formats
    );
    check(
      'renderer script registers window._photonRenderers',
      registered.length > 0,
      'no formats registered'
    );

    // ── 1. Every cataloged format has a REAL renderer (no json fallback) ──
    const registeredSet = new Set(registered);
    const missing = Object.keys(FORMAT_CATALOG).filter(
      (f) => !registeredSet.has(f) && !registeredSet.has(f.split(':')[0])
    );
    check(
      'every FORMAT_CATALOG format has a registered renderer',
      missing.length === 0,
      `silently json-fallback for: ${missing.join(', ')}`
    );

    // ── 2 + 3. Render every example; assert DOM and data presence ──
    for (const [format, spec] of Object.entries(FORMAT_CATALOG)) {
      const errBefore = pageErrors.length;
      const result = await page.evaluate(
        async ({ fmt, data }) => {
          const container = document.createElement('div');
          document.body.appendChild(container);
          (window as any)._photonRenderers.render(container, data, fmt);
          // Allow async renderers (dynamic loads, rAF layout) to settle
          await new Promise((r) => setTimeout(r, 50));
          const out = {
            html: container.innerHTML,
            text: container.textContent || '',
          };
          container.remove();
          return out;
        },
        { fmt: format, data: FORMAT_CATALOG[format].example }
      );

      const threw = pageErrors.length > errBefore;
      if (threw) {
        check(format, false, `page error: ${pageErrors[pageErrors.length - 1]}`);
        continue;
      }
      if (result.html.trim().length === 0) {
        check(format, false, 'rendered EMPTY DOM for its own catalog example');
        continue;
      }

      if (format in STRUCTURE_ONLY) {
        check(`${format} (structure-only: ${STRUCTURE_ONLY[format]})`, true, '');
        continue;
      }

      const expected = leaves(spec.example);
      const found = expected.filter((leaf) => result.html.includes(leaf));
      check(
        format,
        expected.length === 0 || found.length > 0,
        `none of the example's ${expected.length} leaf values appear in output. ` +
          `leaves=[${expected.slice(0, 5).join(', ')}] html=${result.html.slice(0, 200)}`
      );
    }
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ Contract run failed:', err);
  process.exit(1);
});
