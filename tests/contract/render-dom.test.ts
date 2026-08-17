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
 * Every renderer runs with network blocked for hermeticity. Formats whose
 * primary output is graphical use structure-only assertions; the dedicated
 * renderer CSP contract separately proves they make no external requests.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { FORMAT_CATALOG, generateRenderersScript } from '../../dist/auto-ui/bridge/renderers.js';

// Formats whose visible output is primarily graphical or inherently
// non-textual. Structure-only assertions apply. Every entry
// must have a reason — additions without one should be rejected in review.
const STRUCTURE_ONLY: Record<string, string> = {
  map: 'self-contained coordinate plot is inline SVG',
  network: 'self-contained deterministic graph is inline SVG',
  graph: 'self-contained deterministic graph is inline SVG',
  qr: 'QR code is pixels, not text',
  image: 'renders <img>, no text content',
  sparkline: 'inline SVG path, no text',
  gallery: 'renders <img> grid',
  carousel: 'renders <img> slides',
  embed: 'renders <iframe>',
};

// Structure-only formats still need a concrete DOM contract. A non-empty
// fallback paragraph must not make a broken graphical renderer pass.
const STRUCTURE_CONTRACTS: Record<string, string[]> = {
  map: ['<svg'],
  network: ['<svg'],
  graph: ['<svg'],
  qr: ['<svg'],
  image: ['<img'],
  sparkline: ['<svg'],
  gallery: ['<img', '<button'],
  carousel: ['<img', '<button'],
  embed: ['<iframe'],
};

const MEDIA_FORMATS = new Set(['image', 'carousel', 'gallery']);

/**
 * Collect probe tokens from example data: whole numbers plus the WORDS of
 * string leaves. Word-level because transforming renderers (markdown,
 * code highlighting) restructure strings — "# Title" becomes <h1>Title</h1>,
 * so the raw leaf never appears but its words must.
 */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.length > 0) {
    for (const word of value.match(/[A-Za-z0-9]{3,}/g) ?? []) out.push(word);
  } else if (typeof value === 'number' && Number.isFinite(value)) out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) leaves(v, out);
  return out;
}

// Some fields are intentionally represented by visual state rather than
// literal text (for example a step status or a banner variant). These probes
// name the semantic content that must be visible for those formats.
const DATA_PROBES: Record<string, string[]> = {
  code: ['console', 'log'],
  metric: ['$142K', '12', 'this', 'month'],
  steps: ['Build', 'Test', 'Deploy'],
  banner: ['New', 'release'],
  alert: ['Deployment', 'complete'],
  a2ui: ['Hello'],
};

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.length > 0) {
    for (const word of value.match(/[A-Za-z0-9][A-Za-z0-9.-]{2,}/g) ?? []) out.push(word);
  } else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) stringLeaves(v, out);
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

    const styleContract = await page.evaluate(() => {
      const style = document.querySelector('style[data-photon-style-contract]');
      const container = document.createElement('div');
      container.className = 'photon-render-surface photon-grid';
      document.body.appendChild(container);
      const computed = getComputedStyle(container);
      return {
        installed: Boolean(style),
        spacing: computed.getPropertyValue('--photon-space-4').trim(),
        radius: computed.getPropertyValue('--photon-radius-4').trim(),
        display: computed.display,
        maxWidth: computed.maxWidth,
        boxSizing: computed.boxSizing,
      };
    });
    check(
      'renderer installs the shared Photon token and layout contract',
      styleContract.installed &&
        styleContract.spacing === '16px' &&
        styleContract.radius === '12px' &&
        styleContract.display === 'grid' &&
        styleContract.maxWidth === '100%' &&
        styleContract.boxSizing === 'border-box',
      JSON.stringify(styleContract)
    );

    const scopedTheme = await page.evaluate(() => {
      const container = document.createElement('div');
      container.style.setProperty('--photon-color-text', 'rgb(12, 34, 56)');
      container.style.setProperty('--photon-color-surface', 'rgb(65, 43, 21)');
      document.body.appendChild(container);
      (window as any)._photonRenderers.render(container, { status: 'Scoped theme' }, 'card', {
        host: 'mcp-app',
        expandable: false,
      });
      return {
        format: container.getAttribute('data-photon-format'),
        host: container.getAttribute('data-photon-host'),
        surfaceClass: container.classList.contains('photon-render-surface'),
        textColor: getComputedStyle(
          container.querySelector('div > div > span:last-child') as HTMLElement
        ).color,
      };
    });
    check(
      'renderer consumes scoped semantic tokens and exposes stable styling hooks',
      scopedTheme.format === 'card' &&
        scopedTheme.host === 'mcp-app' &&
        scopedTheme.surfaceClass &&
        scopedTheme.textColor === 'rgb(12, 34, 56)',
      JSON.stringify(scopedTheme)
    );

    const galleryBehavior = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      (window as any)._photonRenderers.render(
        container,
        [
          {
            src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
            caption: 'First',
            openUrl: 'https://example.com',
            openLabel: 'Open example',
          },
          { src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', caption: 'Second' },
        ],
        'gallery'
      );
      const tiles = container.querySelectorAll('button');
      (tiles[0] as HTMLButtonElement).click();
      const overlay = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const result = {
        tileCount: tiles.length,
        overlay: Boolean(overlay),
        closeLabel: overlay
          ?.querySelector('button[aria-label="Close preview"]')
          ?.getAttribute('aria-label'),
        closeSvg: Boolean(overlay?.querySelector('button[aria-label="Close preview"] svg')),
        actionLabel: overlay?.querySelector('a')?.textContent,
        imageAlt: overlay?.querySelector('img')?.getAttribute('alt'),
        navigationCount: overlay?.querySelectorAll(
          'button[aria-label="Previous image"], button[aria-label="Next image"]'
        ).length,
        navigationSvgCount: overlay?.querySelectorAll(
          'button[aria-label="Previous image"] svg, button[aria-label="Next image"] svg'
        ).length,
      };
      overlay
        ?.querySelector('button[aria-label="Close preview"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ...result, closed: !document.querySelector('[role="dialog"]') };
    });
    check(
      'gallery opens a navigable preview with close and action controls',
      galleryBehavior.tileCount === 2 &&
        galleryBehavior.overlay &&
        galleryBehavior.closeLabel === 'Close preview' &&
        galleryBehavior.closeSvg &&
        galleryBehavior.actionLabel === 'Open example' &&
        galleryBehavior.imageAlt === 'First' &&
        galleryBehavior.navigationCount === 2 &&
        galleryBehavior.navigationSvgCount === 2 &&
        galleryBehavior.closed,
      JSON.stringify(galleryBehavior)
    );

    const expandableCard = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      (window as any)._photonRenderers.render(container, { status: 'Ready', total: 42 }, 'card');
      const expand = container.querySelector(
        'button[aria-label="Expand Card"]'
      ) as HTMLButtonElement | null;
      expand?.click();
      const dialog = document.querySelector(
        '[role="dialog"][aria-label="Card"]'
      ) as HTMLElement | null;
      const close = dialog?.querySelector(
        'button[aria-label="Close expanded view"]'
      ) as HTMLButtonElement | null;
      const expandText = expand?.textContent || '';
      const closeText = close?.textContent || '';
      close?.click();
      return {
        hasExpand: Boolean(expand),
        expandSvg: Boolean(expand?.querySelector('svg')),
        expandHasRawGlyph: expandText.includes('⤢'),
        hasDialog: Boolean(dialog),
        hasClose: Boolean(close),
        closeSvg: Boolean(close?.querySelector('svg')),
        closeHasRawGlyph: closeText.includes('×'),
        closed: !document.querySelector('[role="dialog"][aria-label="Card"]'),
      };
    });
    check(
      'large card results get a reusable fullscreen surface with close control',
      expandableCard.hasExpand &&
        expandableCard.expandSvg &&
        !expandableCard.expandHasRawGlyph &&
        expandableCard.hasDialog &&
        expandableCard.hasClose &&
        expandableCard.closeSvg &&
        !expandableCard.closeHasRawGlyph &&
        expandableCard.closed,
      JSON.stringify(expandableCard)
    );

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
        const required = STRUCTURE_CONTRACTS[format] ?? [];
        const missingStructure = required.filter((token) => !result.html.includes(token));
        if (MEDIA_FORMATS.has(format)) {
          if (!result.html.includes('data:image/svg+xml')) {
            missingStructure.push('data:image/svg+xml catalog image');
          }
          if (result.html.includes('https://example.com/')) {
            missingStructure.push('no remote example.com image URLs');
          }
        }
        if (format === 'embed') {
          if (!result.html.includes('data:text/html')) {
            missingStructure.push('data:text/html catalog embed');
          }
          if (result.html.includes('youtube.com')) {
            missingStructure.push('no remote youtube catalog embed URL');
          }
        }
        check(
          `${format} (structure-only: ${STRUCTURE_ONLY[format]})`,
          missingStructure.length === 0,
          `missing required DOM contract: ${missingStructure.join(', ')}`
        );
        continue;
      }

      const expected = DATA_PROBES[format] ?? stringLeaves(spec.example);
      const missing = expected.filter((leaf) => !result.html.includes(leaf));
      check(
        format,
        missing.length === 0,
        `missing ${missing.length} of ${expected.length} string leaves. ` +
          `missing=[${missing.slice(0, 5).join(', ')}] html=${result.html.slice(0, 200)}`
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
