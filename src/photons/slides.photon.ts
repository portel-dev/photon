/**
 * Slides — AI-Native Presentation Tool
 *
 * Manages presentations using the Marp Markdown format.
 * Supports real-time AI-controlled slide transitions and high-fidelity rendering.
 *
 * @version 1.0.0
 * @runtime ^1.14.0
 * @dependencies @marp-team/marp-core@^4.3.0
 * @tags presentation, slides, markdown, marp, ai-control
 * @icon 📽️
 * @stateful
 * @ui dashboard ./ui/slides.html
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_DECK = `---
marp: true
theme: default
paginate: true
---
# AI-Native Slides
### Powered by Marp & Photon
---
# How it works
1. **AI Generates Marp Markdown**
2. **Photon Renders High-Fidelity CSS/HTML**
3. **UI Bridge Syncs the View**
---
# Try it!
Ask me to:
- "Add a slide about the benefits of AI"
- "Change the theme to 'gaia'"
- "Go to the next slide"
`;

// Lazy-loaded Marp dependency
let Marp: any;

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
    const marpId = '@marp-team/marp-core';
    const marpModule = await import(/* webpackIgnore: true */ marpId);
    Marp = marpModule.Marp || marpModule.default;
    this.marp = new Marp({ container: false, inlineSVG: true, html: true });

    await fs.mkdir(this.settings.folder, { recursive: true });

    // Ensure default deck exists
    const defaultPath = path.join(this.settings.folder, 'slides.md');
    if (!existsSync(defaultPath)) {
      await fs.writeFile(defaultPath, DEFAULT_DECK, 'utf8');
    }

    // Initialize state if not present
    const current = await this.memory.get<any>('state');
    if (!current) {
      await this.memory.set('state', {
        currentDeck: 'slides.md',
        currentSlide: 0,
        markdown: DEFAULT_DECK,
      });
    }
  }

  // ── Presentation ────────────────────────────────────────────────────────

  /**
   * Open the presentation UI
   * @ui dashboard
   * @autorun
   */
  async main() {
    const state = await this.getState();
    if (!state.markdown) {
      state.markdown = await this.readDeckFile(state.currentDeck);
      await this.memory.set('state', state);
    }
    return this.renderDeck(state);
  }

  /**
   * Move to the next slide
   * @ui dashboard
   */
  async next() {
    const state = await this.getState();
    const total = this.countSlides(state.markdown);
    if (state.currentSlide < total - 1) {
      state.currentSlide++;
      await this.memory.set('state', state);
    }
    this.emit({ event: 'slideChanged', data: { type: 'nav', index: state.currentSlide } });
    return { type: 'nav', index: state.currentSlide, isEnd: state.currentSlide === total - 1 };
  }

  /**
   * Move to the previous slide
   * @ui dashboard
   */
  async previous() {
    const state = await this.getState();
    if (state.currentSlide > 0) {
      state.currentSlide--;
      await this.memory.set('state', state);
    }
    this.emit({ event: 'slideChanged', data: { type: 'nav', index: state.currentSlide } });
    return { type: 'nav', index: state.currentSlide, isStart: state.currentSlide === 0 };
  }

  /**
   * Jump to a specific slide
   * @param index 0-based slide index
   * @ui dashboard
   */
  async go({ index }: { index: number }) {
    const state = await this.getState();
    const total = this.countSlides(state.markdown);
    state.currentSlide = clamp(Math.trunc(index), 0, Math.max(total - 1, 0));
    await this.memory.set('state', state);
    this.emit({ event: 'slideChanged', data: { type: 'nav', index: state.currentSlide } });
    return { type: 'nav', index: state.currentSlide };
  }

  // ── Deck Management ─────────────────────────────────────────────────────

  /**
   * List saved markdown decks
   * @readOnly
   */
  async list() {
    const entries = await fs.readdir(this.settings.folder, { withFileTypes: true });
    const decks = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map(async (e) => {
          const stat = await fs.stat(path.join(this.settings.folder, e.name));
          const md = await fs.readFile(path.join(this.settings.folder, e.name), 'utf8');
          return {
            file: e.name,
            title: firstHeading(md) || e.name.replace(/\.md$/i, ''),
            updatedAt: stat.mtime.toISOString(),
          };
        })
    );
    return {
      folder: this.settings.folder,
      decks: decks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  /**
   * Load a deck from markdown string or file
   * @param source Marp Markdown content or filename in slides folder
   * @ui dashboard
   */
  async load({ source }: { source: string }) {
    let markdown = source;
    const filePath = path.join(this.settings.folder, this.normalizeFileName(source));
    if (source.endsWith('.md') && existsSync(filePath)) {
      markdown = await fs.readFile(filePath, 'utf8');
    }

    const state = await this.getState();
    state.markdown = markdown;
    state.currentSlide = 0;
    state.currentDeck = this.normalizeFileName(source);
    await this.memory.set('state', state);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Save the current deck to a file
   * @param file Filename (defaults to current deck)
   * @param markdown Optional markdown override
   * @ui dashboard
   */
  async save(params?: { file?: string; markdown?: string }) {
    const state = await this.getState();
    const file = this.normalizeFileName(params?.file || state.currentDeck || 'slides.md');
    const markdown = params?.markdown || state.markdown;
    const fullPath = path.join(this.settings.folder, file);
    await fs.writeFile(fullPath, markdown, 'utf8');

    state.currentDeck = file;
    state.markdown = markdown;
    await this.memory.set('state', state);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Update the full markdown content
   * @param markdown New Marp markdown content
   * @ui dashboard
   */
  async update({ markdown }: { markdown: string }) {
    const state = await this.getState();
    state.markdown = markdown;
    await this.memory.set('state', state);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  // ── Slide-Level Operations ──────────────────────────────────────────────

  /**
   * Insert a new slide at a position
   * @param markdown Slide markdown content
   * @param index Position to insert (appends if omitted)
   * @ui dashboard
   */
  async add(params?: { markdown?: string; index?: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = splitMarpMarkdown(state.markdown);
    const content = params?.markdown ?? '';
    const index =
      params?.index != null ? clamp(Math.trunc(params.index), 0, slides.length) : slides.length;

    slides.splice(index, 0, content);
    state.markdown = joinMarpMarkdown(frontmatter, slides);
    state.currentSlide = index;
    await this.memory.set('state', state);
    await this.saveDeckFile(state.currentDeck, state.markdown);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Replace a slide's content
   * @param index Slide index
   * @param markdown New content
   * @ui dashboard
   */
  async edit({ index, markdown }: { index: number; markdown: string }) {
    const state = await this.getState();
    const { frontmatter, slides } = splitMarpMarkdown(state.markdown);
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));

    slides[i] = markdown;
    state.markdown = joinMarpMarkdown(frontmatter, slides);
    await this.memory.set('state', state);
    await this.saveDeckFile(state.currentDeck, state.markdown);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Reorder a slide
   * @param from Source index
   * @param to Target index
   * @ui dashboard
   */
  async move({ from, to }: { from: number; to: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = splitMarpMarkdown(state.markdown);
    const f = clamp(Math.trunc(from), 0, Math.max(slides.length - 1, 0));
    const t = clamp(Math.trunc(to), 0, Math.max(slides.length - 1, 0));
    if (f === t) return this.renderDeck(state);

    const [slide] = slides.splice(f, 1);
    slides.splice(t, 0, slide);
    state.markdown = joinMarpMarkdown(frontmatter, slides);
    state.currentSlide = t;
    await this.memory.set('state', state);
    await this.saveDeckFile(state.currentDeck, state.markdown);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Delete a slide
   * @param index Slide index to remove
   * @destructive
   * @ui dashboard
   */
  async remove({ index }: { index: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = splitMarpMarkdown(state.markdown);
    if (slides.length <= 1) return { error: 'Cannot remove the last slide' };

    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides.splice(i, 1);
    state.markdown = joinMarpMarkdown(frontmatter, slides);
    state.currentSlide = clamp(state.currentSlide, 0, Math.max(slides.length - 1, 0));
    await this.memory.set('state', state);
    await this.saveDeckFile(state.currentDeck, state.markdown);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Duplicate a slide
   * @param index Slide index to copy
   * @ui dashboard
   */
  async duplicate({ index }: { index: number }) {
    const state = await this.getState();
    const { frontmatter, slides } = splitMarpMarkdown(state.markdown);
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));

    slides.splice(i + 1, 0, slides[i]);
    state.markdown = joinMarpMarkdown(frontmatter, slides);
    state.currentSlide = i + 1;
    await this.memory.set('state', state);
    await this.saveDeckFile(state.currentDeck, state.markdown);

    const result = this.renderDeck(state);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  // ── Read-Only ───────────────────────────────────────────────────────────

  /**
   * Current presentation state for AI context
   * @readOnly
   */
  async status() {
    const state = await this.getState();
    const { slides } = splitMarpMarkdown(state.markdown);
    return {
      currentSlide: state.currentSlide,
      totalSlides: slides.length,
      currentContent: slides[state.currentSlide],
      nextSlidePreview: slides[state.currentSlide + 1] || null,
      currentDeck: state.currentDeck,
      markdown: state.markdown,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private renderDeck(state: any) {
    const { html, css } = this.marp.render(state.markdown);
    const total = (html.match(/<section/g) || []).length;
    return {
      type: 'render',
      html,
      css,
      total,
      current: state.currentSlide,
      markdown: state.markdown,
    };
  }

  private countSlides(markdown: string): number {
    const { html } = this.marp.render(markdown);
    return (html.match(/<section/g) || []).length;
  }

  private async getState() {
    let state = await this.memory.get<any>('state');
    if (!state) {
      const markdown = await this.readDeckFile('slides.md');
      state = { currentDeck: 'slides.md', currentSlide: 0, markdown };
      await this.memory.set('state', state);
    }
    return state;
  }

  private async readDeckFile(file: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.settings.folder, file), 'utf8');
    } catch {
      return DEFAULT_DECK;
    }
  }

  private async saveDeckFile(file: string, markdown: string) {
    const fullPath = path.join(this.settings.folder, this.normalizeFileName(file));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, markdown, 'utf8');
  }

  private normalizeFileName(file: string) {
    const trimmed = path.basename(file || 'slides.md').trim() || 'slides.md';
    return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function firstHeading(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || '';
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
  return { frontmatter, slides: slides.filter((s) => s.length > 0) };
}

function joinMarpMarkdown(frontmatter: string, slides: string[]): string {
  return `${frontmatter}\n\n${slides.join('\n\n---\n\n')}\n`;
}
