/**
 * Photon CLI Runner
 *
 * Allows direct invocation of Photon methods from the command line
 * Example: photon cli lg-remote discover
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { SchemaExtractor, setPromptHandler } from '@portel/photon-core';
import * as readline from 'readline';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';
import { resolvePhotonPath } from './path-resolver.js';
import { PhotonLoader } from './loader.js';
import { PhotonDocExtractor } from './photon-doc-extractor.js';
import { isDaemonRunning, startDaemon } from './daemon/manager.js';
import { sendCommand, pingDaemon } from './daemon/client.js';
import {
  formatOutput as baseFormatOutput,
  renderNone,
  OutputFormat,
  formatKey,
} from './cli-formatter.js';
import { getErrorMessage } from './shared/error-handler.js';

interface MethodInfo {
  name: string;
  params: {
    name: string;
    type: string;
    optional: boolean;
    description?: string;
  }[];
  description?: string;
  format?: OutputFormat;
}

interface MarkdownBlock {
  title?: string;
  markdown: string;
  metadata: Record<string, string>;
  hadFrontMatter: boolean;
}

/**
 * Extract all public async methods from a photon file
 */
async function extractMethods(filePath: string): Promise<MethodInfo[]> {
  const source = await fs.readFile(filePath, 'utf-8');
  const extractor = new SchemaExtractor();
  const methods: MethodInfo[] = [];

  // Extract methods using the schema extractor
  // Also match async generator methods (async *methodName)
  const methodMatches = source.matchAll(/async\s+\*?\s*(\w+)\s*\(([^)]*)\)/g);

  for (const match of methodMatches) {
    const methodName = match[1];
    const methodParams = match[2];

    // Skip private methods and lifecycle hooks
    if (
      methodName.startsWith('_') ||
      methodName === 'onInitialize' ||
      methodName === 'onShutdown'
    ) {
      continue;
    }

    // Extract method signature
    const methodIndex = match.index!;
    const precedingContent = source.substring(0, methodIndex);

    // Find JSDoc comment
    const lastJSDocStart = precedingContent.lastIndexOf('/**');
    if (lastJSDocStart === -1) continue;

    const jsdocSection = precedingContent.substring(lastJSDocStart);
    const jsdocMatch = jsdocSection.match(/\/\*\*([\s\S]*?)\*\/\s*$/);

    if (!jsdocMatch) continue;

    const jsdoc = jsdocMatch[1];

    // Extract description
    const descMatch = jsdoc.match(/^\s*\*\s*(.+?)(?=\n\s*\*\s*@|\n\s*$)/s);
    const description = descMatch
      ? descMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s*\*\s?/, '').trim())
          .join(' ')
          .trim()
      : undefined;

    // Parse TypeScript parameter types and optionality from method signature
    const tsParamTypes = new Map<string, string>();
    const tsParamOptional = new Map<string, boolean>();
    if (methodParams.trim()) {
      // Extract: params?: { mute?: boolean } | boolean
      const paramTypeMatch = methodParams.match(/(\w+)(\??):\s*(.+)/);
      if (paramTypeMatch) {
        const tsParamName = paramTypeMatch[1];
        const isParamOptional = paramTypeMatch[2] === '?';
        const paramType = paramTypeMatch[3].trim();

        // Extract base type (handle unions like "{ mute?: boolean } | boolean")
        const baseType = extractBaseType(paramType);

        // Store type for both the TS param name and any inner property names
        tsParamTypes.set(tsParamName, baseType);
        tsParamOptional.set(tsParamName, isParamOptional);

        // Also extract inner object properties: { mute?: boolean }
        const innerProps = extractObjectProperties(paramType);
        for (const [propName, propInfo] of innerProps) {
          tsParamTypes.set(propName, propInfo.type);
          // If the parent param is optional, inner properties are also optional
          tsParamOptional.set(propName, isParamOptional || propInfo.optional);
        }
      }
    }

    // Extract format hint from @format tag (structural and content formats)
    let format: OutputFormat | undefined;

    // Match structural formats
    const structuralMatch = jsdoc.match(/@format\s+(primitive|table|tree|list|none)/i);
    if (structuralMatch) {
      format = structuralMatch[1].toLowerCase() as OutputFormat;
    }
    // Match content formats
    else {
      const contentMatch = jsdoc.match(/@format\s+(json|markdown|yaml|xml|html)/i);
      if (contentMatch) {
        format = contentMatch[1].toLowerCase() as OutputFormat;
      } else {
        // Match code format (with optional language)
        const codeMatch = jsdoc.match(/@format\s+code(?::(\w+))?/i);
        if (codeMatch) {
          format = codeMatch[1] ? `code:${codeMatch[1]}` as OutputFormat : 'code';
        }
      }
    }

    // Extract parameters
    const params: MethodInfo['params'] = [];
    const paramRegex = /@param\s+(\w+)\s+(.+?)(?=\n\s*\*\s*@|\n\s*\*\/|\n\s*$)/gs;
    let paramMatch;

    while ((paramMatch = paramRegex.exec(jsdoc)) !== null) {
      const paramName = paramMatch[1];
      const paramDesc = paramMatch[2].trim();

      // Remove JSDoc constraint tags for display
      const cleanDesc = paramDesc
        .replace(/\{@\w+[^}]*\}/g, '')
        .replace(/\(optional\)/gi, '')
        .replace(/\(default:.*?\)/gi, '')
        .trim();

      // Check optional from TypeScript signature first, fallback to JSDoc
      const tsOptional = tsParamOptional.get(paramName);
      const jsdocOptional = /\(optional\)/i.test(paramDesc) || /\(default:/i.test(paramDesc);
      const optional = tsOptional !== undefined ? tsOptional : jsdocOptional;

      params.push({
        name: paramName,
        type: tsParamTypes.get(paramName) || 'any',
        optional,
        description: cleanDesc,
      });
    }

    methods.push({
      name: methodName,
      params,
      description,
      ...(format ? { format } : {}),
    });
  }

  return methods;
}

/**
 * Extract base type from TypeScript type annotation
 * Examples:
 *   "boolean | number" -> "boolean"
 *   "{ mute?: boolean } | boolean" -> "boolean"
 *   "string" -> "string"
 */
function extractBaseType(typeStr: string): string {
  // Handle object types: { mute?: boolean } -> look for type inside
  const objectMatch = typeStr.match(/\{\s*\w+\??\s*:\s*(\w+)/);
  if (objectMatch) {
    return objectMatch[1];
  }

  // Handle unions: boolean | number -> take first primitive type
  const unionTypes = typeStr.split('|').map(t => t.trim());
  for (const type of unionTypes) {
    if (/^(boolean|number|string)/.test(type)) {
      return type;
    }
  }

  return 'any';
}

/**
 * Extract object property types from TypeScript type annotation
 * Examples:
 *   "{ mute?: boolean } | boolean" -> [["mute", { type: "boolean", optional: true }]]
 *   "{ level?: number | string }" -> [["level", { type: "number", optional: true }]]
 */
function extractObjectProperties(typeStr: string): Map<string, { type: string; optional: boolean }> {
  const props = new Map<string, { type: string; optional: boolean }>();

  // Find all object type definitions: { prop?: type } or { prop: type }
  // Match individual properties within object type: prop?: type or prop: type
  const propMatches = typeStr.matchAll(/(\w+)(\??):\s*([^;,}]+)/g);

  for (const match of propMatches) {
    const propName = match[1];
    const isOptional = match[2] === '?';
    const propType = match[3].trim();

    // Extract base type from the property type (handles unions)
    const baseType = extractBaseType(propType);
    props.set(propName, { type: baseType, optional: isOptional });
  }

  return props;
}

/**
 * Format output for display to the user (with error handling)
 * Wraps the base formatter with success/error response handling
 * @returns true if successful, false if error
 */
function formatOutput(result: any, formatHint?: OutputFormat): boolean {
  let hint = formatHint;

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
      const primaryBlock = buildMarkdownBlockFromPrepared(markdownText, { hint, inlineFormat: inlineMarkdownFormat });
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
        k => k !== 'success' && k !== 'message' && k !== 'error'
      );

      if (otherFields.length > 0) {
        dataToFormat = {};
        otherFields.forEach(k => dataToFormat[k] = result[k]);
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

      const markdownBlock = buildMarkdownBlockFromPrepared(dataToFormat, { hint, inlineFormat: inline?.format });
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

      const standaloneBlock = buildMarkdownBlockFromPrepared(payload, { hint, inlineFormat: inline?.format });
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
function parseCliArgs(
  args: string[],
  params: MethodInfo['params']
): Record<string, any> {
  const result: Record<string, any> = {};

  // Create a map of param names to types for quick lookup
  const paramTypes = new Map(params.map(p => [p.name, p.type]));

  // Handle both positional and --flag style arguments
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
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
        i++;
        if (i < args.length) {
          const expectedType = paramTypes.get(key) || 'any';
          result[key] = coerceValue(args[i], expectedType);
        } else {
          // Boolean flag
          result[key] = true;
        }
      }
    } else {
      // Positional argument
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
  if (expectedType === 'number' && (value.startsWith('+') || value.startsWith('-'))) {
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

  if (blockPatterns.some(pattern => pattern.test(trimmed))) {
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

function renderMarkdownNicely(content: string): void {
  const termWidth = process.stdout.columns || 80;
  let rendered = content.replace(/\r/g, '');

  // Normalize heading indentation
  rendered = rendered.replace(/^[\t ]+(?=#{1,6}\s)/gm, '');

  // Attach standalone emoji lines to following headings
  rendered = rendered.replace(/^[ \t]*([^\w\s]{1,4})\s*\n([ \t]*#{1,6}\s+)(.+)$/gm, (_m, emoji, hashes, title) => {
    return `${hashes}${emoji.trim()} ${title}`;
  });

  // Heuristic: Merge standalone emojis (or short lines) into the following header
  // This fixes the "floating emoji" look by making them part of the header
  rendered = rendered.replace(/(^|\n)([^\n]{1,5})\n+(#{1,6})\s+(.+)$/gm, (_m, prefix, icon, hashes, text) => {
    return `${prefix}${hashes} ${icon.trim()} ${text}`;
  });

  // Convert Markdown tables to box-drawn tables
  rendered = rendered.replace(/(^|\n)(\|[^\n]+\|\n\|[^\n]+\|\n(?:\|[^\n]+\|\n?)+)/g, (_m, prefix, block) => {
    return `${prefix}${renderMarkdownTableBlock(block.trim())}`;
  });

  // Extract code blocks to prevent wrapping them
  const codeBlocks: string[] = [];
  rendered = rendered.replace(/```(\w*)\n([\s\S]*?)```/g, (match) => {
    codeBlocks.push(match);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  // Wrap text paragraphs
  rendered = rendered.split('\n').map(line => {
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
  }).join('\n');

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

  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    chalk.blueBright(text) + chalk.dim(` (${url})`)
  );

  rendered = rendered.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, text) => {
    const level = hashes.length;
    const colorFn = level === 1 ? chalk.magenta.bold : level === 2 ? chalk.yellow.bold : chalk.cyan;
    return colorFn(text.trim());
  });

  rendered = rendered.replace(/^> (.+)$/gm, (_m, quote) => chalk.dim('│ ') + chalk.italic(quote));
  rendered = rendered.replace(/^---+$/gm, chalk.dim('─'.repeat(40)));
  rendered = rendered.replace(/^- /gm, chalk.dim('  • '));
  rendered = rendered.replace(/^(\d+)\. /gm, (_m, num) => chalk.dim(`  ${num}. `));
  rendered = rendered.replace(/\*\*(.+?)\*\*/g, (_m, text) => chalk.bold(text));
  rendered = rendered.replace(/\*(.+?)\*/g, (_m, text) => chalk.italic(text));
  rendered = rendered.replace(/_(.+?)_/g, (_m, text) => chalk.italic(text));
  rendered = rendered.replace(/`([^`]+)`/g, (_m, code) => chalk.cyan(code));

  rendered = rendered.split('\n').map(line => line.trimEnd()).join('\n');
  rendered = rendered.replace(/\n{3,}/g, '\n\n');
  console.log(rendered.trim());
}

function convertFrontMatterToMarkdown(markdown: string): { markdown: string; metadata: Record<string, string>; hadFrontMatter: boolean } {
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
  const rows = Object.entries(parsed).map(([key, value]) => `| ${escapePipes(key)} | ${escapePipes(value)} |`).join('\n');
  return [
    '| Field | Value |',
    '| --- | --- |',
    rows,
  ].join('\n');
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
    format: candidate as OutputFormat,
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
    .filter(row => row.length === header.length);

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
    .map(cell => cell.trim());
}

function renderGenericTable(headers: string[], rows: string[][]): string {
  if (!headers.length) {
    return rows.map(row => row.join(' | ')).join('\n');
  }

  const termWidth = process.stdout.columns || 80;
  const columns = headers.length;
  const baseOverhead = 2 * columns + (columns - 1) + 2; // padding + connectors + borders
  const maxAvailable = Math.max(columns, termWidth - baseOverhead);

  const colWidths = headers.map(header => Math.max(visibleLength(header), 3));
  rows.forEach(row => {
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

  const wrappedRows = [headers, ...rows].map(row =>
    row.map((cell, idx) => wrapToWidth(cell ?? '', colWidths[idx] || 1))
  );

  const horizontal = colWidths.map(width => '─'.repeat(width + 2));
  const top = `┌${horizontal.join('┬')}┐`;
  const mid = `├${horizontal.join('┼')}┤`;
  const bottom = `└${horizontal.join('┴')}┘`;

  const formatWrappedRow = (wrappedCells: string[][]): string[] => {
    const maxLines = Math.max(...wrappedCells.map(cell => cell.length));
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
 * Print help for a specific method
 */
function printMethodHelp(photonName: string, method: MethodInfo): void {
  console.log(`\nNAME:`);
  console.log(`    ${method.name} - ${method.description || 'No description'}\n`);

  console.log(`USAGE:`);
  const requiredParams = method.params.filter(p => !p.optional);
  const optionalParams = method.params.filter(p => p.optional);

  let usage = `    photon cli ${photonName} ${method.name}`;
  if (requiredParams.length > 0) {
    usage += ' ' + requiredParams.map(p => `--${p.name} <value>`).join(' ');
  }
  if (optionalParams.length > 0) {
    usage += ' [options]';
  }
  console.log(usage + '\n');

  if (method.params.length > 0) {
    if (requiredParams.length > 0) {
      console.log(`REQUIRED:`);
      for (const param of requiredParams) {
        console.log(`    --${param.name}`);
        if (param.description) {
          console.log(`        ${param.description}`);
        }
      }
      console.log('');
    }

    if (optionalParams.length > 0) {
      console.log(`OPTIONS:`);
      for (const param of optionalParams) {
        console.log(`    --${param.name}`);
        if (param.description) {
          console.log(`        ${param.description}`);
        }
      }
      console.log('');
    }

    console.log(`GLOBAL OPTIONS:`);
    console.log(`    --json`);
    console.log(`        Output raw JSON instead of formatted text\n`);
  }

  console.log(`EXAMPLE:`);
  if (requiredParams.length > 0) {
    const exampleParams = requiredParams.map(p => `--${p.name} <value>`).join(' ');
    console.log(`    photon cli ${photonName} ${method.name} ${exampleParams}\n`);
  } else {
    console.log(`    photon cli ${photonName} ${method.name}\n`);
  }
}

/**
 * List all methods in a photon (standard CLI help format)
 */
export async function listMethods(photonName: string): Promise<void> {
  try {
    const resolvedPath = await resolvePhotonPath(photonName);

    if (!resolvedPath) {
      console.error(`❌ Photon '${photonName}' not found`);
      console.error(`\nMake sure the photon is installed in ~/.photon/`);
      process.exit(1);
    }

    const methods = await extractMethods(resolvedPath);

    // Print usage
    console.log(`\nUSAGE:`);
    console.log(`    photon cli ${photonName} <command> [options]\n`);

    // Print commands
    console.log(`COMMANDS:`);

    // Find longest method name for alignment
    const maxLength = Math.max(...methods.map(m => m.name.length));

    for (const method of methods) {
      const padding = ' '.repeat(maxLength - method.name.length + 4);
      const description = method.description || 'No description';
      console.log(`    ${method.name}${padding}${description}`);
    }

    // Print footer
    console.log(`\nFor detailed parameter information, run:`);
    console.log(`    photon cli ${photonName} <command> --help\n`);

    // Print examples if there are methods
    if (methods.length > 0) {
      console.log(`EXAMPLES:`);
      // Show first 3 methods as examples
      const exampleMethods = methods.slice(0, 3);
      for (const method of exampleMethods) {
        const requiredParams = method.params.filter(p => !p.optional);
        if (requiredParams.length > 0) {
          const paramStr = requiredParams.map(p => `--${p.name} <value>`).join(' ');
          console.log(`    photon cli ${photonName} ${method.name} ${paramStr}`);
        } else {
          console.log(`    photon cli ${photonName} ${method.name}`);
        }
      }
      console.log('');
    }
  } catch (error) {
    console.error(`❌ Error: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

/**
 * Run a photon method from CLI
 */
export async function runMethod(
  photonName: string,
  methodName: string,
  args: string[]
): Promise<void> {
  // Set up readline prompt handler for CLI
  setPromptHandler(async (message: string, defaultValue?: string) => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const prompt = defaultValue
        ? `${message} [${defaultValue}]: `
        : `${message}: `;

      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer || defaultValue || null);
      });
    });
  });

  try {
    // Resolve photon path
    const resolvedPath = await resolvePhotonPath(photonName);

    if (!resolvedPath) {
      console.error(`❌ Photon '${photonName}' not found`);
      console.error(`\nMake sure the photon is installed in ~/.photon/`);
      process.exit(1);
    }

    // Extract MCP name from filename
    const mcpName = path.basename(resolvedPath).replace(/\.photon\.(ts|js)$/, '');

    // Extract methods to validate
    const methods = await extractMethods(resolvedPath);

    // Check if methodName itself is --help (e.g., photon cli test-cli-calc --help)
    if (methodName === '--help' || methodName === '-h') {
      await listMethods(photonName);
      return;
    }

    const method = methods.find(m => m.name === methodName);

    if (!method) {
      console.error(`❌ Method '${methodName}' not found in ${photonName}`);
      console.error(`\nAvailable methods: ${methods.map(m => m.name).join(', ')}`);
      console.error(`\nRun 'photon cli ${photonName}' to see all methods`);
      process.exit(1);
    }

    // Check for --help flag in args (e.g., photon cli test-cli-calc add --help)
    if (args.includes('--help') || args.includes('-h')) {
      printMethodHelp(photonName, method);
      return;
    }

    // Check for --json flag
    const jsonOutput = args.includes('--json');

    // Check for --resume <runId> flag
    let resumeRunId: string | undefined;
    const resumeIndex = args.indexOf('--resume');
    if (resumeIndex !== -1 && args[resumeIndex + 1]) {
      resumeRunId = args[resumeIndex + 1];
    }

    // Filter out special flags before parsing method args
    const filteredArgs = args.filter((arg, i) =>
      arg !== '--json' &&
      arg !== '--resume' &&
      (resumeIndex === -1 || i !== resumeIndex + 1)
    );

    // Parse arguments
    const parsedArgs = parseCliArgs(filteredArgs, method.params);

    // Validate required parameters
    const missing: string[] = [];
    for (const param of method.params) {
      if (!param.optional && !(param.name in parsedArgs)) {
        missing.push(param.name);
      }
    }

    if (missing.length > 0) {
      console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
      console.error(`\nUsage: photon cli ${photonName} ${methodName} ${method.params.map(p =>
        p.optional ? `[--${p.name}]` : `--${p.name} <value>`
      ).join(' ')}`);
      process.exit(1);
    }

    // Check if photon is stateful
    const extractor = new PhotonDocExtractor(resolvedPath);
    const metadata = await extractor.extractFullMetadata();

    let result: any;

    if (metadata.stateful) {
      // STATEFUL PATH: Use daemon
      // Check if daemon is running
      if (!isDaemonRunning(photonName)) {
        await startDaemon(photonName, resolvedPath, true); // quiet mode

        // Wait for daemon to be ready
        let ready = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (await pingDaemon(photonName)) {
            ready = true;
            break;
          }
        }

        if (!ready) {
          console.error(`❌ Failed to start daemon for ${photonName}`);
          process.exit(1);
        }
      }

      // Send command to daemon
      result = await sendCommand(photonName, methodName, parsedArgs);
    } else {
      // STATELESS PATH: Direct execution
      const loader = new PhotonLoader(false); // verbose=false for CLI mode
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
      const formatHint = method.format || (looksLikeMarkdown(actualResult) ? 'markdown' : undefined);
      const success = formatOutput(actualResult, formatHint);
      if (!success) {
        process.exit(1);
      }

      // Show run ID for stateful workflows
      if (isStateful && result.runId) {
        console.log('');
        if (result.resumed && result.resumedFromStep !== undefined) {
          console.log(`Resumed from step ${result.resumedFromStep}, completed ${result.checkpointsCompleted} checkpoints`);
        }
        console.log(`Run ID: ${result.runId}`);
      }
    }

  } catch (error) {
    // Check for custom user-facing message from photon
    // Photons can throw: throw Object.assign(new Error('internal'), { userMessage: 'friendly msg', hint: 'try this' })
    const userMessage = (error && typeof error === 'object' && 'userMessage' in error && error.userMessage)
      || getErrorMessage(error)
      || 'Unknown error occurred';
    const hint = error && typeof error === 'object' && 'hint' in error ? error.hint : undefined;

    console.error(`❌ ${userMessage}`);
    if (hint) {
      console.error(`💡 ${hint}`);
    }

    process.exit(1);
  }
}

/**
 * Convert MCP name and parameter name to environment variable name
 */
function toEnvVarName(mcpName: string, paramName: string): string {
  const mcpPrefix = mcpName.toUpperCase().replace(/-/g, '_');
  const paramSuffix = paramName
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
  return `${mcpPrefix}_${paramSuffix}`;
}
