/**
 * Slides - AI-native presentation workspace
 * @version 1.0.0
 * @runtime ^1.14.0
 * @dependencies @marp-team/marp-core@^4.3.0, @resvg/resvg-js@^2.6.2?
 * @tags presentation, slides, markdown, marp, ai-controlled-presentation
 * @icon 🎞️
 * @stateful
 * @ui slides ./ui/slides.html
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

type ThemeName = 'default' | 'gaia' | 'uncover';
type PreviewMode = 'fit' | 'actual' | 'overview';

interface SlidesState {
  currentDeck: string;
  currentSlide: number;
  locked: boolean;
  theme: ThemeName;
  preview: PreviewMode;
}

interface DeckSummary {
  file: string;
  title: string;
  updatedAt: string;
  size: number;
}

interface SlideLayout {
  name: string;
  description: string;
  markdown: string;
}

const DEFAULT_DECK = `---
marp: true
theme: default
paginate: true
---

# Photon Slides

AI can write this deck as plain Markdown.

---

## Co-create

- Ask AI to rewrite a slide
- Save directly into \`~/Documents/slides\`
- Present from the same shared URL

---

## Presenter Controls

- Lock navigation while presenting
- Release the deck so everyone can browse
- Switch themes from the UI
`;

const SLIDE_LAYOUTS: SlideLayout[] = [
  {
    name: 'title',
    description: 'Title slide with heading and subtitle',
    markdown: '# Title\n\nSubtitle or tagline',
  },
  {
    name: 'content',
    description: 'Heading with bullet points',
    markdown: '## Heading\n\n- First point\n- Second point\n- Third point',
  },
  {
    name: 'two-column',
    description: 'Side-by-side content using Marp columns',
    markdown:
      '## Comparison\n\n<div style="display:grid;grid-template-columns:1fr 1fr;gap:2em;">\n<div>\n\n### Left\n\n- Point A\n- Point B\n\n</div>\n<div>\n\n### Right\n\n- Point C\n- Point D\n\n</div>\n</div>',
  },
  {
    name: 'image',
    description: 'Full-bleed background image slide',
    markdown: '<!-- _backgroundImage: url("https://picsum.photos/1280/720") -->\n\n# Visual Slide',
  },
  {
    name: 'quote',
    description: 'Blockquote with attribution',
    markdown:
      '## Insight\n\n> "The best way to predict the future is to invent it."\n>\n> — Alan Kay',
  },
  {
    name: 'code',
    description: 'Code block with syntax highlighting',
    markdown:
      '## Code Example\n\n```typescript\nfunction greet(name: string) {\n  return `Hello, ${name}!`;\n}\n```',
  },
  {
    name: 'blank',
    description: 'Empty slide for free-form content',
    markdown: '',
  },
];

// Lazy-loaded dependencies (installed by @dependencies before onInitialize)
let Marp: any;
let Resvg: any;

export default class Slides {
  protected settings = {
    /** @property Directory where slide markdown files are stored */
    folder: path.join(os.homedir(), 'Documents', 'slides'),
  };

  // Injected by runtime
  declare memory: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  declare emit: (payload: { event: string; data: unknown }) => void;

  private marp: any;

  async onInitialize() {
    // Lazy-import dependencies installed by @dependencies tag at runtime
    // Use string variable to prevent TypeScript from resolving the module
    const marpId = '@marp-team/marp-core';
    const marpModule = await import(/* webpackIgnore: true */ marpId);
    Marp = marpModule.Marp || marpModule.default;
    this.marp = new Marp({ html: true });

    try {
      const resvgId = '@resvg/resvg-js';
      const resvgModule = await import(/* webpackIgnore: true */ resvgId);
      Resvg = resvgModule.Resvg || resvgModule.default;
    } catch {
      // resvg is optional — snapshot/matrix degrade to SVG string
    }

    await this.ensureWorkspace();
  }

  /**
   * Open the slide workspace UI
   * @ui slides
   * @readOnly
   */
  async main() {
    return this.status();
  }

  /**
   * Shared presentation state for the current deck
   * @readOnly
   */
  async status() {
    return this.buildState();
  }

  /**
   * List saved markdown decks
   * @readOnly
   */
  async list() {
    return { folder: this.settings.folder, decks: await this.listDecks() };
  }

  /**
   * Read the current deck or a specific markdown file
   * @param file Optional markdown filename
   * @readOnly
   */
  async read(params?: { file?: string }) {
    const state = await this.getState();
    const file = this.normalizeFileName(params?.file || state.currentDeck);
    const fullPath = this.resolveDeckPath(file);
    const markdown = await fs.readFile(fullPath, 'utf8');
    return { file, path: fullPath, markdown };
  }

  /**
   * Create a new deck with a minimal Marp starter
   * @param file Markdown filename
   * @param title Deck title
   * @param template Layout template for the first slide {@choice title, content, blank}
   */
  async create(params?: { file?: string; title?: string; template?: string }) {
    const file = this.normalizeFileName(
      params?.file || slugify(params?.title || 'slides') || 'slides.md'
    );
    const title = (params?.title || firstHeading(DEFAULT_DECK) || 'New Deck').trim();
    const markdown = starterDeck(title);
    return this.save({ file, markdown, activate: true });
  }

  /**
   * Save markdown to the slides folder and optionally make it active
   * @param markdown Full Marp markdown
   * @param file Markdown filename. Defaults to current deck or slides.md
   * @param activate Make this the active presentation {@default true}
   */
  async save(params: { markdown: string; file?: string; activate?: boolean }) {
    const state = await this.getState();
    const file = this.normalizeFileName(params.file || state.currentDeck || 'slides.md');
    const fullPath = this.resolveDeckPath(file);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, params.markdown, 'utf8');

    const nextState = {
      ...state,
      currentDeck: params.activate === false ? state.currentDeck : file,
    };
    await this.memory.set('state', nextState);

    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Switch the active deck
   * @param file Markdown filename
   */
  async open(params: { file: string }) {
    const file = this.normalizeFileName(params.file);
    await fs.access(this.resolveDeckPath(file));
    const state = await this.getState();
    const nextState: SlidesState = { ...state, currentDeck: file, currentSlide: 0 };
    await this.memory.set('state', nextState);
    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Delete a deck file
   * @param file Markdown filename to delete
   * @destructive
   */
  async delete(params: { file: string }) {
    const file = this.normalizeFileName(params.file);
    const fullPath = this.resolveDeckPath(file);
    await fs.unlink(fullPath);
    const state = await this.getState();
    if (state.currentDeck === file) {
      const decks = await this.listDecks();
      const nextDeck = decks.length > 0 ? decks[0].file : 'slides.md';
      await this.memory.set('state', { ...state, currentDeck: nextDeck, currentSlide: 0 });
    }
    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  // ── Slide-Level Operations ──────────────────────────────────────────────

  /**
   * Insert a new slide at a position in the current deck
   * @param markdown Slide markdown content. Uses layout template if omitted
   * @param index Position to insert at (0-based). Appends if omitted
   * @param layout Layout template name {@choice title, content, two-column, image, quote, code, blank}
   */
  async add(params?: { markdown?: string; index?: number; layout?: string }) {
    const state = await this.getState();
    const { frontmatter, slides } = await this.parseDeck(state.currentDeck);

    const layout = SLIDE_LAYOUTS.find((l) => l.name === params?.layout);
    const slideContent = params?.markdown ?? layout?.markdown ?? '';
    const index =
      params?.index != null ? clamp(Math.trunc(params.index), 0, slides.length) : slides.length;

    slides.splice(index, 0, slideContent);
    const markdown = joinMarpMarkdown(frontmatter, slides);

    await this.saveDeckFile(state.currentDeck, markdown);
    const nextState: SlidesState = { ...state, currentSlide: index };
    await this.memory.set('state', nextState);

    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Replace a slide's content by index
   * @param index Zero-based slide index
   * @param markdown New markdown content for the slide
   */
  async edit(params: { index: number; markdown: string }) {
    const state = await this.getState();
    const { frontmatter, slides } = await this.parseDeck(state.currentDeck);
    const index = clamp(Math.trunc(params.index), 0, Math.max(slides.length - 1, 0));

    slides[index] = params.markdown;
    const markdown = joinMarpMarkdown(frontmatter, slides);

    await this.saveDeckFile(state.currentDeck, markdown);
    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Reorder a slide within the current deck
   * @param from Source slide index (0-based)
   * @param to Target slide index (0-based)
   */
  async move(params: { from: number; to: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = await this.parseDeck(state.currentDeck);
    const from = clamp(Math.trunc(params.from), 0, Math.max(slides.length - 1, 0));
    const to = clamp(Math.trunc(params.to), 0, Math.max(slides.length - 1, 0));

    if (from === to) return this.buildState();

    const [slide] = slides.splice(from, 1);
    slides.splice(to, 0, slide);
    const markdown = joinMarpMarkdown(frontmatter, slides);

    await this.saveDeckFile(state.currentDeck, markdown);
    const nextState: SlidesState = { ...state, currentSlide: to };
    await this.memory.set('state', nextState);

    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Delete a slide from the current deck
   * @param index Zero-based slide index to remove
   * @destructive
   */
  async remove(params: { index: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = await this.parseDeck(state.currentDeck);

    if (slides.length <= 1) {
      return { error: 'Cannot remove the last slide. Use delete() to remove the entire deck.' };
    }

    const index = clamp(Math.trunc(params.index), 0, Math.max(slides.length - 1, 0));
    slides.splice(index, 1);
    const markdown = joinMarpMarkdown(frontmatter, slides);

    await this.saveDeckFile(state.currentDeck, markdown);
    const currentSlide = clamp(state.currentSlide, 0, Math.max(slides.length - 1, 0));
    await this.memory.set('state', { ...state, currentSlide });

    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Duplicate a slide in the current deck
   * @param index Zero-based index of the slide to copy
   * @param targetIndex Position to insert the copy. Defaults to right after the original
   */
  async duplicate(params: { index: number; targetIndex?: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = await this.parseDeck(state.currentDeck);
    const index = clamp(Math.trunc(params.index), 0, Math.max(slides.length - 1, 0));
    const targetIndex =
      params.targetIndex != null
        ? clamp(Math.trunc(params.targetIndex), 0, slides.length)
        : index + 1;

    slides.splice(targetIndex, 0, slides[index]);
    const markdown = joinMarpMarkdown(frontmatter, slides);

    await this.saveDeckFile(state.currentDeck, markdown);
    const nextState: SlidesState = { ...state, currentSlide: targetIndex };
    await this.memory.set('state', nextState);

    const built = await this.buildState();
    this.broadcast('deckChanged', built);
    return built;
  }

  /**
   * Available slide layout templates
   * @readOnly
   * @internal
   */
  async templates() {
    return { layouts: SLIDE_LAYOUTS };
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  /** Move to the next slide */
  async next() {
    return this.goRelative(1);
  }

  /** Move to the previous slide */
  async previous() {
    return this.goRelative(-1);
  }

  /**
   * Jump to a slide
   * @param index Zero-based slide index
   */
  async go(params: { index: number }) {
    const state = await this.getState();
    const rendered = await this.renderDeck(state.currentDeck, state.theme);
    const currentSlide = clamp(
      Math.trunc(params.index),
      0,
      Math.max(rendered.slides.length - 1, 0)
    );
    const nextState: SlidesState = { ...state, currentSlide };
    await this.memory.set('state', nextState);
    const built = await this.buildState();
    this.broadcast('slideChanged', built);
    return built;
  }

  // ── Presentation Controls ───────────────────────────────────────────────

  /**
   * Lock or release navigation for viewers
   * @param locked When true, only presenter-mode clients should navigate
   */
  async lock(params: { locked: boolean }) {
    const state = await this.getState();
    const nextState: SlidesState = { ...state, locked: !!params.locked };
    await this.memory.set('state', nextState);
    const built = await this.buildState();
    this.broadcast('lockChanged', built);
    return built;
  }

  /**
   * Change the shared Marp theme
   * @param name Built-in Marp theme {@choice default, gaia, uncover}
   */
  async theme(params: { name: ThemeName }) {
    const themeName = normalizeTheme(params.name);
    const state = await this.getState();
    const nextState: SlidesState = { ...state, theme: themeName, currentSlide: 0 };
    await this.memory.set('state', nextState);
    const built = await this.buildState();
    this.broadcast('themeChanged', built);
    return built;
  }

  /**
   * Persist the preferred preview mode for the shared workspace
   * @param mode fit, actual, or overview {@choice fit, actual, overview}
   */
  async preview(params: { mode: PreviewMode }) {
    const mode = normalizePreview(params.mode);
    const state = await this.getState();
    const nextState: SlidesState = { ...state, preview: mode };
    await this.memory.set('state', nextState);
    const built = await this.buildState();
    this.broadcast('previewChanged', built);
    return built;
  }

  // ── Visual Export ───────────────────────────────────────────────────────

  /**
   * Return a PNG snapshot of a slide for AI review (degrades to SVG without resvg)
   * @param index Optional slide index. Defaults to current slide
   * @param write Save the file to disk {@default true}
   * @readOnly
   */
  async snapshot(params?: { index?: number; write?: boolean }) {
    const state = await this.getState();
    const rendered = await this.renderDeck(state.currentDeck, state.theme);
    const index = clamp(
      Math.trunc(params?.index ?? state.currentSlide),
      0,
      Math.max(rendered.slides.length - 1, 0)
    );
    const slideHtml = rendered.slides[index] || '<section><h1>Empty deck</h1></section>';
    const svg = this.renderSnapshotSvg(slideHtml, rendered.css);

    const snapshotDir = path.join(this.settings.folder, '.snapshots');
    const baseName = path.basename(state.currentDeck, '.md');

    if (Resvg) {
      const png = this.renderPng(svg, 1280, 720);
      const snapshotName = `${baseName}-slide-${String(index + 1).padStart(2, '0')}.png`;
      const snapshotPath = path.join(snapshotDir, snapshotName);
      if (params?.write !== false) {
        await fs.mkdir(snapshotDir, { recursive: true });
        await fs.writeFile(snapshotPath, png);
      }
      return {
        file: state.currentDeck,
        index,
        mimeType: 'image/png',
        path: snapshotPath,
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      };
    }

    // SVG fallback
    const snapshotName = `${baseName}-slide-${String(index + 1).padStart(2, '0')}.svg`;
    const snapshotPath = path.join(snapshotDir, snapshotName);
    if (params?.write !== false) {
      await fs.mkdir(snapshotDir, { recursive: true });
      await fs.writeFile(snapshotPath, svg, 'utf8');
    }
    return {
      file: state.currentDeck,
      index,
      mimeType: 'image/svg+xml',
      path: snapshotPath,
      svg,
    };
  }

  /**
   * Export the whole deck as a thumbnail matrix PNG for AI review
   * @param columns Number of columns in the matrix {@default 3}
   * @param write Save the file to disk {@default true}
   * @readOnly
   */
  async matrix(params?: { columns?: number; write?: boolean }) {
    const state = await this.getState();
    const rendered = await this.renderDeck(state.currentDeck, state.theme);
    const columns = clamp(Math.trunc(params?.columns ?? 3), 1, 6);
    const { svg, width, height } = this.renderMatrixSvg(rendered.slides, rendered.css, columns);

    const snapshotDir = path.join(this.settings.folder, '.snapshots');
    const baseName = path.basename(state.currentDeck, '.md');

    if (Resvg) {
      const png = this.renderPng(svg, width, height);
      const matrixName = `${baseName}-matrix.png`;
      const matrixPath = path.join(snapshotDir, matrixName);
      if (params?.write !== false) {
        await fs.mkdir(snapshotDir, { recursive: true });
        await fs.writeFile(matrixPath, png);
      }
      return {
        file: state.currentDeck,
        columns,
        slideCount: rendered.slides.length,
        mimeType: 'image/png',
        path: matrixPath,
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      };
    }

    // SVG fallback
    const matrixName = `${baseName}-matrix.svg`;
    const matrixPath = path.join(snapshotDir, matrixName);
    if (params?.write !== false) {
      await fs.mkdir(snapshotDir, { recursive: true });
      await fs.writeFile(matrixPath, svg, 'utf8');
    }
    return {
      file: state.currentDeck,
      columns,
      slideCount: rendered.slides.length,
      mimeType: 'image/svg+xml',
      path: matrixPath,
      svg,
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private async goRelative(delta: number) {
    const state = await this.getState();
    const rendered = await this.renderDeck(state.currentDeck, state.theme);
    const currentSlide = clamp(
      state.currentSlide + delta,
      0,
      Math.max(rendered.slides.length - 1, 0)
    );
    const nextState: SlidesState = { ...state, currentSlide };
    await this.memory.set('state', nextState);
    const built = await this.buildState();
    this.broadcast('slideChanged', built);
    return built;
  }

  private async buildState() {
    const state = await this.getState();
    const decks = await this.listDecks();
    const rendered = await this.renderDeck(state.currentDeck, state.theme);
    const slideCount = rendered.slides.length || 1;
    const currentSlide = clamp(state.currentSlide, 0, Math.max(slideCount - 1, 0));

    if (currentSlide !== state.currentSlide) {
      await this.memory.set('state', { ...state, currentSlide });
    }

    return {
      folder: this.settings.folder,
      decks,
      currentDeck: state.currentDeck,
      currentSlide,
      slideCount,
      locked: state.locked,
      theme: state.theme,
      preview: state.preview,
      markdown: rendered.markdown,
      rendered: {
        html: rendered.html,
        css: rendered.css,
        slides: rendered.slides,
        comments: rendered.comments,
      },
      current: {
        index: currentSlide,
        html:
          rendered.slides[currentSlide] ||
          rendered.slides[0] ||
          '<section><h1>Empty deck</h1></section>',
      },
    };
  }

  private async ensureWorkspace() {
    await fs.mkdir(this.settings.folder, { recursive: true });
    const defaultPath = this.resolveDeckPath('slides.md');
    if (!existsSync(defaultPath)) {
      await fs.writeFile(defaultPath, DEFAULT_DECK, 'utf8');
    }

    const current = await this.memory.get<SlidesState>('state');
    if (!current) {
      await this.memory.set('state', {
        currentDeck: 'slides.md',
        currentSlide: 0,
        locked: true,
        theme: 'default',
        preview: 'fit',
      } satisfies SlidesState);
    }
  }

  private async getState(): Promise<SlidesState> {
    await this.ensureWorkspace();
    const state = await this.memory.get<SlidesState>('state');
    return (
      state || {
        currentDeck: 'slides.md',
        currentSlide: 0,
        locked: true,
        theme: 'default',
        preview: 'fit',
      }
    );
  }

  private async listDecks(): Promise<DeckSummary[]> {
    await this.ensureWorkspace();
    const entries = await fs.readdir(this.settings.folder, { withFileTypes: true });
    const decks = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(async (entry) => {
          const fullPath = this.resolveDeckPath(entry.name);
          const stats = await fs.stat(fullPath);
          const markdown = await fs.readFile(fullPath, 'utf8');
          return {
            file: entry.name,
            title: firstHeading(markdown) || entry.name.replace(/\.md$/i, ''),
            updatedAt: stats.mtime.toISOString(),
            size: stats.size,
          };
        })
    );
    return decks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async parseDeck(file: string) {
    const fullPath = this.resolveDeckPath(file);
    const markdown = await fs.readFile(fullPath, 'utf8');
    return splitMarpMarkdown(markdown);
  }

  private async saveDeckFile(file: string, markdown: string) {
    const fullPath = this.resolveDeckPath(file);
    await fs.writeFile(fullPath, markdown, 'utf8');
  }

  private async renderDeck(file: string, theme: ThemeName) {
    const fullPath = this.resolveDeckPath(file);
    const markdown = await fs.readFile(fullPath, 'utf8');
    const themedMarkdown = applyTheme(markdown, theme);
    const rendered = this.marp.render(themedMarkdown);
    const slides = renderSlidesIndividually(this.marp, themedMarkdown);
    return {
      markdown,
      html: rendered.html,
      css: rendered.css,
      comments: rendered.comments,
      slides,
    };
  }

  private renderSnapshotSvg(slideHtml: string, css: string) {
    const escapedCss = escapeXml(css);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:1280px;height:720px;background:#111827;">
      <style>${escapedCss}</style>
      ${slideHtml}
    </div>
  </foreignObject>
</svg>`;
  }

  private renderMatrixSvg(slides: string[], css: string, columns: number) {
    const thumbWidth = 320;
    const thumbHeight = 180;
    const gap = 24;
    const labelHeight = 28;
    const rows = Math.max(1, Math.ceil(Math.max(slides.length, 1) / columns));
    const width = columns * thumbWidth + (columns + 1) * gap;
    const height = rows * (thumbHeight + labelHeight) + (rows + 1) * gap + 24;
    const scale = thumbWidth / 1280;
    const safeCss = escapeXml(css);

    const thumbs = (slides.length ? slides : ['<section><h1>Empty deck</h1></section>'])
      .map((slide, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = gap + col * (thumbWidth + gap);
        const y = gap + row * (thumbHeight + labelHeight + gap);
        return `
  <g transform="translate(${x}, ${y})">
    <rect width="${thumbWidth}" height="${thumbHeight + labelHeight}" rx="14" fill="#0f172a" stroke="rgba(148,163,184,0.24)" />
    <text x="14" y="18" fill="#cbd5e1" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12">Slide ${index + 1}</text>
    <foreignObject x="0" y="${labelHeight}" width="${thumbWidth}" height="${thumbHeight}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${thumbWidth}px;height:${thumbHeight}px;overflow:hidden;background:#111827;">
        <style>${safeCss}</style>
        <div style="width:1280px;height:720px;transform:scale(${scale});transform-origin:top left;">
          ${slide}
        </div>
      </div>
    </foreignObject>
  </g>`;
      })
      .join('\n');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#020617" />
  <text x="${gap}" y="26" fill="#e2e8f0" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" font-weight="700">${escapeXml(`Deck Matrix: ${slides.length} slide(s)`)}</text>
${thumbs}
</svg>`;
    return { svg, width, height };
  }

  private renderPng(svg: string, width: number, height: number) {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      background: 'rgba(0,0,0,0)',
    });
    const pngData = resvg.render({ width, height });
    return pngData.asPng();
  }

  private resolveDeckPath(file: string) {
    const safe = this.normalizeFileName(file);
    return path.join(this.settings.folder, safe);
  }

  private normalizeFileName(file: string) {
    const trimmed = path.basename(file || 'slides.md').trim() || 'slides.md';
    return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
  }

  private broadcast(event: string, data: unknown) {
    this.emit({ event, data });
  }
}

// ── Pure Helpers ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function normalizeTheme(theme?: string): ThemeName {
  if (theme === 'gaia' || theme === 'uncover') return theme;
  return 'default';
}

function normalizePreview(mode?: string): PreviewMode {
  if (mode === 'actual' || mode === 'overview') return mode;
  return 'fit';
}

function firstHeading(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || '';
}

function starterDeck(title: string) {
  return `---
marp: true
theme: default
paginate: true
---

# ${title}

Add your opening story here.

---

## Why This Matters

- Problem
- Insight
- Opportunity

---

## Next Step

Describe the outcome or ask.`;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function applyTheme(markdown: string, theme: ThemeName) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatter) {
    return `---\nmarp: true\ntheme: ${theme}\n---\n\n${markdown}`;
  }

  let body = frontmatter[1];
  if (/\btheme\s*:/m.test(body)) {
    body = body.replace(/\btheme\s*:\s*.*$/m, `theme: ${theme}`);
  } else {
    body += `\ntheme: ${theme}`;
  }

  if (!/\bmarp\s*:/m.test(body)) {
    body = `marp: true\n${body}`;
  }

  return markdown.replace(frontmatter[0], `---\n${body}\n---\n`);
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSlidesIndividually(marp: any, markdown: string) {
  const { frontmatter, slides } = splitMarpMarkdown(markdown);
  return slides.map((slideMarkdown) => {
    const rendered = marp.render(`${frontmatter}\n\n${slideMarkdown.trim()}\n`);
    return rendered.html;
  });
}

function splitMarpMarkdown(markdown: string) {
  const frontmatterMatch = markdown.match(/^---\n[\s\S]*?\n---\n*/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[0].trimEnd() : '---\nmarp: true\n---';
  const body = frontmatterMatch ? markdown.slice(frontmatterMatch[0].length) : markdown;

  const slides: string[] = [];
  let current: string[] = [];

  for (const line of body.split('\n')) {
    if (line.trim() === '---') {
      slides.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }

  slides.push(current.join('\n').trim());

  return {
    frontmatter,
    slides: slides.filter((slide) => slide.length > 0),
  };
}

function joinMarpMarkdown(frontmatter: string, slides: string[]): string {
  return `${frontmatter}\n\n${slides.join('\n\n---\n\n')}\n`;
}
