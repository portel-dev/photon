/**
 * Built-in format seed for the unified registry.
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track A.
 *
 * Seeds the seven core HTTP-target formats: json, html, markdown, csv, yaml,
 * xml, plain. The MIME-mapping core comes from @portel/cli's `formatToMimeType`
 * for parity with CLI rendering. Renderers here are minimal but functional —
 * they cover the cases the spec calls out and fall back to JSON via the
 * registry's fallback contract for everything else.
 *
 * Other targets (cli, beam, mcp) are seeded by their own modules. This file
 * intentionally only registers HTTP renderers.
 */

import { FormatRegistry, type FormatSpec, type RenderResult } from './registry.js';

function utf8(body: string, mime: string): RenderResult {
  return { body, mime: mime.includes('charset=') ? mime : `${mime}; charset=utf-8` };
}

function renderJsonHttp(value: unknown): RenderResult {
  return utf8(JSON.stringify(value, null, 2), 'application/json');
}

function renderPlainHttp(value: unknown): RenderResult {
  if (typeof value === 'string') return utf8(value, 'text/plain');
  return utf8(JSON.stringify(value, null, 2), 'text/plain');
}

function renderMarkdownHttp(value: unknown): RenderResult {
  if (typeof value === 'string') return utf8(value, 'text/markdown');
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    const rows = value as Array<Record<string, unknown>>;
    const cols = Array.from(
      rows.reduce<Set<string>>((acc, r) => {
        Object.keys(r).forEach((k) => acc.add(k));
        return acc;
      }, new Set())
    );
    const header = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${cols.map((c) => formatCell(r[c])).join(' | ')} |`).join('\n');
    return utf8(`${header}\n${body}\n`, 'text/markdown');
  }
  return utf8(JSON.stringify(value, null, 2), 'text/markdown');
}

function renderHtmlHttp(value: unknown): RenderResult {
  if (typeof value === 'string') {
    return utf8(value, 'text/html');
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    const rows = value as Array<Record<string, unknown>>;
    const cols = Array.from(
      rows.reduce<Set<string>>((acc, r) => {
        Object.keys(r).forEach((k) => acc.add(k));
        return acc;
      }, new Set())
    );
    const head = `<thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows
      .map(
        (r) => `<tr>${cols.map((c) => `<td>${escapeHtml(formatCell(r[c]))}</td>`).join('')}</tr>`
      )
      .join('')}</tbody>`;
    return utf8(`<!doctype html><meta charset="utf-8"><table>${head}${body}</table>`, 'text/html');
  }
  return utf8(
    `<!doctype html><meta charset="utf-8"><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`,
    'text/html'
  );
}

function renderCsvHttp(value: unknown): RenderResult | undefined {
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== 'object') {
    // CSV only meaningful for tabular arrays. Returning undefined lets the
    // negotiator fall through to the next preference (or JSON).
    return undefined;
  }
  const rows = value as Array<Record<string, unknown>>;
  const cols = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  );
  const header = cols.map(csvEscape).join(',');
  const lines = rows.map((r) => cols.map((c) => csvEscape(formatCell(r[c]))).join(','));
  return utf8([header, ...lines].join('\n') + '\n', 'text/csv');
}

function renderYamlHttp(value: unknown): RenderResult {
  return utf8(yamlStringify(value), 'text/yaml');
}

function renderXmlHttp(value: unknown): RenderResult {
  return utf8(
    `<?xml version="1.0" encoding="UTF-8"?>\n${xmlStringify('root', value)}`,
    'application/xml'
  );
}

function renderTableHttp(value: unknown): RenderResult {
  // @format table renders as HTML by default for HTTP target.
  return renderHtmlHttp(value);
}

// ── Helpers ──

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function yamlStringify(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return `${pad}null`;
  if (typeof value === 'string')
    return value.includes('\n') ? `|-\n${pad}  ${value.replace(/\n/g, `\n${pad}  `)}` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((v) => `${pad}- ${yamlStringify(v, indent + 1).replace(/^\s+/, '')}`)
      .join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => {
        const rendered = yamlStringify(v, indent + 1);
        if (typeof v === 'object' && v !== null) {
          return `${pad}${k}:\n${rendered}`;
        }
        return `${pad}${k}: ${rendered}`;
      })
      .join('\n');
  }
  // Symbol / function — last resort.
  return JSON.stringify(value) ?? '';
}

function xmlStringify(tag: string, value: unknown): string {
  if (value === null || value === undefined) return `<${tag}/>`;
  if (typeof value === 'string') {
    return `<${tag}>${escapeHtml(value)}</${tag}>`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `<${tag}>${escapeHtml(value.toString())}</${tag}>`;
  }
  if (typeof value !== 'object') {
    return `<${tag}>${escapeHtml(JSON.stringify(value) ?? '')}</${tag}>`;
  }
  if (Array.isArray(value)) {
    return `<${tag}>${value.map((v) => xmlStringify('item', v)).join('')}</${tag}>`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return `<${tag}>${entries.map(([k, v]) => xmlStringify(k, v)).join('')}</${tag}>`;
}

// ── Registration ──

export function seedDefaultFormats(registry: FormatRegistry): void {
  const specs: FormatSpec[] = [
    {
      name: 'json',
      primaryTarget: 'http',
      httpMime: 'application/json',
      isCanonicalForMime: true,
      render: { http: renderJsonHttp },
      fallback: 'json',
    },
    {
      name: 'plain',
      primaryTarget: 'cli',
      httpMime: 'text/plain',
      isCanonicalForMime: true,
      render: { http: renderPlainHttp },
      fallback: 'json',
    },
    {
      name: 'markdown',
      primaryTarget: 'cli',
      httpMime: 'text/markdown',
      isCanonicalForMime: true,
      render: { http: renderMarkdownHttp },
      fallback: 'json',
    },
    {
      name: 'html',
      primaryTarget: 'http',
      httpMime: 'text/html',
      isCanonicalForMime: true,
      render: { http: renderHtmlHttp },
      fallback: 'json',
    },
    {
      name: 'table',
      primaryTarget: 'beam',
      httpMime: 'text/html',
      isCanonicalForMime: false,
      render: { http: renderTableHttp },
      fallback: 'json',
    },
    {
      name: 'csv',
      primaryTarget: 'http',
      httpMime: 'text/csv',
      isCanonicalForMime: true,
      render: {
        http: (value) =>
          renderCsvHttp(value) ?? {
            body: JSON.stringify(value),
            mime: 'application/json; charset=utf-8',
          },
      },
      fallback: 'json',
    },
    {
      name: 'yaml',
      primaryTarget: 'cli',
      httpMime: 'text/yaml',
      isCanonicalForMime: true,
      render: { http: renderYamlHttp },
      fallback: 'json',
    },
    {
      name: 'xml',
      primaryTarget: 'cli',
      httpMime: 'application/xml',
      isCanonicalForMime: true,
      render: { http: renderXmlHttp },
      fallback: 'json',
    },
  ];

  for (const spec of specs) registry.register(spec);
}

/** Singleton registry preloaded with built-ins. Use this from server code. */
let _shared: FormatRegistry | undefined;
export function getDefaultRegistry(): FormatRegistry {
  if (!_shared) {
    _shared = new FormatRegistry();
    seedDefaultFormats(_shared);
  }
  return _shared;
}
