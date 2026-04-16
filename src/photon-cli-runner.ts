/**
 * Photon CLI Runner
 *
 * Allows direct invocation of Photon methods from the command line
 * Example: photon cli lg-remote discover
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import {
  SchemaExtractor,
  setPromptHandler,
  setElicitHandler,
  elicitReadline,
} from '@portel/photon-core';
import * as readline from 'readline';
import chalk from 'chalk';

// Bun sets chalk.level = 0 even on interactive terminals.
// The CLI runner is always user-facing — force color support.
if (chalk.level === 0) {
  chalk.level = 1;
}

import { highlight } from 'cli-highlight';
import { getDefaultContext, resolvePhotonFromAllSources } from './context.js';
import { PhotonLoader, clearRenderZone } from './loader.js';
import { fileURLToPath } from 'url';
import { getBundledPhotonPath } from './shared-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// getBundledPhotonPath is imported from shared-utils.js

/**
 * Resolve photon path - checks bundled first, then all discovery sources
 * (local workspace > ~/.photon > null)
 */
async function resolvePhotonPathWithBundled(name: string): Promise<string | null> {
  // Check bundled photons first
  const bundledPath = getBundledPhotonPath(name, __dirname);
  if (bundledPath) {
    return bundledPath;
  }

  // Fall back to merged discovery (local workspace > global)
  return resolvePhotonFromAllSources(name);
}
import { PhotonDocExtractor } from './photon-doc-extractor.js';
import { ensureDaemon } from './daemon/manager.js';
import { sendCommand, pingDaemon } from './daemon/client.js';
import {
  formatOutput as rawBaseFormatOutput,
  renderNone,
  OutputFormat,
  formatKey,
} from './cli-formatter.js';

const BASE_FORMATS = new Set([
  'primitive',
  'list',
  'table',
  'tree',
  'card',
  'tabs',
  'accordion',
  'none',
  'json',
  'markdown',
  'yaml',
  'xml',
  'html',
  'code',
]);

function baseFormatOutput(data: any, hint?: OutputFormat): void {
  const safeHint =
    hint && (BASE_FORMATS.has(hint as string) || (hint as string).startsWith('code:'))
      ? hint
      : undefined;
  rawBaseFormatOutput(data, safeHint);
}
import { getErrorMessage, exitWithError, ExitCode } from './shared/error-handler.js';
import * as os from 'os';

/**
 * Check if shell integration has been installed (photon init cli).
 * When installed, users can invoke photons directly (e.g., `whatsapp connect`)
 * instead of `photon cli whatsapp connect`, so help output should reflect that.
 */
let _shellInitCached: boolean | undefined;
function isShellIntegrationInstalled(): boolean {
  if (_shellInitCached !== undefined) return _shellInitCached;
  const shell = process.env.SHELL || '';
  const isZsh = shell.includes('zsh');
  const rcFile = isZsh ? path.join(os.homedir(), '.zshrc') : path.join(os.homedir(), '.bashrc');
  try {
    _shellInitCached = readFileSync(rcFile, 'utf-8').includes('# photon shell integration');
  } catch {
    _shellInitCached = false;
  }
  return _shellInitCached;
}

/**
 * Returns the CLI prefix for help output.
 * If shell integration is installed, returns just the photon name.
 * Otherwise returns `photon cli <name>`.
 */
function cliPrefix(photonName: string): string {
  return isShellIntegrationInstalled() ? photonName : `photon cli ${photonName}`;
}

export interface MethodInfo {
  name: string;
  params: {
    name: string;
    type: string;
    optional: boolean;
    description?: string;
    label?: string; // Custom label from {@label} tag
    example?: string; // Example value from {@example} tag
    enum?: string[]; // Valid enum values from JSON Schema
  }[];
  description?: string;
  format?: OutputFormat;
  buttonLabel?: string; // Custom button label from @returns {@label}
  scheduled?: string; // Cron expression for scheduled methods
  webhook?: boolean; // Whether this is a webhook handler
}

function unwrapNestedParamsSchema(
  schema: any
): { type: 'object'; properties: Record<string, any>; required?: string[] } | null {
  if (!schema?.properties || typeof schema.properties !== 'object') {
    return null;
  }

  const propNames = Object.keys(schema.properties);
  if (propNames.length !== 1 || propNames[0] !== 'params') {
    return null;
  }

  const nested = schema.properties.params;
  if (
    !nested ||
    nested.type !== 'object' ||
    !nested.properties ||
    typeof nested.properties !== 'object'
  ) {
    return null;
  }

  return {
    type: 'object',
    properties: nested.properties,
    ...(Array.isArray(nested.required) ? { required: nested.required } : {}),
  };
}

interface MarkdownBlock {
  title?: string;
  markdown: string;
  metadata: Record<string, string>;
  hadFrontMatter: boolean;
}

/**
 * Strip JSDoc tags from descriptions (e.g., @emits, @internal, @deprecated)
 */
function stripJSDocTags(description: string | undefined): string {
  if (!description) return '';
  // Remove lines that start with @ (full line removal)
  let cleaned = description
    .split('\n')
    .filter((line) => !line.trim().startsWith('@'))
    .join('\n')
    .trim();
  // Also remove inline @ tags (e.g., "text @emits ... " at end of line)
  cleaned = cleaned.replace(/\s*@\w+.*$/gm, '').trim();
  return cleaned;
}

/**
 * Extract the photon's class-level description from its JSDoc
 */
async function extractPhotonDescription(filePath: string): Promise<string> {
  const source = await fs.readFile(filePath, 'utf-8');
  const jsdocMatch = source.match(/\/\*\*([\s\S]*?)\*\//);
  if (!jsdocMatch) return '';

  const lines = jsdocMatch[1].split('\n').map((line) => line.replace(/^\s*\*\s?/, ''));
  const descLines: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('@') || line.startsWith('#')) break;
    if (line.length > 0) descLines.push(line);
  }
  return descLines.join(' ').trim();
}

/**
 * Extract all public async methods from a photon file
 */
async function extractMethods(filePath: string): Promise<MethodInfo[]> {
  const source = await fs.readFile(filePath, 'utf-8');
  const extractor = new SchemaExtractor();
  const metadata = extractor.extractAllFromSource(source);

  // Clean JSDoc tags from all tool descriptions
  const toolsToConvert = metadata.tools.map((t) => ({
    ...t,
    description: stripJSDocTags(t.description),
  }));

  // Add auto-generated settings tool if the photon has `protected settings`
  if (metadata.settingsSchema?.hasSettings) {
    const properties: Record<string, any> = {};
    for (const prop of metadata.settingsSchema.properties) {
      properties[prop.name] = {
        type: prop.type,
        description: prop.description,
      };
    }
    toolsToConvert.push({
      name: 'settings',
      description: 'View or update settings',
      inputSchema: { type: 'object', properties, required: [] },
    } as any);
  }

  return toolsToConvert.map((tool) => {
    const params: MethodInfo['params'] = [];
    const schema = unwrapNestedParamsSchema(tool.inputSchema) || tool.inputSchema;

    if (schema?.properties) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        // Resolve type from anyOf/oneOf union schemas (e.g. number | string)
        let type = prop.type;
        if (!type && (prop.anyOf || prop.oneOf)) {
          const variants = (prop.anyOf || prop.oneOf) as { type?: string }[];
          type = variants
            .map((v) => v.type)
            .filter(Boolean)
            .join(' | ');
        }
        params.push({
          name,
          type: type || 'any',
          optional: !schema.required?.includes(name),
          description: prop.description,
          ...(prop.title ? { label: prop.title } : {}),
          ...(prop.examples?.[0] !== undefined ? { example: String(prop.examples[0]) } : {}),
          ...(prop.enum ? { enum: prop.enum.map(String) } : {}),
        });
      }
    }

    return {
      name: tool.name,
      params,
      description: tool.description !== 'No description' ? tool.description : undefined,
      ...(tool.outputFormat ? { format: tool.outputFormat } : {}),
      ...(tool.buttonLabel ? { buttonLabel: tool.buttonLabel } : {}),
      ...((tool as any).scheduled ? { scheduled: (tool as any).scheduled } : {}),
      ...((tool as any).webhook !== undefined ? { webhook: true } : {}),
    };
  });
}

/**
 * Extract object property types from TypeScript type annotation
 * Examples:
 *   "{ mute?: boolean } | boolean" -> [["mute", { type: "boolean", optional: true }]]
 *   "{ level?: number | string }" -> [["level", { type: "number", optional: true }]]
 */

/**
 * Format output for display to the user (with error handling)
 * Wraps the base formatter with success/error response handling
 * @returns true if successful, false if error
 */
function formatOutput(result: any, formatHint?: OutputFormat): boolean {
  let hint = formatHint;

  // Handle @format json — render syntax-highlighted JSON for any data type
  if ((hint as string) === 'json' && result !== undefined && result !== null) {
    const formatted = JSON.stringify(result, null, 2);
    import('cli-highlight')
      .then(({ highlight }) => {
        console.log(highlight(formatted, { language: 'json', ignoreIllegals: true }));
      })
      .catch(() => {
        console.log(formatted);
      });
    return true;
  }

  // Handle @format qr — render QR code in terminal
  if ((hint as string) === 'qr' && result) {
    // Support both plain string results and object results with qr/value/url/link keys
    const qrValue =
      typeof result === 'string'
        ? result
        : typeof result === 'object'
          ? result.qr || result.value || result.url || result.link
          : null;
    if (qrValue && typeof qrValue === 'string') {
      if (typeof result === 'object' && result.message) {
        console.log(result.message);
      }
      import('qrcode')
        .then((qrcode) => {
          (
            qrcode.toString as (
              text: string,
              opts: { type: string; small: boolean }
            ) => Promise<string>
          )(qrValue, { type: 'terminal', small: true })
            .then((qrString: string) => console.log('\n' + qrString))
            .catch(() => console.log(`[QR] ${qrValue}`));
        })
        .catch(() => console.log(`[QR] ${qrValue}`));
      return true;
    }
    if (typeof result === 'object' && result.message) {
      console.log(result.message);
      return true;
    }
  }

  // Handle @format checklist — render as ASCII checkbox list
  if ((hint as string) === 'checklist' && Array.isArray(result)) {
    const textKey = (i: any) => i.text || i.title || i.name || i.task || i.label || '';
    const isDone = (i: any) => !!(i.done || i.completed || i.checked);
    const undone = result.filter((i: any) => !isDone(i));
    const done = result.filter((i: any) => isDone(i));
    const sorted = [...undone, ...done];
    console.log(chalk.dim(`${done.length}/${result.length} done\n`));
    for (const item of sorted) {
      if (isDone(item)) {
        console.log(`  ${chalk.green('✓')} ${chalk.strikethrough.dim(textKey(item))}`);
      } else {
        console.log(`  ${chalk.dim('○')} ${textKey(item)}`);
      }
    }
    return true;
  }

  // Handle @format markdown with array — render each item with ghost syntax
  if ((hint as string) === 'markdown' && Array.isArray(result)) {
    const items = result.filter((s: any) => typeof s === 'string' && s.trim());
    items.forEach((item: string, i: number) => {
      console.log(chalk.dim(`── Result ${i + 1}/${items.length} ──`));
      renderMarkdownNicely(item.trim());
      if (i < items.length - 1) console.log('');
    });
    return true;
  }

  // Handle formats that the base formatter doesn't support in CLI.
  // These fall through silently in @portel/cli's formatDataWithHint switch.
  // We intercept here and render using available primitives.
  if (hint && result !== undefined && result !== null) {
    const hintStr = hint as string;

    // slides — render as paginated markdown in terminal
    if ((hintStr === 'slides' || hintStr === 'presentation') && typeof result === 'string') {
      // Strip frontmatter
      let content = result;
      const fmMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
      if (fmMatch) content = content.slice(fmMatch[0].length);
      const slides = content.split(/\n---\s*\n/).filter((s: string) => s.trim());
      slides.forEach((slide: string, i: number) => {
        console.log(chalk.dim(`── Slide ${i + 1}/${slides.length} ──`));
        console.log(slide.trim());
        if (i < slides.length - 1) console.log();
      });
      return true;
    }

    // mermaid — render as code block (it's a text DSL)
    if (hintStr === 'mermaid' && typeof result === 'string') {
      console.log(chalk.dim('── mermaid ──'));
      console.log(result);
      console.log(chalk.dim('─'.repeat(40)));
      return true;
    }

    // kv — key-value pairs, render as table
    if (hintStr === 'kv' && typeof result === 'object' && !Array.isArray(result)) {
      baseFormatOutput(result, 'table');
      return true;
    }

    // grid — tabular data, render as table
    if (hintStr === 'grid') {
      baseFormatOutput(result, 'table');
      return true;
    }

    // chips — tags/labels, render as list
    if (hintStr === 'chips') {
      const items = Array.isArray(result)
        ? result
        : typeof result === 'object'
          ? Object.values(result)
          : [result];
      baseFormatOutput(items, 'list');
      return true;
    }

    // metric — single value with optional label
    if (hintStr === 'metric') {
      if (typeof result === 'object' && result !== null) {
        const label = result.label || result.name || result.title || '';
        const value = result.value ?? result.count ?? result.total ?? '';
        const unit = result.unit || '';
        console.log(
          label
            ? `${chalk.dim(label + ':')} ${chalk.bold(String(value))}${unit ? ' ' + unit : ''}`
            : chalk.bold(String(value))
        );
      } else {
        console.log(chalk.bold(String(result)));
      }
      return true;
    }

    // gauge — like metric with optional range
    if (hintStr === 'gauge') {
      if (typeof result === 'object' && result !== null) {
        const label = result.label || result.name || '';
        const value = Number(result.value ?? result.current ?? 0);
        const max = Number(result.max ?? result.total ?? 100);
        const pct = max > 0 ? Math.round((value / max) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((pct / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        console.log(`${label ? chalk.dim(label + ': ') : ''}${bar} ${pct}% (${value}/${max})`);
      } else {
        console.log(chalk.bold(String(result)));
      }
      return true;
    }

    // chart / chart:* — render data as table with note
    if (hintStr === 'chart' || hintStr.startsWith('chart:')) {
      const chartType = hintStr.includes(':') ? hintStr.split(':')[1] : 'chart';
      console.log(chalk.dim(`── ${chartType} (data) ──`));
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else if (typeof result === 'object') {
        baseFormatOutput(result, 'table');
      } else {
        console.log(String(result));
      }
      return true;
    }

    // timeline — sequential entries, render as table
    if (hintStr === 'timeline') {
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else {
        baseFormatOutput(result, 'tree');
      }
      return true;
    }

    // dashboard — multi-section view, render as tree
    if (hintStr === 'dashboard') {
      baseFormatOutput(result, 'tree');
      return true;
    }

    // cart — itemized list, render as table
    if (hintStr === 'cart') {
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else if (typeof result === 'object') {
        baseFormatOutput(result, 'tree');
      } else {
        console.log(String(result));
      }
      return true;
    }

    // panels — sectioned content, render as tree
    if (hintStr === 'panels') {
      baseFormatOutput(result, 'tree');
      return true;
    }

    // stack — vertical layout, render as tree
    if (hintStr === 'stack') {
      baseFormatOutput(result, 'tree');
      return true;
    }

    // columns — multi-column layout, render as table
    if (hintStr === 'columns') {
      if (Array.isArray(result)) {
        baseFormatOutput(result, 'table');
      } else {
        baseFormatOutput(result, 'tree');
      }
      return true;
    }
  }

  // Handle _photonType structured data (e.g., table, collection)
  if (result && typeof result === 'object' && result._photonType) {
    // If the object has toJSON(), call it to get the plain data (e.g., Table instances have private fields)
    const data = typeof result.toJSON === 'function' ? result.toJSON() : result;
    const photonType = data._photonType as string;
    if (photonType === 'table' && data.rows && Array.isArray(data.rows)) {
      // Convert structured table to array of objects for renderTable
      const columns = data.columns || [];
      const rows = data.rows.map((row: any) => {
        if (Array.isArray(row)) {
          // Row is an array of values, map to column names
          const obj: Record<string, any> = {};
          columns.forEach((col: any, i: number) => {
            const key = typeof col === 'string' ? col : col.label || col.field || `col${i}`;
            obj[key] = row[i] ?? '';
          });
          return obj;
        }
        // Row is already an object, extract display values using column fields
        if (columns.length > 0) {
          const obj: Record<string, any> = {};
          for (const col of columns) {
            const field = typeof col === 'string' ? col : col.field || col.key;
            const label = typeof col === 'string' ? col : col.label || col.field || col.key;
            if (field) {
              obj[label] = row[field] ?? '';
            }
          }
          return obj;
        }
        return row;
      });
      baseFormatOutput(rows, 'table');
      return true;
    }
    // For other _photonType values, strip the marker and render normally
    const { _photonType, ...rest } = data;
    return formatOutput(rest, formatHint);
  }

  // Handle error responses
  if (result && typeof result === 'object' && result.success === false) {
    const errorMsg = result.error || result.message || 'Unknown error';
    console.log(`✗ ${errorMsg}`);

    if (result.hint) {
      console.log(`Hint: ${result.hint}`);
    }

    return false;
  }

  // Handle success responses with data
  if (result && typeof result === 'object' && result.success === true) {
    if (result.message) {
      console.log('✓', result.message);
    }

    const markdownCandidateRaw = extractMarkdownContent(result);
    const markdownInline = markdownCandidateRaw ? parseInlineFormat(markdownCandidateRaw) : null;
    const markdownText = markdownInline ? markdownInline.text : markdownCandidateRaw;
    const inlineMarkdownFormat = markdownInline?.format;

    if (inlineMarkdownFormat && !hint) {
      hint = inlineMarkdownFormat;
    }

    if (markdownText) {
      const primaryBlock = buildMarkdownBlockFromPrepared(markdownText, {
        hint,
        inlineFormat: inlineMarkdownFormat,
      });
      if (primaryBlock) {
        const metadata = extractMetadataFields(result);
        renderMarkdownBlocks([primaryBlock], { additionalMetadata: metadata });
        return true;
      }
    }

    let dataToFormat: any;
    if (result.data !== undefined) {
      dataToFormat = result.data;
    } else {
      const otherFields = Object.keys(result).filter(
        (k) => k !== 'success' && k !== 'message' && k !== 'error'
      );

      if (otherFields.length > 0) {
        dataToFormat = {};
        otherFields.forEach((k) => (dataToFormat[k] = result[k]));
      } else {
        if (!result.message) {
          renderNone();
        }
        return true;
      }
    }

    if (typeof dataToFormat === 'string') {
      const inline = parseInlineFormat(dataToFormat);
      if (inline) {
        if (inline.format && !hint) {
          hint = inline.format;
        }
        dataToFormat = inline.text;
      }

      const markdownBlock = buildMarkdownBlockFromPrepared(dataToFormat, {
        hint,
        inlineFormat: inline?.format,
      });
      if (markdownBlock) {
        renderMarkdownBlocks([markdownBlock]);
        return true;
      }

      dataToFormat = convertFrontMatterToMarkdown(dataToFormat).markdown;
    }

    const markdownCollection = buildMarkdownBlocksFromCollection(dataToFormat, hint);
    if (markdownCollection) {
      const metadata = extractMetadataFields(result);
      renderMarkdownBlocks(markdownCollection, { additionalMetadata: metadata });
      return true;
    }

    baseFormatOutput(dataToFormat, hint);
    return true;
  }

  if (result !== undefined && result !== null) {
    let payload: any = result;
    if (typeof payload === 'string') {
      const inline = parseInlineFormat(payload);
      if (inline) {
        if (inline.format && !hint) {
          hint = inline.format;
        }
        payload = inline.text;
      }

      const standaloneBlock = buildMarkdownBlockFromPrepared(payload, {
        hint,
        inlineFormat: inline?.format,
      });
      if (standaloneBlock) {
        renderMarkdownBlocks([standaloneBlock]);
        return true;
      }

      payload = convertFrontMatterToMarkdown(payload).markdown;
    }

    const markdownCollection = buildMarkdownBlocksFromCollection(payload, hint);
    if (markdownCollection) {
      renderMarkdownBlocks(markdownCollection);
      return true;
    }

    baseFormatOutput(payload, hint);
  } else {
    renderNone();
  }

  return true;
}

/**
 * Parse CLI arguments into method parameters
 */
export function parseCliArgs(args: string[], params: MethodInfo['params']): Record<string, any> {
  const result: Record<string, any> = {};

  // Create a map of param names to types for quick lookup
  const paramTypes = new Map(params.map((p) => [p.name, p.type]));

  // Handle both positional and --flag style arguments
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--no-') && !arg.includes('=')) {
      // --no-<param> negation syntax for boolean params (e.g., --no-enabled → enabled=false)
      const key = arg.substring(5);
      if (paramTypes.has(key)) {
        result[key] = false;
      } else {
        // Unknown param, store as-is (will be caught by validation later)
        result[key] = false;
      }
    } else if (arg.startsWith('--')) {
      // Named argument: --key value or --key=value
      const eqIndex = arg.indexOf('=');

      if (eqIndex !== -1) {
        // --key=value format
        const key = arg.substring(2, eqIndex);
        const value = arg.substring(eqIndex + 1);
        const expectedType = paramTypes.get(key) || 'any';
        result[key] = coerceValue(value, expectedType);
      } else {
        // --key value format (next arg is the value)
        const key = arg.substring(2);
        const expectedType = paramTypes.get(key) || 'any';

        // For boolean params, treat bare --flag as true (no value consumed)
        if (expectedType === 'boolean' && (i + 1 >= args.length || args[i + 1].startsWith('--'))) {
          result[key] = true;
        } else if (i + 1 < args.length) {
          i++;
          result[key] = coerceValue(args[i], expectedType);
        } else {
          // No value and not boolean - treat as boolean flag
          result[key] = true;
        }
      }
    } else if (paramTypes.has(arg)) {
      // Bare word matches a known parameter name — treat as named arg
      // e.g., `register group "Arul" folder ~/path` → --group "Arul" --folder ~/path
      const key = arg;
      const expectedType = paramTypes.get(key) || 'any';

      if (expectedType === 'boolean') {
        result[key] = true;
      } else if (i + 1 < args.length) {
        i++;
        result[key] = coerceValue(args[i], expectedType);
      } else {
        result[key] = true;
      }
    } else {
      // Positional argument — skip params already filled by named args
      while (positionalIndex < params.length && params[positionalIndex].name in result) {
        positionalIndex++;
      }
      if (positionalIndex < params.length) {
        const param = params[positionalIndex];
        result[param.name] = coerceValue(arg, param.type);
        positionalIndex++;
      }
    }
  }

  return result;
}

/**
 * Coerce a string value to the expected type
 */
function coerceValue(value: string, expectedType: string): any {
  // Preserve strings starting with + or - for relative adjustments
  // Must check BEFORE JSON.parse because JSON.parse("-3") returns -3 (number)
  if (expectedType.includes('number') && (value.startsWith('+') || value.startsWith('-'))) {
    return value;
  }

  // Try to parse as JSON first (handles objects, arrays, true/false)
  try {
    const parsed = JSON.parse(value);
    // If we got a value and need to coerce it
    return coerceToType(parsed, expectedType);
  } catch {
    // Not valid JSON, coerce the string directly
    return coerceToType(value, expectedType);
  }
}

/**
 * Coerce a value to a specific type
 */
function coerceToType(value: any, expectedType: string): any {
  switch (expectedType) {
    case 'boolean':
      // Handle: true, false, 1, 0, "1", "0", "true", "false"
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      return Boolean(value);

    case 'number':
      // Handle: 42, "42", 3.14, "3.14"
      // BUT preserve strings starting with + or - (relative adjustments)
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && (value.startsWith('+') || value.startsWith('-'))) {
        return value; // Keep as string for relative adjustments
      }
      const num = Number(value);
      return isNaN(num) ? value : num;

    case 'string':
      // Always convert to string
      return String(value);

    default:
      // For 'any' or unknown types, return as-is
      return value;
  }
}

function looksLikeMarkdown(value: any): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^---\s*[\r\n]/.test(trimmed)) {
    return true;
  }

  const blockPatterns: RegExp[] = [
    /^#{1,6}\s+/m,
    /^> /m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /^```/m,
    /(?:^|\n)(?:-{3,}|_{3,}|\*{3,})(?:\n|$)/m,
  ];

  if (blockPatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if (/\[.+?\]\(.+?\)/.test(trimmed)) {
    return true;
  }

  return false;
}

const stripAnsiRegex = /\u001b\[[0-9;]*m/g;

function visibleLength(text: string): number {
  return text.replace(stripAnsiRegex, '').length;
}

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// GHOST TEXT — markdown syntax characters rendered in dark gray
// chalk.gray (ANSI color 90) works after chalk.level is forced to 1 at import.
// ══════════════════════════════════════════════════════════════════════════════

function ghost(text: string): string {
  if (chalk.level === 0) chalk.level = 1;
  return chalk.gray(text);
}

function renderMarkdownNicely(content: string): void {
  const termWidth = process.stdout.columns || 80;
  let rendered = content.replace(/\r/g, '');

  // Normalize heading indentation
  rendered = rendered.replace(/^[\t ]+(?=#{1,6}\s)/gm, '');

  // Attach standalone emoji lines to following headings
  rendered = rendered.replace(
    /^[ \t]*([^\w\s]{1,4})\s*\n([ \t]*#{1,6}\s+)(.+)$/gm,
    (_m, emoji, hashes, title) => {
      return `${hashes}${emoji.trim()} ${title}`;
    }
  );

  // Heuristic: Merge standalone emojis (or short lines) into the following header
  // This fixes the "floating emoji" look by making them part of the header
  rendered = rendered.replace(
    /(^|\n)([^\n]{1,5})\n+(#{1,6})\s+(.+)$/gm,
    (_m, prefix, icon, hashes, text) => {
      return `${prefix}${hashes} ${icon.trim()} ${text}`;
    }
  );

  // Convert Markdown tables to box-drawn tables
  rendered = rendered.replace(
    /(^|\n)(\|[^\n]+\|\n\|[^\n]+\|\n(?:\|[^\n]+\|\n?)+)/g,
    (_m, prefix, block) => {
      return `${prefix}${renderMarkdownTableBlock(block.trim())}`;
    }
  );

  // Extract code blocks to prevent wrapping them
  const codeBlocks: string[] = [];
  rendered = rendered.replace(/```(\w*)\n([\s\S]*?)```/g, (match) => {
    codeBlocks.push(match);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  // Wrap text paragraphs
  rendered = rendered
    .split('\n')
    .map((line) => {
      // Skip headers, placeholders, empty lines, lists, quotes
      if (
        line.startsWith('#') ||
        line.includes('\u0000CODE') ||
        !line.trim() ||
        line.match(/^(\s*[-*+]|\s*\d+\.|>)/)
      ) {
        return line;
      }
      // Wrap plain text line
      return wrapToWidth(line, termWidth).join('\n');
    })
    .join('\n');

  // Restore code blocks and highlight
  rendered = rendered.replace(/\u0000CODE(\d+)\u0000/g, (_m, index) => {
    const block = codeBlocks[parseInt(index)];
    return block.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const trimmedCode = code.trim();
      if (lang && lang !== '') {
        try {
          return '\n' + highlight(trimmedCode, { language: lang, ignoreIllegals: true }) + '\n';
        } catch {
          return '\n' + chalk.gray(trimmedCode) + '\n';
        }
      }
      return '\n' + chalk.gray(trimmedCode) + '\n';
    });
  });

  // Order matters: compound patterns first, then individual markers.

  // 1. Bold+link combo: **[title](url)** — very common in search results
  rendered = rendered.replace(
    /\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g,
    (_m, text, url) => ghost('**[') + chalk.bold.blueBright(text) + ghost('](' + url + ')**')
  );

  // 2. Bold wrapping other content: **text**
  rendered = rendered.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, text) => ghost('**') + chalk.bold(text) + ghost('**')
  );

  // 3. Links (not already handled by bold+link): [text](url)
  rendered = rendered.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text, url) => ghost('[') + chalk.blueBright(text) + ghost('](' + url + ')')
  );

  // 4. Headings
  rendered = rendered.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, text) => {
    const level = hashes.length;
    const colorFn = level === 1 ? chalk.magenta.bold : level === 2 ? chalk.yellow.bold : chalk.cyan;
    return ghost(hashes + ' ') + colorFn(text.trim());
  });

  // 5. Block-level markers
  rendered = rendered.replace(/^> (.+)$/gm, (_m, quote) => ghost('> ') + chalk.italic(quote));
  rendered = rendered.replace(/^---+$/gm, ghost('---'));
  rendered = rendered.replace(/^- /gm, ghost('- '));
  rendered = rendered.replace(/^(\d+)\. /gm, (_m, num) => ghost(`${num}. `));

  // 6. Italic: *text* (but not ** which is already handled)
  rendered = rendered.replace(
    /(?<!\*)\*([^*]+)\*(?!\*)/g,
    (_m, text) => ghost('*') + chalk.italic(text) + ghost('*')
  );

  // 7. Underscore italic: _text_
  rendered = rendered.replace(
    /(?<!\w)_([^_]+)_(?!\w)/g,
    (_m, text) => ghost('_') + chalk.italic(text) + ghost('_')
  );

  // 8. Inline code: `code`
  rendered = rendered.replace(
    /`([^`]+)`/g,
    (_m, code) => ghost('`') + chalk.cyan(code) + ghost('`')
  );

  rendered = rendered
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  rendered = rendered.replace(/\n{3,}/g, '\n\n');
  console.log(rendered.trim());
}

function convertFrontMatterToMarkdown(markdown: string): {
  markdown: string;
  metadata: Record<string, string>;
  hadFrontMatter: boolean;
} {
  let text = markdown.replace(/^\uFEFF/, '').trimStart();
  const metadata: Record<string, string> = {};
  const fmRegex = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*/;
  const tables: string[] = [];
  let hadFrontMatter = false;

  while (true) {
    const match = fmRegex.exec(text);
    if (!match) {
      break;
    }
    hadFrontMatter = true;
    const block = match[1];
    const parsed = parseFrontMatter(block);
    Object.assign(metadata, parsed);
    if (Object.keys(parsed).length > 0) {
      tables.push(frontMatterToTable(parsed));
    }
    text = text.slice(match[0].length).trimStart();
  }

  const prefix = tables.length > 0 ? tables.join('\n\n') + '\n\n' : '';
  return { markdown: prefix + text, metadata, hadFrontMatter };
}

function frontMatterToTable(parsed: Record<string, string>): string {
  const rows = Object.entries(parsed)
    .map(([key, value]) => `| ${escapePipes(key)} | ${escapePipes(value)} |`)
    .join('\n');
  return ['| Field | Value |', '| --- | --- |', rows].join('\n');
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function parseFrontMatter(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  const stack: { indent: number; path: string[] }[] = [{ indent: -1, path: [] }];
  const lines = block.split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      continue;
    }
    const match = /^([ \t]*)([^:\s]+):\s*(.*)$/.exec(rawLine);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    const key = match[2];
    const value = match[3].trim();

    while (stack.length && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parentPath = stack[stack.length - 1]?.path || [];
    const currentPath = [...parentPath, key];
    const flatKey = currentPath.join('.');

    if (value) {
      result[flatKey] = value.replace(/^['"]|['"]$/g, '');
    }

    stack.push({ indent, path: currentPath });
  }

  return result;
}

function parseInlineFormat(value: string): { format?: OutputFormat; text: string } | null {
  const match = value.match(/^\{([a-z-]+(?::[\w-]+)?)\}\s*/i);
  if (!match) {
    return null;
  }

  const candidate = match[1].toLowerCase();
  if (!isValidOutputFormat(candidate)) {
    return { text: value.slice(match[0].length) };
  }

  return {
    format: candidate,
    text: value.slice(match[0].length),
  };
}

function buildMarkdownBlockFromPrepared(
  text: string,
  options: { hint?: OutputFormat; inlineFormat?: OutputFormat; title?: string }
): MarkdownBlock | null {
  const { markdown, metadata, hadFrontMatter } = convertFrontMatterToMarkdown(text);
  const shouldRenderMarkdown =
    options.inlineFormat === 'markdown' ||
    options.hint === 'markdown' ||
    hadFrontMatter ||
    (!options.hint && !options.inlineFormat && looksLikeMarkdown(markdown));

  if (!shouldRenderMarkdown) {
    return null;
  }

  return {
    title: options.title,
    markdown,
    metadata,
    hadFrontMatter,
  };
}

function buildMarkdownBlockFromRawValue(
  value: any,
  options: { hint?: OutputFormat; title?: string }
): MarkdownBlock | null {
  let raw: string | undefined;
  if (typeof value === 'string') {
    raw = value;
  } else if (value && typeof value === 'object') {
    raw = extractMarkdownContent(value);
  }

  if (!raw) {
    return null;
  }

  const inline = parseInlineFormat(raw);
  const text = inline ? inline.text : raw;
  return buildMarkdownBlockFromPrepared(text, {
    hint: options.hint,
    inlineFormat: inline?.format,
    title: options.title,
  });
}

function buildMarkdownBlocksFromCollection(data: any, hint?: OutputFormat): MarkdownBlock[] | null {
  if (Array.isArray(data) && data.length > 0) {
    const blocks: MarkdownBlock[] = [];
    for (let index = 0; index < data.length; index++) {
      const block = buildMarkdownBlockFromRawValue(data[index], {
        hint,
        title: data.length > 1 ? chalk.cyan.bold(`Entry ${index + 1}`) : undefined,
      });
      if (!block) {
        return null;
      }
      blocks.push(block);
    }
    return blocks;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data);
    if (!entries.length) {
      return null;
    }

    const blocks: MarkdownBlock[] = [];
    for (const [key, value] of entries) {
      const block = buildMarkdownBlockFromRawValue(value, {
        hint,
        title: formatKey(key),
      });
      if (!block) {
        return null;
      }
      blocks.push(block);
    }
    return blocks;
  }

  return null;
}

function renderMarkdownBlocks(
  blocks: MarkdownBlock[],
  options?: { additionalMetadata?: Record<string, string> }
): void {
  blocks.forEach((block, index) => {
    if (index > 0) {
      console.log('');
    }

    if (block.title) {
      console.log(block.title);
      console.log('');
    }

    renderMarkdownNicely(block.markdown);

    const combinedMetadata = block.hadFrontMatter ? {} : { ...block.metadata };
    if (index === 0 && options?.additionalMetadata) {
      Object.assign(combinedMetadata, options.additionalMetadata);
    }

    if (Object.keys(combinedMetadata).length > 0) {
      console.log('');
      printMetadataTable(combinedMetadata);
      console.log('');
    }
  });
}

function isValidOutputFormat(format: string): format is OutputFormat {
  const knownFormats: Set<string> = new Set([
    'primitive',
    'table',
    'tree',
    'list',
    'none',
    'json',
    'markdown',
    'yaml',
    'xml',
    'html',
    'code',
  ]);
  return knownFormats.has(format) || format.startsWith('code:');
}

function extractMarkdownContent(payload: any): string | undefined {
  if (!payload) {
    return undefined;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload === 'object') {
    if (typeof payload.content === 'string') {
      return payload.content;
    }

    if (Array.isArray(payload.content)) {
      for (const chunk of payload.content) {
        const text = extractMarkdownContent(chunk);
        if (text) {
          return text;
        }
      }
    }

    if (typeof payload.text === 'string') {
      return payload.text;
    }

    if (Array.isArray(payload.contents)) {
      for (const chunk of payload.contents) {
        const text = extractMarkdownContent(chunk);
        if (text) {
          return text;
        }
      }
    }

    if (typeof payload.data === 'string') {
      return payload.data;
    }

    if (Array.isArray(payload.data)) {
      for (const chunk of payload.data) {
        const text = extractMarkdownContent(chunk);
        if (text) {
          return text;
        }
      }
    }
  }

  return undefined;
}

function stringifyMetadataValue(value: any): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === undefined || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractMetadataFields(result: any): Record<string, string> {
  if (!result || typeof result !== 'object') {
    return {};
  }

  const metadata: Record<string, string> = {};
  const skipKeys = new Set(['success', 'message', 'error', 'content', 'contents', 'text', 'data']);

  for (const key of Object.keys(result)) {
    if (skipKeys.has(key)) {
      continue;
    }

    if (key === 'metadata' && typeof result.metadata === 'object' && result.metadata !== null) {
      for (const [subKey, subValue] of Object.entries(result.metadata)) {
        const formattedKey = `metadata.${subKey}`;
        metadata[formattedKey] = stringifyMetadataValue(subValue);
      }
      continue;
    }

    metadata[key] = stringifyMetadataValue(result[key]);
  }

  return metadata;
}

function padAnsi(text: string, width: number): string {
  const len = visibleLength(text);
  if (len >= width) {
    return text;
  }
  return text + ' '.repeat(width - len);
}

function wrapToWidth(text: string, width: number): string[] {
  if (!width) {
    return [text];
  }

  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of trimmedLine.split(' ')) {
      if (word.length > width) {
        if (current) {
          lines.push(current);
          current = '';
        }
        let remaining = word;
        while (remaining.length > width) {
          lines.push(remaining.slice(0, width));
          remaining = remaining.slice(width);
        }
        current = remaining;
        continue;
      }

      if (!current) {
        current = word;
        continue;
      }
      if (current.length + 1 + word.length > width) {
        lines.push(current);
        current = word;
      } else {
        current += ` ${word}`;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
}

function printMetadataTable(metadata: Record<string, string>): void {
  const entries = Object.entries(metadata);
  if (!entries.length) {
    return;
  }

  const rows = entries.map(([key, value]) => [formatKey(key), value]);
  console.log(renderGenericTable(['Field', 'Value'], rows));
}

function renderMarkdownTableBlock(block: string): string {
  const lines = block.split(/\n/).filter(Boolean);
  if (lines.length < 2) {
    return block;
  }

  const header = parseMarkdownTableRow(lines[0]);
  if (!header.length) {
    return block;
  }

  const separator = lines[1];
  if (!/^\|?\s*:?-{2,}:?(.+\|\s*:?-{2,}:?)*\s*\|?$/.test(separator)) {
    return block;
  }

  const rows = lines
    .slice(2)
    .map(parseMarkdownTableRow)
    .filter((row) => row.length === header.length);

  if (!rows.length) {
    return block;
  }

  return renderGenericTable(header, rows);
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderGenericTable(headers: string[], rows: string[][]): string {
  if (!headers.length) {
    return rows.map((row) => row.join(' | ')).join('\n');
  }

  const termWidth = process.stdout.columns || 80;
  const columns = headers.length;
  const baseOverhead = 2 * columns + (columns - 1) + 2; // padding + connectors + borders
  const maxAvailable = Math.max(columns, termWidth - baseOverhead);

  const colWidths = headers.map((header) => Math.max(visibleLength(header), 3));
  rows.forEach((row) => {
    row.forEach((cell, idx) => {
      const width = visibleLength(cell ?? '');
      if (width > (colWidths[idx] || 0)) {
        colWidths[idx] = width;
      }
    });
  });

  while (colWidths.reduce((sum, w) => sum + w, 0) > maxAvailable) {
    let maxIdx = 0;
    for (let i = 1; i < colWidths.length; i++) {
      if (colWidths[i] > colWidths[maxIdx]) {
        maxIdx = i;
      }
    }
    if (colWidths[maxIdx] <= 8) {
      break;
    }
    colWidths[maxIdx]--;
  }

  const wrappedRows = [headers, ...rows].map((row) =>
    row.map((cell, idx) => wrapToWidth(cell ?? '', colWidths[idx] || 1))
  );

  const horizontal = colWidths.map((width) => '─'.repeat(width + 2));
  const top = `┌${horizontal.join('┬')}┐`;
  const mid = `├${horizontal.join('┼')}┤`;
  const bottom = `└${horizontal.join('┴')}┘`;

  const formatWrappedRow = (wrappedCells: string[][]): string[] => {
    const maxLines = Math.max(...wrappedCells.map((cell) => cell.length));
    const lines: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const parts = wrappedCells.map((cellLines, idx) => {
        const content = cellLines[lineIdx] ?? '';
        return padAnsi(content, colWidths[idx] || 1);
      });
      lines.push(`│ ${parts.join(' │ ')} │`);
    }
    return lines;
  };

  const output: string[] = [];
  output.push(top);
  const [headerWrapped, ...bodyWrapped] = wrappedRows;
  output.push(...formatWrappedRow(headerWrapped));
  output.push(mid);
  bodyWrapped.forEach((row, idx) => {
    output.push(...formatWrappedRow(row));
    output.push(idx === bodyWrapped.length - 1 ? bottom : mid);
  });

  return output.join('\n');
}

/**
 * Format camelCase/PascalCase to "Title Case With Spaces"
 */
function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1') // Add space before capitals
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space before numbers
    .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
    .trim();
}

/**
 * Print help for a specific method
 */
function printParamHelp(param: MethodInfo['params'][0]): void {
  const displayLabel = param.label || formatLabel(param.name);

  // Build type hint suffix
  let typeHint = '';
  if (param.enum && param.enum.length > 0) {
    typeHint = ` [values: ${param.enum.join(', ')}]`;
  } else if (param.type === 'boolean') {
    typeHint = ' [--no-' + param.name + ' to disable]';
  } else if (param.type === 'array') {
    typeHint = ` (JSON array, e.g., '["a","b"]')`;
  } else if (param.type === 'object') {
    typeHint = ` (JSON object, e.g., '{"key":"value"}')`;
  }

  console.log(`    --${param.name} (${displayLabel})${typeHint}`);
  if (param.description) {
    console.log(`        ${param.description}`);
  }
  // Show example for complex types (JSON)
  if (param.example) {
    console.log(`        Example: ${param.example}`);
  }
}

function printMethodHelp(photonName: string, method: MethodInfo): void {
  // Truncate description at sentence boundary if too long, or clean up mid-sentence truncation
  let description = method.description || 'No description';
  if (description.length > 200) {
    const sentenceEnd = description.substring(0, 200).lastIndexOf('.');
    if (sentenceEnd > 80) {
      description = description.substring(0, sentenceEnd + 1);
    } else {
      description = description.substring(0, 197) + '...';
    }
  } else if (description.length > 0 && !/[.!?]$/.test(description.trim())) {
    // Description appears truncated mid-sentence (no terminal punctuation)
    // Truncate at the last complete sentence if possible
    const lastSentence = description.lastIndexOf('.');
    if (lastSentence > 40) {
      description = description.substring(0, lastSentence + 1);
    } else {
      // No good sentence boundary — add ellipsis to signal truncation
      description = description.trim() + '...';
    }
  }

  console.log(`\nNAME:`);
  console.log(`    ${method.name} - ${description}\n`);

  console.log(`USAGE:`);
  const requiredParams = method.params.filter((p) => !p.optional);
  const optionalParams = method.params.filter((p) => p.optional);

  const prefix = cliPrefix(photonName);
  let usage = `    ${prefix} ${method.name}`;
  if (requiredParams.length > 0) {
    usage += ' ' + requiredParams.map((p) => `--${p.name} <value>`).join(' ');
  }
  if (optionalParams.length > 0) {
    usage += ' [options]';
  }
  console.log(usage + '\n');

  if (method.params.length > 0) {
    if (requiredParams.length > 0) {
      console.log(`REQUIRED:`);
      for (const param of requiredParams) {
        printParamHelp(param);
      }
      console.log('');
    }

    if (optionalParams.length > 0) {
      console.log(`OPTIONS:`);
      for (const param of optionalParams) {
        printParamHelp(param);
      }
      console.log('');
    }

    console.log(`GLOBAL OPTIONS:`);
    console.log(`    --json`);
    console.log(`        Output raw JSON instead of formatted text\n`);
  }

  console.log(`EXAMPLE:`);
  if (requiredParams.length > 0) {
    const exampleParams = requiredParams.map((p) => `--${p.name} <value>`).join(' ');
    console.log(`    ${prefix} ${method.name} ${exampleParams}\n`);
  } else {
    console.log(`    ${prefix} ${method.name}\n`);
  }
}

/**
 * List all methods in a photon (standard CLI help format)
 */
export async function listMethods(photonName: string): Promise<void> {
  try {
    const resolvedPath = await resolvePhotonPathWithBundled(photonName);

    if (!resolvedPath) {
      exitWithError(`Photon '${photonName}' not found`, {
        exitCode: ExitCode.NOT_FOUND,
        searchedIn: getDefaultContext().baseDir,
        suggestion: `Install it with: photon add ${photonName}\nIf '${photonName}' is a command, run 'photon --help' for available commands`,
      });
    }

    const allMethods = await extractMethods(resolvedPath);
    const photonDesc = await extractPhotonDescription(resolvedPath);

    // Filter out internal methods: lifecycle hooks, scheduled*, handle*, reportError
    const methods = allMethods.filter((m) => {
      if (m.scheduled) return false;
      if (m.webhook) return false;
      if (m.name === 'onInitialize') return false;
      if (m.name === 'onShutdown') return false;
      if (m.name.startsWith('scheduled')) return false;
      if (m.name.startsWith('handle')) return false;
      if (m.name === 'reportError') return false;
      return true;
    });

    const hiddenCount = allMethods.length - methods.length;

    // Print description if available
    if (photonDesc) {
      console.log(`\n${photonDesc}\n`);
    }

    // Print usage
    const prefix = cliPrefix(photonName);
    console.log(`USAGE:`);
    console.log(`    ${prefix} <command> [options]\n`);

    // Print commands
    console.log(`COMMANDS:`);

    // Find longest method name for alignment
    const maxLength = Math.max(...methods.map((m) => m.name.length));
    const maxDescLength = 60;

    for (const method of methods) {
      const padding = ' '.repeat(maxLength - method.name.length + 4);
      let description = method.description || 'No description';
      // Truncate long descriptions in listing, keeping first sentence
      if (description.length > maxDescLength) {
        const sentenceEnd = description.substring(0, maxDescLength).lastIndexOf('.');
        if (sentenceEnd > 20) {
          description = description.substring(0, sentenceEnd + 1);
        } else {
          description = description.substring(0, maxDescLength - 3) + '...';
        }
      }
      // Show param signature for methods with no description
      if (!method.description && method.params.length > 0) {
        const sig = method.params
          .map((p) => (p.optional ? `${p.name}?` : p.name) + `: ${p.type}`)
          .join(', ');
        description = `(${sig})`;
      }
      console.log(`    ${method.name}${padding}${description}`);
    }

    if (hiddenCount > 0) {
      console.log(`\n    (${hiddenCount} internal/scheduled methods hidden)`);
    }

    // Print footer
    console.log(`\nFor detailed parameter information, run:`);
    console.log(`    ${prefix} <command> --help\n`);

    // Print examples if there are methods
    if (methods.length > 0) {
      console.log(`EXAMPLES:`);
      // Show first 3 methods as examples
      const exampleMethods = methods.slice(0, 3);
      for (const method of exampleMethods) {
        const requiredParams = method.params.filter((p) => !p.optional);
        if (requiredParams.length > 0) {
          const paramStr = requiredParams.map((p) => `--${p.name} <value>`).join(' ');
          console.log(`    ${prefix} ${method.name} ${paramStr}`);
        } else {
          console.log(`    ${prefix} ${method.name}`);
        }
      }
      console.log('');
    }
  } catch (error) {
    exitWithError(`Cannot list methods for ${photonName}: ${getErrorMessage(error)}`, {
      suggestion: `Verify the photon file is valid: ${getDefaultContext().baseDir}/${photonName}.photon.ts`,
    });
  }
}

/**
 * Run a photon method from CLI
 */
export async function runMethod(
  photonName: string,
  methodName: string,
  args: string[],
  workingDir?: string
): Promise<void> {
  // Set up readline prompt handler for CLI
  setPromptHandler(async (message: string, defaultValue?: string) => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const prompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `;

      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer || defaultValue || null);
      });
    });
  });

  // Set up readline elicit handler for CLI (confirm, select, etc.)
  setElicitHandler(elicitReadline);

  try {
    // Resolve photon path
    const resolvedPath = await resolvePhotonPathWithBundled(photonName);

    if (!resolvedPath) {
      exitWithError(`Photon '${photonName}' not found`, {
        exitCode: ExitCode.NOT_FOUND,
        searchedIn: getDefaultContext().baseDir,
        suggestion: `Install it with: photon add ${photonName}\nIf '${photonName}' is a command, run 'photon --help' for available commands`,
      });
    }

    // Extract methods to validate
    const methods = await extractMethods(resolvedPath);

    // Check if methodName itself is --help (e.g., photon cli test-cli-calc --help)
    if (methodName === '--help' || methodName === '-h') {
      await listMethods(photonName);
      return;
    }

    const method = methods.find((m) => m.name === methodName);

    if (!method) {
      const available = methods.map((m) => m.name).join(', ');
      exitWithError(`Method '${methodName}' not found in ${photonName}`, {
        exitCode: ExitCode.NOT_FOUND,
        suggestion: `Available methods: ${available}\nRun '${cliPrefix(photonName)}' to see details`,
      });
    }

    // Check for --help flag in args (e.g., photon cli test-cli-calc add --help)
    if (args.includes('--help') || args.includes('-h')) {
      printMethodHelp(photonName, method);
      return;
    }

    // Check for --json flag
    const jsonOutput = args.includes('--json');

    // Check for -y flag (non-interactive mode, for agents/scripts)
    const nonInteractive = args.includes('-y');

    // Check for --format <type> flag (maps to _meta.format)
    // Only treat as framework flag if the method doesn't have a 'format' parameter
    const methodHasFormat = method.params.some((p: any) => p.name === 'format');
    let cliFormat: string | undefined;
    const formatIndex = methodHasFormat ? -1 : args.indexOf('--format');
    if (formatIndex !== -1 && args[formatIndex + 1]) {
      cliFormat = args[formatIndex + 1];
    }

    // Check for --resume <runId> flag
    let resumeRunId: string | undefined;
    const resumeIndex = args.indexOf('--resume');
    if (resumeIndex !== -1 && args[resumeIndex + 1]) {
      resumeRunId = args[resumeIndex + 1];
    }

    // Filter out special flags before parsing method args
    const filteredArgs = args.filter(
      (arg, i) =>
        arg !== '--json' &&
        arg !== '-y' &&
        arg !== '--resume' &&
        arg !== '--format' &&
        (resumeIndex === -1 || i !== resumeIndex + 1) &&
        (formatIndex === -1 || i !== formatIndex + 1)
    );

    // Parse arguments
    const parsedArgs: Record<string, any> = parseCliArgs(filteredArgs, method.params);

    // Inject _meta from CLI flags (--format maps to _meta.format)
    if (cliFormat) {
      parsedArgs._meta = {
        ...((parsedArgs._meta as Record<string, unknown>) || {}),
        format: cliFormat,
      };
    }

    // Validate required parameters
    const missing: string[] = [];
    for (const param of method.params) {
      if (!param.optional && !(param.name in parsedArgs)) {
        missing.push(param.name);
      }
    }

    if (missing.length > 0) {
      // If stdin is a TTY and not in non-interactive mode, prompt for missing params
      if (process.stdin.isTTY && !nonInteractive) {
        // Show method help context
        printMethodHelp(photonName, method);

        // Prompt for each missing parameter
        for (const name of missing) {
          const param = method.params.find((mp) => mp.name === name)!;
          const displayLabel = param.label || formatLabel(param.name);
          let prompt = `${displayLabel}`;
          if (param.description) prompt += ` (${param.description})`;
          if (param.enum && param.enum.length > 0) {
            prompt += ` [${param.enum.join('/')}]`;
          }
          prompt += ': ';

          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          const answer = await new Promise<string>((resolve) => {
            rl.question(prompt, (ans) => {
              rl.close();
              resolve(ans.trim());
            });
          });

          if (!answer) {
            exitWithError(`Parameter '${name}' is required`, {
              exitCode: ExitCode.INVALID_ARGUMENT,
            });
          }

          // Coerce the value to the expected type
          parsedArgs[name] = coerceToType(answer, param.type);
        }
      } else {
        // Non-interactive: print concise help so agents can construct the correct call
        printMethodHelp(photonName, method);
        process.exit(ExitCode.INVALID_ARGUMENT);
      }
    }

    // Validate parameter types and enum values
    const validationErrors: string[] = [];
    for (const param of method.params) {
      if (!(param.name in parsedArgs)) continue;
      const value = parsedArgs[param.name];

      // Validate number types
      if (param.type === 'number' && typeof value !== 'number') {
        // coerceToType returns the original string if NaN, so check for non-number
        if (typeof value === 'string' && !(value.startsWith('+') || value.startsWith('-'))) {
          validationErrors.push(`  --${param.name}: expected a number, got '${value}'`);
        }
      }

      // Validate enum values
      if (param.enum && param.enum.length > 0) {
        const strValue = String(value).toLowerCase();
        const validValues = param.enum.map((v) => v.toLowerCase());
        if (!validValues.includes(strValue)) {
          validationErrors.push(
            `  --${param.name}: invalid value '${value}' (must be one of: ${param.enum.join(', ')})`
          );
        }
      }
    }

    if (validationErrors.length > 0) {
      exitWithError(`Invalid parameter values`, {
        exitCode: ExitCode.INVALID_ARGUMENT,
        suggestion: validationErrors.join('\n'),
      });
    }

    // Check if photon is stateful
    const extractor = new PhotonDocExtractor(resolvedPath);
    const metadata = await extractor.extractFullMetadata();

    let result: any;

    if (metadata.stateful) {
      // STATEFUL PATH: Use daemon
      // Ensure daemon is running (auto-restarts if binary is stale)
      await ensureDaemon();

      // Wait for daemon to be ready even if pid state was stale and had to be recovered.
      let ready = false;
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (await pingDaemon(photonName)) {
          ready = true;
          break;
        }
      }

      if (!ready) {
        exitWithError(`Failed to start daemon for ${photonName}`, {
          suggestion: `Check logs: cat ${getDefaultContext().baseDir}/.data/daemon.log\nOr try: photon daemon restart ${photonName}`,
        });
      }

      // Read session-scoped instance set by `photon use` (scoped to this terminal)
      const { CLISessionStore } = await import('./context-store.js');
      const sessionInstance = new CLISessionStore().getCurrentInstance(photonName);
      const sessionId = `cli-${photonName}`;
      const sendOpts = { photonPath: resolvedPath, sessionId, workingDir };
      await sendCommand(photonName, '_use', { name: sessionInstance }, sendOpts);

      // Send the actual command
      result = await sendCommand(photonName, methodName, parsedArgs, sendOpts);
    } else {
      // STATELESS PATH: Direct execution
      const loader = new PhotonLoader(false, undefined, workingDir); // verbose=false for CLI mode
      const photonInstance = await loader.loadFile(resolvedPath);

      // Print resume message before execution
      if (resumeRunId) {
        console.log(`Resuming workflow ${resumeRunId}...`);
      }

      // Call the method (with optional resume)
      result = await loader.executeTool(photonInstance, methodName, parsedArgs, { resumeRunId });
    }

    // Check if this was a stateful workflow execution
    const isStateful = result && typeof result === 'object' && result._stateful === true;
    const actualResult = isStateful ? result.result : result;

    // Clear any intermediate render output before displaying final result
    clearRenderZone();

    // _meta format transformation: pre-formatted text outputs directly
    if (actualResult && typeof actualResult === 'object' && actualResult._metaFormatted === true) {
      console.log(actualResult.text);
      process.exit(0);
    }

    // Display result
    if (jsonOutput) {
      // For JSON output, include workflow metadata if stateful
      const outputData = isStateful ? { ...result, result: actualResult } : actualResult;
      const jsonStr = JSON.stringify(outputData, null, 2);
      baseFormatOutput(jsonStr, 'json');
      // Check for errors in JSON output too
      if (actualResult && typeof actualResult === 'object' && actualResult.success === false) {
        process.exit(1);
      }
    } else {
      const formatHint =
        method.format || (looksLikeMarkdown(actualResult) ? 'markdown' : undefined);
      const success = formatOutput(actualResult, formatHint);
      if (!success) {
        process.exit(1);
      }

      // Show run ID for stateful workflows
      if (isStateful && result.runId) {
        console.log('');
        if (result.resumed && result.resumedFromStep !== undefined) {
          console.log(
            `Resumed from step ${result.resumedFromStep}, completed ${result.checkpointsCompleted} checkpoints`
          );
        }
        console.log(`Run ID: ${result.runId}`);
      }
    }
  } catch (error) {
    // Check for custom user-facing message from photon
    // Photons can throw: throw Object.assign(new Error('internal'), { userMessage: 'friendly msg', hint: 'try this' })
    const userMessage: string =
      error && typeof error === 'object' && 'userMessage' in error
        ? String(error.userMessage)
        : getErrorMessage(error) || 'Unknown error occurred';
    const hint: string | undefined =
      error && typeof error === 'object' && 'hint' in error ? String(error.hint) : undefined;

    exitWithError(userMessage, {
      suggestion: hint ? String(hint) : undefined,
    });
  }
}
