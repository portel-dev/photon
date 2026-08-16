/**
 * Photon Layout Lab
 *
 * Renders reusable compositions through the same standalone format renderer
 * used by MCP Apps and custom Photon UIs. The lab is deliberately plain HTML
 * plus Chromium: it is fast enough for local development, produces artifacts
 * a human can inspect, and catches geometry regressions before Beam or a
 * Cloudflare deployment is involved.
 *
 * Run:
 *   bun run test:layout-lab
 *
 * Optional:
 *   PHOTON_LAYOUT_VIEWPORTS=320,480,768
 *   PHOTON_LAYOUT_THEMES=light,dark
 *   PHOTON_LAYOUT_ARTIFACT_DIR=/tmp/photon-layout-lab
 */

import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { FORMAT_CATALOG, generateRenderersScript } from '../../dist/auto-ui/bridge/renderers.js';

type Theme = 'light' | 'dark';
type LayoutKind = 'stack' | 'grid' | 'split' | 'surface';

interface FormatNode {
  type: 'format';
  id: string;
  format: string;
  data?: unknown;
}

interface LayoutNode {
  type: LayoutKind;
  id: string;
  gap?: number;
  columns?: number;
  children: Node[];
}

type Node = FormatNode | LayoutNode;

interface Fixture {
  id: string;
  title: string;
  description: string;
  root: Node;
}

interface ScenarioResult {
  fixture: string;
  title: string;
  viewport: number;
  theme: Theme;
  screenshot: string;
  passed: boolean;
  errors: string[];
  measurements: {
    nodes: number;
    formatNodes: number;
    maxScrollWidth: number;
    maxScrollHeight: number;
    checks: string[];
  };
}

interface LabMetadata {
  sourceCommit: string;
  browserVersion: string;
  nodeVersion: string;
}

const PIXEL =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="%23b8c4d6"/%3E%3C/svg%3E';
const EMBED =
  'data:text/html,%3Cbody style="font:16px system-ui;padding:16px"%3EEmbedded%20preview%3C/body%3E';

const ARTIFACT_DIR =
  process.env.PHOTON_LAYOUT_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'layout-lab');
const VIEWPORTS = (process.env.PHOTON_LAYOUT_VIEWPORTS || '320,480,768')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 240);
const THEMES = (process.env.PHOTON_LAYOUT_THEMES || 'light,dark')
  .split(',')
  .map((value) => value.trim())
  .filter((value): value is Theme => value === 'light' || value === 'dark');

const DATA_URI_FORMATS = new Set(['image', 'carousel', 'gallery', 'masonry']);

function safeExample(format: string, example: unknown): unknown {
  if (DATA_URI_FORMATS.has(format)) {
    if (Array.isArray(example)) {
      return example.map((item) =>
        item && typeof item === 'object'
          ? { ...(item as Record<string, unknown>), url: PIXEL }
          : item
      );
    }
    if (example && typeof example === 'object')
      return { ...(example as Record<string, unknown>), url: PIXEL };
  }
  if (format === 'embed') return { url: EMBED, type: 'html' };
  return example;
}

function formatNode(id: string, format: string, data?: unknown): FormatNode {
  return { type: 'format', id, format, data };
}

function layoutNode(
  type: LayoutKind,
  id: string,
  children: Node[],
  options: Pick<LayoutNode, 'gap' | 'columns'> = {}
): LayoutNode {
  return { type, id, children, gap: options.gap ?? 12, columns: options.columns };
}

function createFixtures(): Fixture[] {
  const c = FORMAT_CATALOG;
  const sample = (format: string) => safeExample(format, c[format]?.example);
  const formSchema = {
    properties: {
      name: { type: 'string', title: 'Full name', description: 'How should we address you?' },
      email: { type: 'string', format: 'email', title: 'Email address' },
      date: { type: 'string', format: 'date', title: 'Preferred date' },
      duration: {
        type: 'number',
        minimum: 20,
        maximum: 60,
        multipleOf: 20,
        default: 20,
        title: 'Duration (minutes)',
      },
      topic: {
        type: 'string',
        enum: ['Product strategy', 'MCP development', 'Other'],
        title: 'Topic',
      },
      notes: { type: 'string', format: 'textarea', title: 'What would you like to solve?' },
    },
    required: ['name', 'email', 'date'],
  };

  return [
    {
      id: 'consult-style-search',
      title: 'Search results with form controls',
      description: 'A responsive result grid followed by the selected-slot summary and details.',
      root: layoutNode(
        'stack',
        'search-root',
        [
          layoutNode(
            'surface',
            'search-results',
            [
              formatNode('search-heading', 'hero', {
                title: 'Available consultation slots',
                subtitle: 'Choose a date and time that works for you',
              }),
              layoutNode(
                'grid',
                'date-grid',
                [
                  formatNode('date-1', 'card', {
                    date: 'Wed, 19 Aug',
                    slots: 4,
                    timezone: 'Asia/Singapore',
                  }),
                  formatNode('date-2', 'card', {
                    date: 'Thu, 20 Aug',
                    slots: 2,
                    timezone: 'Asia/Singapore',
                  }),
                  formatNode('date-3', 'card', {
                    date: 'Fri, 21 Aug',
                    slots: 5,
                    timezone: 'Asia/Singapore',
                  }),
                  formatNode('date-4', 'card', {
                    date: 'Sat, 22 Aug',
                    slots: 1,
                    timezone: 'Asia/Singapore',
                  }),
                ],
                { gap: 12, columns: 4 }
              ),
              formatNode('slot-list', 'list', [
                { name: '10:00–10:20', subtitle: 'Available', status: 'available' },
                { name: '14:30–14:50', subtitle: 'Available', status: 'available' },
                { name: '17:00–17:20', subtitle: 'Almost full', status: 'limited' },
              ]),
            ],
            { gap: 16 }
          ),
          layoutNode(
            'split',
            'booking-details',
            [
              formatNode('selected-slot', 'card', {
                selected: 'Fri, 21 Aug at 14:30',
                duration: '20 min',
              }),
              formatNode('booking-fields', 'kv', {
                name: 'Your name',
                email: 'you@example.com',
                notes: 'What would you like to solve?',
              }),
            ],
            { gap: 16, columns: 2 }
          ),
        ],
        { gap: 20 }
      ),
    },
    {
      id: 'mixed-format-dashboard',
      title: 'Nested dashboard composition',
      description: 'Cards, metrics, a table, a chart and a status panel in one responsive surface.',
      root: layoutNode(
        'stack',
        'dashboard-root',
        [
          layoutNode(
            'grid',
            'dashboard-metrics',
            [
              formatNode('metric-revenue', 'metric', sample('metric')),
              formatNode('metric-users', 'metric', {
                value: '1.2K',
                trend: '+8%',
                period: 'this month',
              }),
              formatNode('metric-health', 'gauge', sample('gauge')),
            ],
            { gap: 12, columns: 3 }
          ),
          layoutNode(
            'split',
            'dashboard-body',
            [
              formatNode('dashboard-table', 'table', sample('table')),
              layoutNode(
                'stack',
                'dashboard-side',
                [
                  formatNode('dashboard-status', 'card', {
                    status: 'Healthy',
                    region: 'Singapore',
                    uptime: '99.99%',
                  }),
                  formatNode('dashboard-progress', 'progress', sample('progress')),
                  formatNode('dashboard-badges', 'chips', sample('chips')),
                ],
                { gap: 12 }
              ),
            ],
            { gap: 16, columns: 2 }
          ),
        ],
        { gap: 20 }
      ),
    },
    {
      id: 'form-controls',
      title: 'Form controls in a responsive surface',
      description:
        'The canonical Photon form bundle with date, numeric stepper, select and textarea controls.',
      root: layoutNode(
        'split',
        'form-root',
        [
          formatNode('form-main', 'form', formSchema),
          layoutNode(
            'stack',
            'form-preview',
            [
              formatNode('form-help', 'card', {
                experience: '20-minute consultation',
                timezone: 'Asia/Singapore',
                payment: 'Secure Stripe checkout',
              }),
              formatNode('form-status', 'banner', {
                title: 'Only the details you still need to provide are shown.',
                variant: 'info',
              }),
            ],
            { gap: 12 }
          ),
        ],
        { gap: 16, columns: 2 }
      ),
    },
    {
      id: 'catalog-combinations',
      title: 'Format catalog combinations',
      description: 'Every registered format rendered inside a constrained responsive grid.',
      root: layoutNode(
        'grid',
        'catalog-grid',
        Object.keys(FORMAT_CATALOG).map((format) =>
          formatNode(`format-${format.replace(/[^a-z0-9]+/gi, '-')}`, format, sample(format))
        ),
        { gap: 12, columns: 3 }
      ),
    },
  ];
}

function containsFormat(node: Node, format: string): boolean {
  if (node.type === 'format') return node.format === format;
  return node.children.some((child) => containsFormat(child, format));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function nodeMarkup(node: Node, parentId = 'root'): string {
  if (node.type === 'format') {
    const target =
      node.format === 'form'
        ? '<invoke-form></invoke-form>'
        : '<div data-photon-format-target></div>';
    return `<article class="photon-lab-format" data-photon-lab-node="${escapeAttribute(node.id)}" data-photon-lab-parent="${escapeAttribute(parentId)}" data-photon-lab-kind="format" data-photon-format="${escapeAttribute(node.format)}"><div data-photon-format-target>${target}</div></article>`;
  }
  const children = node.children.map((child) => nodeMarkup(child, node.id)).join('');
  const columns =
    node.type === 'grid' || node.type === 'split'
      ? ` data-photon-lab-columns="${node.columns ?? 2}"`
      : '';
  return `<section class="photon-lab-layout photon-lab-${node.type}" style="--lab-gap:${node.gap ?? 12}px;--lab-columns:${node.columns ?? 1}" data-photon-lab-node="${escapeAttribute(node.id)}" data-photon-lab-parent="${escapeAttribute(parentId)}" data-photon-lab-kind="${node.type}" data-photon-lab-gap="${node.gap ?? 12}"${columns}>${children}</section>`;
}

function fixturePage(fixture: Fixture, theme: Theme): string {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>
    :root { color-scheme: ${theme}; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; min-width: 0; }
    body { background: var(--photon-color-background); color: var(--photon-color-text); font: 14px/1.45 system-ui, -apple-system, sans-serif; }
    #photon-lab {
      width: 100%; max-width: 100%; min-width: 0; padding: 16px; overflow: visible;
      --t-primary: var(--photon-color-text);
      --t-muted: var(--photon-color-text-muted);
      --bg-glass: var(--photon-color-surface);
      --bg-glass-strong: var(--photon-color-surface);
      --border-glass: var(--photon-color-border);
      --accent-primary: var(--photon-color-accent);
      --accent-secondary: var(--photon-color-accent);
      --glow-primary: color-mix(in srgb, var(--photon-color-accent) 35%, transparent);
      --color-error: #ef6b73;
      --color-error-glow: color-mix(in srgb, var(--color-error) 35%, transparent);
    }
    .photon-lab-layout { min-width: 0; max-width: 100%; display: flex; flex-direction: column; gap: var(--lab-gap); }
    .photon-lab-grid, .photon-lab-split { display: grid; grid-template-columns: repeat(var(--lab-columns), minmax(0, 1fr)); align-items: stretch; }
    .photon-lab-surface { padding: 16px; border: 1px solid var(--photon-color-border); border-radius: 16px; background: var(--photon-color-surface); }
    .photon-lab-format { min-width: 0; max-width: 100%; width: 100%; overflow-wrap: break-word; }
    .photon-lab-format > [data-photon-format-target] { min-width: 0; max-width: 100%; width: 100%; }
    .photon-lab-format img, .photon-lab-format svg, .photon-lab-format canvas, .photon-lab-format iframe, .photon-lab-format table, .photon-lab-format pre { max-width: 100%; }
    .photon-lab-format pre, .photon-lab-format code { overflow-wrap: anywhere; white-space: pre-wrap; }
    @media (max-width: 560px) {
      #photon-lab { padding: 12px; }
      .photon-lab-grid, .photon-lab-split { grid-template-columns: minmax(0, 1fr); }
    }
  </style></head><body>
    <main id="photon-lab" data-photon-lab-fixture="${escapeAttribute(fixture.id)}" data-photon-lab-title="${escapeAttribute(fixture.title)}" style="--photon-color-text:${theme === 'dark' ? '#e7e9ee' : '#1f2937'};--photon-color-text-muted:${theme === 'dark' ? '#a8afbd' : '#667085'};--photon-color-background:${theme === 'dark' ? '#15171c' : '#f8fafc'};--photon-color-surface:${theme === 'dark' ? '#20232b' : '#ffffff'};--photon-color-border:${theme === 'dark' ? '#3a3f4b' : '#dbe2ea'};--photon-color-accent:${theme === 'dark' ? '#9b8cff' : '#6257e8'};">
      <h1 style="margin:0 0 4px;font-size:20px">${escapeAttribute(fixture.title)}</h1>
      <p style="margin:0 0 16px;color:var(--photon-color-text-muted)">${escapeAttribute(fixture.description)}</p>
      <div id="photon-lab-root" style="--lab-gap:${fixture.root.type === 'grid' ? (fixture.root.gap ?? 12) : (fixture.root.gap ?? 12)}px;--lab-columns:${fixture.root.columns ?? 1}">${nodeMarkup(fixture.root)}</div>
    </main>
  </body></html>`;
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

async function renderAndMeasure(
  page: Page,
  fixture: Fixture,
  viewport: number,
  theme: Theme,
  screenshot: string
): Promise<ScenarioResult> {
  await page.setViewportSize({ width: viewport, height: 900 });
  await page.setContent(fixturePage(fixture, theme));
  await page.addScriptTag({ content: generateRenderersScript() });
  if (containsFormat(fixture.root, 'form')) {
    await page.addScriptTag({
      path: path.join(process.cwd(), 'dist', 'photon-form.bundle.js'),
      type: 'module',
    });
    await page.waitForFunction(() => Boolean(customElements.get('invoke-form')));
  }
  // Data is passed after markup is installed, which keeps the fixture schema
  // out of the HTML and makes the generated page safe to inspect/share.
  const dataById: Record<string, unknown> = {};
  const collect = (node: Node): void => {
    if (node.type === 'format') dataById[node.id] = node.data;
    else node.children.forEach(collect);
  };
  collect(fixture.root);
  await page.evaluate(async (data) => {
    (window as any).__photonLabData = data;
    const renderers = (window as any)._photonRenderers;
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>('[data-photon-lab-kind="format"]')
    )) {
      const target = node.querySelector('[data-photon-format-target]');
      const format = node.dataset.photonFormat;
      const value = data[node.dataset.photonLabNode || ''];
      if (format === 'form') {
        const form = node.querySelector('invoke-form') as any;
        form.params = value;
        form.photonName = 'layout-lab';
        form.methodName = node.dataset.photonLabNode || 'form';
        await form.updateComplete;
      } else {
        renderers.render(target, value, format, { expandable: false });
      }
    }
  }, dataById);
  await page.waitForTimeout(30);

  const formProbe = containsFormat(fixture.root, 'form')
    ? await page.evaluate(`(async () => {
        const form = document.querySelector('invoke-form');
        if (!form) return { errors: ['form custom element was not rendered'] };
        await form.updateComplete;
        const root = form.shadowRoot;
        const errors = [];
        const customInputs = {
          datePicker: root.querySelectorAll('date-picker').length,
          numberStepper: root.querySelectorAll('number-stepper').length,
          select: root.querySelectorAll('select').length,
          textarea: root.querySelectorAll('textarea').length,
        };
        if (customInputs.datePicker !== 1) errors.push('expected one date-picker');
        if (customInputs.numberStepper !== 1) errors.push('expected one number-stepper');
        if (customInputs.select !== 1) errors.push('expected one select');
        if (customInputs.textarea !== 1) errors.push('expected one textarea');

        form.handleSubmit();
        await form.updateComplete;
        const requiredErrors = root.querySelectorAll('.error-text').length;
        if (requiredErrors < 3) errors.push('required validation did not report all empty required fields');

        let submitted = null;
        form.addEventListener('submit', (event) => { submitted = event.detail; }, { once: true });
        form.sharedValues = {
          name: 'Layout Lab User',
          email: 'layout@example.com',
          date: '2026-08-20',
          duration: 20,
          topic: 'MCP development',
          notes: 'Validate the complete Photon form flow.',
        };
        await form.updateComplete;
        form.handleSubmit();
        await form.updateComplete;
        if (!submitted || !submitted.args || submitted.args.email !== 'layout@example.com') errors.push('valid submission did not emit expected args');
        return { errors, customInputs, requiredErrors, submitted: Boolean(submitted) };
      })()`)
    : null;

  const evaluation = await page.evaluate(`(() => {
    const errors = [];
    const root = document.getElementById('photon-lab');
    const nodes = Array.from(document.querySelectorAll('[data-photon-lab-node]'));
    function rect(element) {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
    function overlap(a, b) {
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    }
    function gapBetween(a, b) {
      const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (xOverlap > 0.5) return Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
      if (yOverlap > 0.5) return Math.max(0, Math.max(a.left - b.right, b.left - a.right));
      return null;
    }
    let maxScrollWidth = root.scrollWidth - root.clientWidth;
    let maxScrollHeight = 0;
    for (const node of nodes) {
      const r = rect(node);
      maxScrollWidth = Math.max(maxScrollWidth, node.scrollWidth - node.clientWidth);
      maxScrollHeight = Math.max(maxScrollHeight, node.scrollHeight - node.clientHeight);
      if (r.width <= 0 || r.height <= 0) errors.push(node.dataset.photonLabNode + ': zero-size node');
      if (node.scrollWidth > node.clientWidth + 1) errors.push(node.dataset.photonLabNode + ': horizontal overflow ' + (node.scrollWidth - node.clientWidth) + 'px');
      const parentId = node.dataset.photonLabParent;
      const parent = document.querySelector('[data-photon-lab-node="' + CSS.escape(parentId || '') + '"]');
      if (parent) {
        const p = rect(parent);
        if (r.left < p.left - 1 || r.right > p.right + 1) errors.push(node.dataset.photonLabNode + ': escapes parent width');
        if (r.top < p.top - 1 || r.bottom > p.bottom + 1) errors.push(node.dataset.photonLabNode + ': escapes parent height');
      }
      const overflowY = getComputedStyle(node).overflowY;
      if (node.scrollHeight > node.clientHeight + 1 && (overflowY === 'hidden' || overflowY === 'clip')) errors.push(node.dataset.photonLabNode + ': vertically clipped content ' + (node.scrollHeight - node.clientHeight) + 'px');
    }
    for (const parent of Array.from(document.querySelectorAll('[data-photon-lab-kind]:not([data-photon-lab-kind="format"])'))) {
      const children = nodes.filter((node) => node.dataset.photonLabParent === parent.dataset.photonLabNode);
      const expectedGap = Number(parent.dataset.photonLabGap || 0);
      const rects = children.map((child) => ({ id: child.dataset.photonLabNode || '', rect: rect(child) }));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (overlap(rects[i].rect, rects[j].rect)) errors.push(parent.dataset.photonLabNode + ': ' + rects[i].id + ' overlaps ' + rects[j].id);
          const gap = gapBetween(rects[i].rect, rects[j].rect);
          if (gap !== null && gap + 1 < expectedGap) errors.push(parent.dataset.photonLabNode + ': gap ' + gap + 'px below ' + expectedGap + 'px between ' + rects[i].id + ' and ' + rects[j].id);
        }
      }
    }
    return {
      errors,
      nodes: nodes.length,
      formatNodes: nodes.filter((node) => node.dataset.photonLabKind === 'format').length,
      maxScrollWidth,
      maxScrollHeight,
      checks: ['non-zero nodes', 'no horizontal overflow', 'no clipped vertical overflow', 'children stay within parent width and height', 'siblings do not overlap', 'declared gaps are preserved'],
    };
  })()`);
  if (formProbe?.errors?.length)
    evaluation.errors.push(...formProbe.errors.map((error: string) => `form: ${error}`));
  if (formProbe) evaluation.form = formProbe;
  await page.screenshot({ path: screenshot, fullPage: true });
  return {
    fixture: fixture.id,
    title: fixture.title,
    viewport,
    theme,
    screenshot,
    passed: evaluation.errors.length === 0,
    errors: evaluation.errors,
    measurements: evaluation,
  };
}

function sourceCommit(): string {
  try {
    const hash = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return process.env.GITHUB_SHA || process.env.PHOTON_LAYOUT_SOURCE_COMMIT || 'unknown';
  }
}

async function writeGallery(results: ScenarioResult[], metadata: LabMetadata): Promise<void> {
  const relative = (file: string) => path.relative(ARTIFACT_DIR, file).split(path.sep).join('/');
  const publicResults = results.map((result) => ({
    ...result,
    screenshot: relative(result.screenshot),
  }));
  await fs.writeFile(
    path.join(ARTIFACT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceCommit: metadata.sourceCommit,
        browser: metadata.browserVersion,
        node: metadata.nodeVersion,
        viewports: VIEWPORTS,
        themes: THEMES,
        results: publicResults,
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(ARTIFACT_DIR, 'llm-review-input.json'),
    JSON.stringify(
      {
        purpose:
          'Advisory visual review input only. Deterministic geometry and component-contract checks remain the CI gate; no LLM approval is implied by PASS.',
        results: publicResults,
      },
      null,
      2
    )
  );
  const cards = results
    .map(
      (result) =>
        `<article class="result ${result.passed ? 'pass' : 'fail'}"><h2>${escapeAttribute(result.title)}</h2><p><b>${result.viewport}px</b> · ${result.theme} · ${result.passed ? 'PASS' : 'FAIL'}</p><a href="${relative(result.screenshot)}"><img src="${relative(result.screenshot)}" alt="${escapeAttribute(result.title)} at ${result.viewport}px in ${result.theme} theme"></a><details><summary>Measurements</summary><pre>${escapeAttribute(JSON.stringify(result.measurements, null, 2))}</pre>${result.errors.length ? `<pre class="errors">${escapeAttribute(result.errors.join('\n'))}</pre>` : ''}</details></article>`
    )
    .join('');
  await fs.writeFile(
    path.join(ARTIFACT_DIR, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Photon Layout Lab</title><style>body{font:14px system-ui;margin:24px;background:#f8fafc;color:#1f2937}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}.result{background:#fff;border:2px solid #16a34a;border-radius:14px;padding:14px}.result.fail{border-color:#dc2626}.result img{display:block;width:100%;height:auto;border:1px solid #dbe2ea;border-radius:8px}.result h2{margin:0 0 4px;font-size:16px}.result p{margin:0 0 10px;color:#667085}.result pre{white-space:pre-wrap;overflow-wrap:anywhere}.errors{color:#b91c1c}</style><h1>Photon Layout Lab</h1><p>Generated from the real Photon renderers and form bundle. Click any screenshot for a full-size view. PASS means deterministic geometry/component checks passed; it is not an LLM visual approval.</p><div class="grid">${cards}</div>`
  );
}

async function main(): Promise<void> {
  assert.ok(VIEWPORTS.length > 0, 'PHOTON_LAYOUT_VIEWPORTS must contain at least one width');
  assert.ok(THEMES.length > 0, 'PHOTON_LAYOUT_THEMES must contain light or dark');
  await fs.rm(path.join(ARTIFACT_DIR, 'screenshots'), { recursive: true, force: true });
  await fs.mkdir(path.join(ARTIFACT_DIR, 'screenshots'), { recursive: true });
  const browser = await launchChromium();
  const metadata: LabMetadata = {
    sourceCommit: sourceCommit(),
    browserVersion: browser.version(),
    nodeVersion: process.version,
  };
  const results: ScenarioResult[] = [];
  try {
    for (const fixture of createFixtures()) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          const page = await browser.newPage();
          await page.route('**/*', (route) => {
            const url = route.request().url();
            if (url.startsWith('data:') || url === 'about:blank') return route.continue();
            return route.abort();
          });
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const screenshot = path.join(
            ARTIFACT_DIR,
            'screenshots',
            `${fixture.id}--${viewport}--${theme}.png`
          );
          const result = await renderAndMeasure(page, fixture, viewport, theme, screenshot);
          if (errors.length) result.errors.push(...errors.map((error) => `pageerror: ${error}`));
          result.passed = result.errors.length === 0;
          results.push(result);
          await page.close();
          console.log(
            `  ${result.passed ? '✅' : '❌'} ${fixture.id} · ${viewport}px · ${theme}${result.errors.length ? ` — ${result.errors.join('; ')}` : ''}`
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeGallery(results, metadata);
  const failed = results.filter((result) => !result.passed);
  console.log(`\nLayout Lab: ${results.length - failed.length}/${results.length} scenarios passed`);
  console.log(`Human gallery: ${path.join(ARTIFACT_DIR, 'index.html')}`);
  console.log(`Machine manifest: ${path.join(ARTIFACT_DIR, 'manifest.json')}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error('❌ Layout Lab failed:', error);
  process.exit(1);
});
