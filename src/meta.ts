/**
 * _meta — Transport-agnostic system parameter namespace
 *
 * Clients attach `_meta` to tool call arguments for system-level hints.
 * The runtime strips it before method invocation — methods never see it.
 *
 * Supported keys:
 *   format   — Output format: csv, json, yaml, markdown, html
 *   viewport — Container size hint: { width, height? }
 *   fields   — Field projection: { include?: [], exclude?: [] }
 *   locale   — Localization: { language?, timezone? }
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MetaParams {
  format?: string;
  viewport?: { width: number; height?: number };
  fields?: { include?: string[]; exclude?: string[] };
  locale?: { language?: string; timezone?: string };
}

export interface MetaFormattedResult {
  _metaFormatted: true;
  text: string;
  mimeType: string;
}

// Default formats available for all methods (trivial serialization)
const DEFAULT_EXPORT_FORMATS = ['json', 'yaml'];

// ═══════════════════════════════════════════════════════════════════════════════
// STRIP & APPLY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract `_meta` from tool call arguments.
 * Returns clean args (without _meta) and the extracted meta params.
 */
export function stripMeta(args: Record<string, unknown>): {
  cleanArgs: Record<string, unknown>;
  meta?: MetaParams;
} {
  if (!args || typeof args !== 'object' || !('_meta' in args)) {
    return { cleanArgs: args };
  }
  const { _meta, ...cleanArgs } = args;
  return { cleanArgs, meta: _meta as MetaParams };
}

/**
 * Apply _meta transformations to a tool result.
 * Pipeline: field selection → format transformation.
 *
 * @param result - Raw method return value
 * @param meta - Extracted _meta params
 * @param exportFormats - Allowed formats from @export tag (undefined = defaults)
 * @returns Transformed result, or MetaFormattedResult wrapper for text formats
 */
export function applyMeta(result: unknown, meta: MetaParams, exportFormats?: string[]): unknown {
  let processed = result;

  // 1. Field selection (before format, so format works on filtered data)
  if (meta.fields) {
    processed = applyFieldSelection(processed, meta.fields);
  }

  // 2. Format transformation
  if (meta.format) {
    return applyFormatTransformation(processed, meta.format, exportFormats);
  }

  return processed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

function applyFieldSelection(
  data: unknown,
  fields: { include?: string[]; exclude?: string[] }
): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => applyFieldSelection(item, fields));
  }

  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const obj = data as Record<string, unknown>;

  if (fields.include && fields.include.length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const key of fields.include) {
      if (key in obj) filtered[key] = obj[key];
    }
    return filtered;
  }

  if (fields.exclude && fields.exclude.length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (!fields.exclude.includes(key)) filtered[key] = value;
    }
    return filtered;
  }

  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMAT TRANSFORMATION
// ═══════════════════════════════════════════════════════════════════════════════

function applyFormatTransformation(
  data: unknown,
  format: string,
  exportFormats?: string[]
): MetaFormattedResult {
  const allowed = exportFormats ?? DEFAULT_EXPORT_FORMATS;
  if (!allowed.includes(format)) {
    // Return error as a formatted result so the client gets a clear message
    return {
      _metaFormatted: true,
      text: `Format '${format}' not supported. Supported: ${allowed.join(', ')}`,
      mimeType: 'text/plain',
    } satisfies MetaFormattedResult;
  }

  switch (format) {
    case 'json':
      return {
        _metaFormatted: true,
        text: toJson(data),
        mimeType: 'application/json',
      };
    case 'yaml':
      return {
        _metaFormatted: true,
        text: toYaml(data),
        mimeType: 'text/yaml',
      };
    case 'csv':
      return {
        _metaFormatted: true,
        text: toCsv(data),
        mimeType: 'text/csv',
      };
    case 'markdown':
      return {
        _metaFormatted: true,
        text: toMarkdownTable(data),
        mimeType: 'text/markdown',
      };
    case 'html':
      return {
        _metaFormatted: true,
        text: toHtmlTable(data),
        mimeType: 'text/html',
      };
    default:
      return {
        _metaFormatted: true,
        text: `Format '${format}' is not yet implemented`,
        mimeType: 'text/plain',
      } satisfies MetaFormattedResult;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERIALIZERS
// ═══════════════════════════════════════════════════════════════════════════════

function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Minimal YAML serializer — no external dependency.
 * Handles primitives, arrays, and nested objects.
 */
function toYaml(data: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (data === null || data === undefined) return `${pad}null`;
  if (typeof data === 'boolean') return `${pad}${data}`;
  if (typeof data === 'number') return `${pad}${data}`;
  if (typeof data === 'string') {
    // Quote strings that could be ambiguous
    if (
      data === '' ||
      data === 'true' ||
      data === 'false' ||
      data === 'null' ||
      data.includes('\n') ||
      data.includes(':') ||
      data.includes('#') ||
      /^\d/.test(data)
    ) {
      return `${pad}${JSON.stringify(data)}`;
    }
    return `${pad}${data}`;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return `${pad}[]`;
    return data
      .map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) return `${pad}- {}`;
          const [firstKey, firstVal] = entries[0];
          const firstLine = `${pad}- ${firstKey}: ${yamlValue(firstVal)}`;
          const rest = entries
            .slice(1)
            .map(([k, v]) => `${pad}  ${k}: ${yamlValue(v)}`)
            .join('\n');
          return rest ? `${firstLine}\n${rest}` : firstLine;
        }
        return `${pad}- ${yamlValue(item)}`;
      })
      .join('\n');
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `${pad}${key}:\n${toYaml(value, indent + 1)}`;
        }
        return `${pad}${key}: ${yamlValue(value)}`;
      })
      .join('\n');
  }

  return `${pad}${typeof data === 'object' ? JSON.stringify(data) : String(data as string | number | boolean)}`;
}

function yamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (
      value === '' ||
      value === 'true' ||
      value === 'false' ||
      value === 'null' ||
      value.includes('\n') ||
      value.includes(':') ||
      value.includes('#') ||
      /^\d/.test(value)
    ) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value as string | number | boolean);
}

/**
 * CSV serializer — RFC 4180 compliant.
 * Handles arrays of objects (tabular data) and single objects.
 */
function toCsv(data: unknown): string {
  const rows = normalizeToRows(data);
  if (rows.length === 0) return '';

  const columns = Object.keys(rows[0]);
  const header = columns.map(csvEscape).join(',');
  const body = rows.map((row) => columns.map((col) => csvEscape(row[col])).join(',')).join('\n');

  return `${header}\n${body}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
  // RFC 4180: quote fields containing comma, newline, or double-quote
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Markdown table serializer.
 */
function toMarkdownTable(data: unknown): string {
  const rows = normalizeToRows(data);
  if (rows.length === 0) return '_No data_';

  const columns = Object.keys(rows[0]);
  const header = `| ${columns.join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${columns.map((col) => mdEscape(row[col])).join(' | ')} |`)
    .join('\n');

  return `${header}\n${separator}\n${body}`;
}

function mdEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * HTML table serializer.
 */
function toHtmlTable(data: unknown): string {
  const rows = normalizeToRows(data);
  if (rows.length === 0) return '<p>No data</p>';

  const columns = Object.keys(rows[0]);
  const headerCells = columns.map((col) => `<th>${htmlEscape(col)}</th>`).join('');
  const bodyRows = rows
    .map((row) => {
      const cells = columns.map((col) => `<td>${htmlEscape(row[col])}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('\n');

  return `<table>\n<thead><tr>${headerCells}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>`;
}

function htmlEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize data to an array of flat objects for tabular serializers.
 * Single objects become a one-row table. Primitives become [{ value: x }].
 */
function normalizeToRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    // Array of objects → use directly
    if (typeof data[0] === 'object' && data[0] !== null) {
      return data as Record<string, unknown>[];
    }
    // Array of primitives → wrap each
    return data.map((v) => ({ value: v }));
  }

  if (typeof data === 'object' && data !== null) {
    return [data as Record<string, unknown>];
  }

  if (data !== null && data !== undefined) {
    return [{ value: data }];
  }

  return [];
}
