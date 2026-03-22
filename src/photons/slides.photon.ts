/**
 * Slides — AI-Native Presentation Tool
 *
 * Each instance is a deck: `_use('quarterly-review')` → `quarterly-review.md`.
 * Pass a full path to open any markdown file: `_use('/path/to/deck.md')`.
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
import { existsSync, mkdirSync } from 'fs';
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

let Marp: any;

export default class Slides {
  protected settings = {
    /** @property Directory where slide markdown files are stored */
    folder: path.join(os.homedir(), 'Documents', 'slides'),
  };

  declare memory: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  declare emit: (payload: { event: string; data: unknown }) => void;
  declare instanceName: string;

  private marp: any;

  // ── File Resolution (same pattern as Spreadsheet) ───────────────────────

  private get defaultFolder(): string {
    return this.settings?.folder || path.join(os.homedir(), 'Documents', 'slides');
  }

  private get deckPath(): string {
    const name = this.instanceName || 'slides';
    if (path.isAbsolute(name)) return name.endsWith('.md') ? name : name + '.md';
    if (name.includes('/') || name.includes('\\')) {
      const resolved = path.resolve(name);
      return resolved.endsWith('.md') ? resolved : resolved + '.md';
    }
    const dir = this.defaultFolder;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path.join(dir, name.endsWith('.md') ? name : name + '.md');
  }

  async onInitialize() {
    const marpId = '@marp-team/marp-core';
    const marpModule = await import(/* webpackIgnore: true */ marpId);
    Marp = marpModule.Marp || marpModule.default;
    this.marp = new Marp({ container: false, inlineSVG: true, html: true });

    // Ensure folder exists
    const dir = this.defaultFolder;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Create default deck if this is the default instance and file doesn't exist
    if (!existsSync(this.deckPath)) {
      await fs.writeFile(this.deckPath, DEFAULT_DECK, 'utf8');
    }

    // Initialize slide position if not stored
    const state = await this.memory.get<any>('state');
    if (!state) {
      await this.memory.set('state', { currentSlide: 0 });
    }
  }

  // ── Presentation ────────────────────────────────────────────────────────

  /**
   * Open the presentation UI
   * @ui dashboard
   * @autorun
   */
  async main() {
    const markdown = await this.readDeck();
    const state = await this.getState();
    return this.renderResult(markdown, state.currentSlide);
  }

  /**
   * Move to the next slide
   * @ui dashboard
   */
  async next() {
    const markdown = await this.readDeck();
    const total = this.countSlides(markdown);
    const state = await this.getState();
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
    const markdown = await this.readDeck();
    const total = this.countSlides(markdown);
    const state = await this.getState();
    state.currentSlide = clamp(Math.trunc(index), 0, Math.max(total - 1, 0));
    await this.memory.set('state', state);
    this.emit({ event: 'slideChanged', data: { type: 'nav', index: state.currentSlide } });
    return { type: 'nav', index: state.currentSlide };
  }

  // ── Deck Management ─────────────────────────────────────────────────────

  /**
   * List saved decks in the slides folder
   * @readOnly
   */
  async list() {
    const dir = this.defaultFolder;
    if (!existsSync(dir)) return { folder: dir, decks: [] };
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const decks = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name));
          const md = await fs.readFile(path.join(dir, e.name), 'utf8');
          return {
            file: e.name,
            title: firstHeading(md) || e.name.replace(/\.md$/i, ''),
            updatedAt: stat.mtime.toISOString(),
          };
        })
    );
    return { folder: dir, decks: decks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }

  /**
   * Read the current deck's markdown
   * @readOnly
   */
  async read() {
    return { file: path.basename(this.deckPath), markdown: await this.readDeck() };
  }

  /**
   * Save markdown to the current deck
   * @param markdown Full Marp markdown content
   * @ui dashboard
   */
  async save({ markdown }: { markdown: string }) {
    await fs.writeFile(this.deckPath, markdown, 'utf8');
    const state = await this.getState();
    const result = this.renderResult(markdown, state.currentSlide);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Update the full markdown and re-render
   * @param markdown New Marp markdown content
   * @ui dashboard
   */
  async update({ markdown }: { markdown: string }) {
    return this.save({ markdown });
  }

  // ── Slide-Level Operations ──────────────────────────────────────────────

  /**
   * Insert a new slide at a position
   * @param markdown Slide content
   * @param index Position to insert (appends if omitted)
   * @ui dashboard
   */
  async add(params?: { markdown?: string; index?: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const content = params?.markdown ?? '';
    const index =
      params?.index != null ? clamp(Math.trunc(params.index), 0, slides.length) : slides.length;
    slides.splice(index, 0, content);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    await this.memory.set('state', { currentSlide: index });
    const result = this.renderResult(newMd, index);
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
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides[i] = markdown;
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    const result = this.renderResult(newMd, i);
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
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const f = clamp(Math.trunc(from), 0, Math.max(slides.length - 1, 0));
    const t = clamp(Math.trunc(to), 0, Math.max(slides.length - 1, 0));
    if (f === t) return this.renderResult(md, f);
    const [slide] = slides.splice(f, 1);
    slides.splice(t, 0, slide);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    await this.memory.set('state', { currentSlide: t });
    const result = this.renderResult(newMd, t);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Delete a slide
   * @param index Slide index
   * @destructive
   * @ui dashboard
   */
  async remove({ index }: { index: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    if (slides.length <= 1) return { error: 'Cannot remove the last slide' };
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides.splice(i, 1);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    const cur = clamp(i, 0, Math.max(slides.length - 1, 0));
    await this.memory.set('state', { currentSlide: cur });
    const result = this.renderResult(newMd, cur);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  /**
   * Duplicate a slide
   * @param index Slide index to copy
   * @ui dashboard
   */
  async duplicate({ index }: { index: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides.splice(i + 1, 0, slides[i]);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    await this.memory.set('state', { currentSlide: i + 1 });
    const result = this.renderResult(newMd, i + 1);
    this.emit({ event: 'deckChanged', data: result });
    return result;
  }

  // ── Context ─────────────────────────────────────────────────────────────

  /**
   * Current presentation state for AI context
   * @readOnly
   */
  async status() {
    const md = await this.readDeck();
    const { slides } = splitMarpMarkdown(md);
    const state = await this.getState();
    return {
      file: path.basename(this.deckPath),
      currentSlide: state.currentSlide,
      totalSlides: slides.length,
      currentContent: slides[state.currentSlide],
      nextSlidePreview: slides[state.currentSlide + 1] || null,
      markdown: md,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async readDeck(): Promise<string> {
    try {
      return await fs.readFile(this.deckPath, 'utf8');
    } catch {
      return DEFAULT_DECK;
    }
  }

  private async getState() {
    return (await this.memory.get<any>('state')) || { currentSlide: 0 };
  }

  private renderResult(markdown: string, currentSlide: number) {
    const { html, css } = this.marp.render(markdown);
    const total = (html.match(/<section/g) || []).length;
    return {
      type: 'render',
      html,
      css,
      total,
      current: clamp(currentSlide, 0, Math.max(total - 1, 0)),
      markdown,
    };
  }

  private countSlides(markdown: string): number {
    const { html } = this.marp.render(markdown);
    return (html.match(/<section/g) || []).length;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(v) ? v : min, min), max);
}

function firstHeading(md: string) {
  return md.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function splitMarpMarkdown(markdown: string) {
  const fm = markdown.match(/^---\n[\s\S]*?\n---\n*/);
  const frontmatter = fm ? fm[0].trimEnd() : '---\nmarp: true\n---';
  const body = fm ? markdown.slice(fm[0].length) : markdown;
  const slides: string[] = [];
  let cur: string[] = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '---') {
      slides.push(cur.join('\n').trim());
      cur = [];
      continue;
    }
    cur.push(line);
  }
  slides.push(cur.join('\n').trim());
  return { frontmatter, slides: slides.filter((s) => s.length > 0) };
}

function joinMarpMarkdown(frontmatter: string, slides: string[]): string {
  return `${frontmatter}\n\n${slides.join('\n\n---\n\n')}\n`;
}
