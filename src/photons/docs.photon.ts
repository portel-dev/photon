/**
 * Docs — Markdown Document Editor with PDF Export
 *
 * A document editor backed by plain markdown files with YAML frontmatter.
 * Each instance is a document: `_use('quarterly-report')` → `quarterly-report.md`.
 * Pass a full path to open any file: `_use('/path/to/doc.md')`.
 *
 * Features page-aware preview via Paged.js, TOC generation, footnotes,
 * custom containers (note/warning/tip), multi-column layouts, and PDF export.
 *
 * @version 1.0.0
 * @runtime ^1.14.0
 * @tags document, markdown, pdf, writing, authoring
 * @icon 📄
 * @stateful
 * @ui editor ./ui/docs.html
 */
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_DOC = `---
title: Untitled Document
author: ""
date: ${new Date().toISOString().split('T')[0]}
size: A4
margins:
  top: 2.5cm
  bottom: 2.5cm
  left: 3cm
  right: 2cm
header:
  right: "{date}"
footer:
  center: "Page {page} of {pages}"
toc: false
numbersections: false
theme: default
---

# Untitled Document

Start writing here. This is a plain markdown document with superpowers.

## Features

- **YAML frontmatter** controls page layout, headers, footers, and theme
- **Page breaks** with \`---pagebreak---\`
- **Footnotes** with \`[^1]\` syntax
- **Callout boxes** with \`::: note\`, \`::: warning\`, \`::: tip\`
- **Multi-column layouts** with \`::: columns\`
- **Table of contents** with \`[[toc]]\`
- **PDF export** that matches exactly what you see

## Next Steps

Ask AI to help you write, restructure, or format this document.
`;

export default class Docs {
  protected settings = {
    /** @property Directory where document files are stored */
    folder: path.join(os.homedir(), 'Documents', 'docs'),
  };

  declare memory: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  declare emit: (payload: { event: string; data: unknown }) => void;
  declare instanceName: string;

  // ── File Resolution ─────────────────────────────────────────────────────

  private get defaultFolder(): string {
    return this.settings?.folder || path.join(os.homedir(), 'Documents', 'docs');
  }

  private get docPath(): string {
    const name = this.instanceName || 'untitled';
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
    if (!existsSync(this.docPath)) {
      await fs.writeFile(this.docPath, DEFAULT_DOC, 'utf8');
    }
  }

  // ── Editor ──────────────────────────────────────────────────────────────

  /**
   * Open the document editor UI
   * @ui editor
   * @autorun
   */
  async main() {
    const markdown = await this.readDoc();
    const { frontmatter, body } = parseFrontmatter(markdown);
    const outline = buildOutline(body);
    return {
      file: path.basename(this.docPath),
      markdown,
      frontmatter,
      outline,
      stats: computeStats(body),
    };
  }

  /**
   * Read the document markdown
   * @readOnly
   */
  async read() {
    return { file: path.basename(this.docPath), markdown: await this.readDoc() };
  }

  /**
   * Save the full document markdown
   * @param markdown Full markdown content with YAML frontmatter
   * @ui editor
   */
  async save({ markdown }: { markdown: string }) {
    await fs.writeFile(this.docPath, markdown, 'utf8');
    const { frontmatter, body } = parseFrontmatter(markdown);
    const result = {
      file: path.basename(this.docPath),
      markdown,
      frontmatter,
      outline: buildOutline(body),
      stats: computeStats(body),
    };
    this.emit({ event: 'docChanged', data: result });
    return result;
  }

  // ── Structural Editing ──────────────────────────────────────────────────

  /**
   * Get the document's heading structure for navigation
   * @readOnly
   */
  async outline() {
    const body = getBody(await this.readDoc());
    return { outline: buildOutline(body) };
  }

  /**
   * Edit a specific section by heading path
   * @param section Heading text or path like "Chapter 3/Introduction"
   * @param markdown New content for that section (everything under the heading until next same-level heading)
   * @ui editor
   */
  async edit({ section, markdown: newContent }: { section: string; markdown: string }) {
    const doc = await this.readDoc();
    const { frontmatterRaw, body } = splitDoc(doc);
    const updated = replaceSection(body, section, newContent);
    if (updated === null) return { error: `Section "${section}" not found` };
    const full = frontmatterRaw + updated;
    await fs.writeFile(this.docPath, full, 'utf8');
    const { frontmatter } = parseFrontmatter(full);
    const result = {
      file: path.basename(this.docPath),
      markdown: full,
      frontmatter,
      outline: buildOutline(updated),
      stats: computeStats(updated),
    };
    this.emit({ event: 'docChanged', data: result });
    return result;
  }

  /**
   * Append content at the end of the document or after a specific section
   * @param markdown Content to append
   * @param after Optional heading text — inserts after that section instead of end
   * @ui editor
   */
  async append({ markdown: content, after }: { markdown: string; after?: string }) {
    const doc = await this.readDoc();
    const { frontmatterRaw, body } = splitDoc(doc);
    let updated: string;
    if (after) {
      updated = insertAfterSection(body, after, content);
    } else {
      updated = body.trimEnd() + '\n\n' + content + '\n';
    }
    const full = frontmatterRaw + updated;
    await fs.writeFile(this.docPath, full, 'utf8');
    const { frontmatter } = parseFrontmatter(full);
    const result = {
      file: path.basename(this.docPath),
      markdown: full,
      frontmatter,
      outline: buildOutline(updated),
      stats: computeStats(updated),
    };
    this.emit({ event: 'docChanged', data: result });
    return result;
  }

  // ── Search & Replace ────────────────────────────────────────────────────

  /**
   * Find text in the document with optional fuzzy matching
   * @param query Search text
   * @param fuzzy Enable fuzzy matching {@default false}
   * @param scope Limit search to a section heading
   * @readOnly
   */
  async find({ query, fuzzy, scope }: { query: string; fuzzy?: boolean; scope?: string }) {
    const body = getBody(await this.readDoc());
    const searchIn = scope ? extractSection(body, scope) || body : body;
    const lines = searchIn.split('\n');
    const queryLower = query.toLowerCase();

    const matches: { line: number; text: string; context: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      const found = fuzzy ? fuzzyMatch(lineLower, queryLower) : lineLower.includes(queryLower);
      if (found) {
        matches.push({
          line: i + 1,
          text: lines[i],
          context: lines.slice(Math.max(0, i - 1), i + 2).join('\n'),
        });
      }
    }
    return { query, fuzzy: !!fuzzy, scope: scope || null, matches, total: matches.length };
  }

  /**
   * Find and replace text in the document
   * @param pattern Text to find (string or regex pattern)
   * @param replacement Replacement text
   * @param scope Limit to a section heading
   * @param all Replace all occurrences {@default true}
   * @ui editor
   */
  async replace({
    pattern,
    replacement,
    scope,
    all,
  }: {
    pattern: string;
    replacement: string;
    scope?: string;
    all?: boolean;
  }) {
    const doc = await this.readDoc();
    const { frontmatterRaw, body } = splitDoc(doc);

    let target = scope ? extractSection(body, scope) || body : body;
    const replaceAll = all !== false;

    let count = 0;
    if (replaceAll) {
      const parts = target.split(pattern);
      count = parts.length - 1;
      target = parts.join(replacement);
    } else {
      if (target.includes(pattern)) {
        target = target.replace(pattern, replacement);
        count = 1;
      }
    }

    const updated = scope ? body.replace(extractSection(body, scope) || '', target) : target;
    const full = frontmatterRaw + updated;
    await fs.writeFile(this.docPath, full, 'utf8');
    const { frontmatter } = parseFrontmatter(full);
    const result = {
      file: path.basename(this.docPath),
      markdown: full,
      frontmatter,
      outline: buildOutline(updated),
      stats: computeStats(updated),
      replacements: count,
    };
    this.emit({ event: 'docChanged', data: result });
    return result;
  }

  // ── Document Management ─────────────────────────────────────────────────

  /**
   * List saved documents in the docs folder
   * @readOnly
   */
  async list() {
    const dir = this.defaultFolder;
    if (!existsSync(dir)) return { folder: dir, docs: [] };
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const docs = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name));
          const md = await fs.readFile(path.join(dir, e.name), 'utf8');
          const { frontmatter } = parseFrontmatter(md);
          const body = getBody(md);
          return {
            file: e.name,
            title: (frontmatter as any).title || firstHeading(body) || e.name.replace(/\.md$/i, ''),
            author: (frontmatter as any).author || '',
            updatedAt: stat.mtime.toISOString(),
            wordCount: body.split(/\s+/).filter(Boolean).length,
          };
        })
    );
    return { folder: dir, docs: docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }

  /**
   * Generate table of contents from the document structure
   * @readOnly
   */
  async toc() {
    const body = getBody(await this.readDoc());
    const outline = buildOutline(body);
    const tocMarkdown = outline.map((h) => `${'  '.repeat(h.level - 1)}- ${h.text}`).join('\n');
    return { outline, markdown: tocMarkdown };
  }

  /**
   * Document statistics: word count, reading time, section breakdown
   * @readOnly
   */
  async stats() {
    const body = getBody(await this.readDoc());
    return computeStats(body);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async readDoc(): Promise<string> {
    try {
      return await fs.readFile(this.docPath, 'utf8');
    } catch {
      return DEFAULT_DOC;
    }
  }
}

// ── Pure Helpers ──────────────────────────────────────────────────────────

function parseFrontmatter(markdown: string): { frontmatter: Record<string, any>; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: markdown };
  const yamlText = match[1];
  const body = markdown.slice(match[0].length);
  // Simple YAML parser for flat/nested values
  const frontmatter: Record<string, any> = {};
  let currentKey = '';
  let currentNested: Record<string, string> | null = null;
  for (const line of yamlText.split('\n')) {
    const nestedMatch = line.match(/^  (\w+):\s*(.+)/);
    if (nestedMatch && currentKey) {
      if (!currentNested) currentNested = {};
      currentNested[nestedMatch[1]] = nestedMatch[2].replace(/^["']|["']$/g, '');
      frontmatter[currentKey] = currentNested;
      continue;
    }
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      if (currentNested) currentNested = null;
      currentKey = kvMatch[1];
      const val = kvMatch[2].replace(/^["']|["']$/g, '').trim();
      if (val === 'true') frontmatter[currentKey] = true;
      else if (val === 'false') frontmatter[currentKey] = false;
      else if (val === '' || val === '""') frontmatter[currentKey] = '';
      else if (/^\d+$/.test(val)) frontmatter[currentKey] = parseInt(val, 10);
      else frontmatter[currentKey] = val;
    }
  }
  return { frontmatter, body };
}

function splitDoc(markdown: string): { frontmatterRaw: string; body: string } {
  const match = markdown.match(/^(---\n[\s\S]*?\n---\n?)/);
  if (!match) return { frontmatterRaw: '', body: markdown };
  return { frontmatterRaw: match[1], body: markdown.slice(match[1].length) };
}

function getBody(markdown: string): string {
  return splitDoc(markdown).body;
}

interface HeadingEntry {
  level: number;
  text: string;
  line: number;
}

function buildOutline(body: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
    }
  }
  return headings;
}

function computeStats(body: string) {
  const words = body.split(/\s+/).filter(Boolean).length;
  const chars = body.length;
  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim().length > 0).length;
  const headings = buildOutline(body);
  const readingTime = Math.max(1, Math.ceil(words / 200));

  // Per-section word counts
  const sections = headings.map((h, i) => {
    const start = body.indexOf(body.split('\n')[h.line - 1]);
    const nextHeading = headings[i + 1];
    const end = nextHeading ? body.indexOf(body.split('\n')[nextHeading.line - 1]) : body.length;
    const sectionText = body.slice(start, end);
    return {
      heading: h.text,
      level: h.level,
      words: sectionText.split(/\s+/).filter(Boolean).length,
    };
  });

  return { words, chars, paragraphs, headings: headings.length, readingTime, sections };
}

function firstHeading(body: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function extractSection(body: string, heading: string): string | null {
  const lines = body.split('\n');
  let startLine = -1;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match && match[2].trim().toLowerCase() === heading.toLowerCase()) {
      startLine = i;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startLine === -1) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= headingLevel) {
      endLine = i;
      break;
    }
  }

  return lines.slice(startLine, endLine).join('\n');
}

function replaceSection(body: string, heading: string, newContent: string): string | null {
  const lines = body.split('\n');
  let startLine = -1;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match && match[2].trim().toLowerCase() === heading.toLowerCase()) {
      startLine = i;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startLine === -1) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= headingLevel) {
      endLine = i;
      break;
    }
  }

  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine);
  return [...before, newContent, ...after].join('\n');
}

function insertAfterSection(body: string, heading: string, content: string): string {
  const lines = body.split('\n');
  let headingLevel = 0;
  let insertAt = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match && match[2].trim().toLowerCase() === heading.toLowerCase()) {
      headingLevel = match[1].length;
      // Find end of this section
      for (let j = i + 1; j < lines.length; j++) {
        const nextMatch = lines[j].match(/^(#{1,6})\s+/);
        if (nextMatch && nextMatch[1].length <= headingLevel) {
          insertAt = j;
          break;
        }
      }
      if (insertAt === lines.length) insertAt = lines.length;
      break;
    }
  }

  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, '', content, '', ...after].join('\n');
}

function fuzzyMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}
