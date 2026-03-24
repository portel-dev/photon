/**
 * Slides — AI-Native Presentation Tool
 *
 * Each instance is a deck: `_use('quarterly-review')` → `quarterly-review.md`.
 * Pass a full path to open any markdown file: `_use('/path/to/deck.md')`.
 *
 * Slides are Marp-compatible markdown rendered natively by Beam's
 * `@format slides` viewer — no custom UI, no external dependencies.
 *
 * @version 2.0.0
 * @runtime ^1.14.0
 * @tags presentation, slides, markdown, marp, ai-control
 * @icon 📽️
 * @stateful
 */
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_DECK = `---
marp: true
theme: default
paginate: true
transition: fade
---
# AI-Native Slides
### Powered by Marp & Photon

---

# How it works

1. **AI generates Marp markdown**
2. **Beam renders high-fidelity slides**
3. **Navigate with keyboard or buttons**

---

# Try it!

Ask me to:
- "Add a slide about the benefits of AI"
- "Change the theme to gaia"
- "Edit slide 2 with new content"
`;

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

  // ── File Resolution ──────────────────────────────────────────

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
    const dir = this.defaultFolder;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (!existsSync(this.deckPath)) {
      await fs.writeFile(this.deckPath, DEFAULT_DECK, 'utf8');
    }
  }

  // ── Presentation ─────────────────────────────────────────────

  /**
   * Open the presentation
   * @format slides
   * @autorun
   * @readOnly
   */
  async main() {
    return await this.readDeck();
  }

  /**
   * Move to the next slide
   */
  async next() {
    const md = await this.readDeck();
    const total = this.countSlides(md);
    const state = await this.getState();
    if (state.currentSlide < total - 1) {
      state.currentSlide++;
      await this.memory.set('state', state);
    }
    this.emit({ event: 'slideChanged', data: { index: state.currentSlide } });
    return `Slide ${state.currentSlide + 1} of ${total}`;
  }

  /**
   * Move to the previous slide
   */
  async previous() {
    const state = await this.getState();
    if (state.currentSlide > 0) {
      state.currentSlide--;
      await this.memory.set('state', state);
    }
    this.emit({ event: 'slideChanged', data: { index: state.currentSlide } });
    return `Slide ${state.currentSlide + 1}`;
  }

  /**
   * Jump to a specific slide
   * @param index 0-based slide index
   */
  async go({ index }: { index: number }) {
    const md = await this.readDeck();
    const total = this.countSlides(md);
    const state = await this.getState();
    state.currentSlide = clamp(Math.trunc(index), 0, Math.max(total - 1, 0));
    await this.memory.set('state', state);
    this.emit({ event: 'slideChanged', data: { index: state.currentSlide } });
    return `Slide ${state.currentSlide + 1} of ${total}`;
  }

  // ── Deck Management ──────────────────────────────────────────

  /**
   * List saved decks in the slides folder
   * @format table
   * @readOnly
   */
  async list() {
    const dir = this.defaultFolder;
    if (!existsSync(dir)) return [];
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
            slides: countSeparators(md),
            updated: stat.mtime.toISOString().slice(0, 16).replace('T', ' '),
          };
        })
    );
    return decks.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  /**
   * Read the current deck's raw markdown
   * @format markdown
   * @readOnly
   */
  async read() {
    return await this.readDeck();
  }

  /**
   * Save markdown to the current deck and show result
   * @param markdown Full Marp markdown content
   * @format slides
   */
  async save({ markdown }: { markdown: string }) {
    await fs.writeFile(this.deckPath, markdown, 'utf8');
    this.emit({ event: 'deckChanged', data: { file: path.basename(this.deckPath) } });
    return markdown;
  }

  /**
   * Update the full markdown and re-render
   * @param markdown New Marp markdown content
   * @format slides
   */
  async update({ markdown }: { markdown: string }) {
    return this.save({ markdown });
  }

  // ── Slide-Level Operations ───────────────────────────────────

  /**
   * Insert a new slide at a position
   * @param markdown Slide content (without --- separators)
   * @param index Position to insert (appends if omitted)
   * @format slides
   */
  async add(params?: { markdown?: string; index?: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const content = params?.markdown ?? '# New Slide\n\nAdd your content here';
    const index =
      params?.index != null ? clamp(Math.trunc(params.index), 0, slides.length) : slides.length;
    slides.splice(index, 0, content);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    await this.memory.set('state', { currentSlide: index });
    this.emit({ event: 'deckChanged', data: { file: path.basename(this.deckPath) } });
    return newMd;
  }

  /**
   * Replace a slide's content
   * @param index Slide index
   * @param markdown New content for the slide
   * @format slides
   */
  async edit({ index, markdown }: { index: number; markdown: string }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides[i] = markdown;
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    this.emit({ event: 'deckChanged', data: { file: path.basename(this.deckPath) } });
    return newMd;
  }

  /**
   * Reorder a slide
   * @param from Source index
   * @param to Target index
   * @format slides
   */
  async move({ from, to }: { from: number; to: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const f = clamp(Math.trunc(from), 0, Math.max(slides.length - 1, 0));
    const t = clamp(Math.trunc(to), 0, Math.max(slides.length - 1, 0));
    if (f === t) return md;
    const [slide] = slides.splice(f, 1);
    slides.splice(t, 0, slide);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    await this.memory.set('state', { currentSlide: t });
    this.emit({ event: 'deckChanged', data: { file: path.basename(this.deckPath) } });
    return newMd;
  }

  /**
   * Delete a slide
   * @param index Slide index
   * @destructive
   * @format slides
   */
  async remove({ index }: { index: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    if (slides.length <= 1) return md;
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides.splice(i, 1);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    const cur = clamp(i, 0, Math.max(slides.length - 1, 0));
    await this.memory.set('state', { currentSlide: cur });
    this.emit({ event: 'deckChanged', data: { file: path.basename(this.deckPath) } });
    return newMd;
  }

  /**
   * Duplicate a slide
   * @param index Slide index to copy
   * @format slides
   */
  async duplicate({ index }: { index: number }) {
    const md = await this.readDeck();
    const { frontmatter, slides } = splitMarpMarkdown(md);
    const i = clamp(Math.trunc(index), 0, Math.max(slides.length - 1, 0));
    slides.splice(i + 1, 0, slides[i]);
    const newMd = joinMarpMarkdown(frontmatter, slides);
    await fs.writeFile(this.deckPath, newMd, 'utf8');
    await this.memory.set('state', { currentSlide: i + 1 });
    this.emit({ event: 'deckChanged', data: { file: path.basename(this.deckPath) } });
    return newMd;
  }

  // ── Context ──────────────────────────────────────────────────

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
      currentContent: slides[state.currentSlide] || '',
      nextSlidePreview: slides[state.currentSlide + 1] || null,
    };
  }

  // ── Private ──────────────────────────────────────────────────

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

  private countSlides(markdown: string): number {
    return countSeparators(markdown);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(v) ? v : min, min), max);
}

function firstHeading(md: string) {
  return md.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function countSeparators(md: string): number {
  const fm = md.match(/^---\n[\s\S]*?\n---\n*/);
  const body = fm ? md.slice(fm[0].length) : md;
  return body.split(/\n---\s*\n/).length;
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
