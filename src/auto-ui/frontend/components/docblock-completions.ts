/**
 * CodeMirror autocomplete source for photon JSDoc tags.
 * Provides completions for class-level, method-level, and inline parameter tags.
 */
import { snippet } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';

interface TagDef {
  label: string;
  detail: string;
  info?: string;
  /** Plain text to insert (no tab-stops). Mutually exclusive with snippetTmpl. */
  apply?: string;
  /** Snippet template with ${N:placeholder} tab-stops. */
  snippetTmpl?: string;
  type: 'keyword';
}

/**
 * Build the tag lists. Accepts the runtime version so @runtime inserts the real value.
 */
function buildTags(runtimeVersion: string) {
  const ver = runtimeVersion || '1.0.0';

  // Class-level tags (before class declaration)
  const classLevelTags: TagDef[] = [
    { label: '@version', detail: 'Photon version', snippetTmpl: '@version ${1:1.0.0}', type: 'keyword' },
    { label: '@author', detail: 'Author name', snippetTmpl: '@author ${1:Name}', type: 'keyword' },
    { label: '@license', detail: 'License type', snippetTmpl: '@license ${1:MIT}', type: 'keyword' },
    { label: '@repository', detail: 'Source repository URL', snippetTmpl: '@repository ${1:https://github.com/user/repo}', type: 'keyword' },
    { label: '@homepage', detail: 'Project homepage URL', snippetTmpl: '@homepage ${1:https://example.com}', type: 'keyword' },
    { label: '@runtime', detail: 'Required runtime version', info: 'Photon refuses to load if the runtime doesn\'t match', apply: `@runtime ^${ver}`, type: 'keyword' },
    { label: '@dependencies', detail: 'NPM packages to auto-install', snippetTmpl: '@dependencies ${1:package@^1.0.0}', type: 'keyword' },
    { label: '@mcp', detail: 'MCP dependency injection', snippetTmpl: '@mcp ${1:name} ${2:package}', type: 'keyword' },
    { label: '@photon', detail: 'Photon dependency injection', snippetTmpl: '@photon ${1:name} ${2:./path.photon.ts}', type: 'keyword' },
    { label: '@cli', detail: 'System CLI tool dependency', snippetTmpl: '@cli ${1:tool} - ${2:https://install-url}', type: 'keyword' },
    { label: '@stateful', detail: 'Maintains state between calls', apply: '@stateful true', type: 'keyword' },
    { label: '@idleTimeout', detail: 'Idle timeout in ms', snippetTmpl: '@idleTimeout ${1:300000}', type: 'keyword' },
    { label: '@ui', detail: 'UI template asset', snippetTmpl: '@ui ${1:view-name} ${2:./ui/view.html}', type: 'keyword' },
    { label: '@prompt', detail: 'Static prompt asset', snippetTmpl: '@prompt ${1:name} ${2:./prompts/prompt.txt}', type: 'keyword' },
    { label: '@resource', detail: 'Static resource asset', snippetTmpl: '@resource ${1:name} ${2:./data.json}', type: 'keyword' },
    { label: '@icon', detail: 'Photon icon (emoji)', snippetTmpl: '@icon ${1:🔧}', type: 'keyword' },
    { label: '@tags', detail: 'Categorization tags', snippetTmpl: '@tags ${1:tag1, tag2}', type: 'keyword' },
    { label: '@internal', detail: 'Hidden from main UI', apply: '@internal', type: 'keyword' },
  ];

  // Method-level tags (before method declaration)
  const methodLevelTags: TagDef[] = [
    { label: '@param', detail: 'Tool parameter', snippetTmpl: '@param ${1:name} ${2:Description}', type: 'keyword' },
    { label: '@returns', detail: 'Return value description', snippetTmpl: '@returns ${1:Description}', type: 'keyword' },
    { label: '@example', detail: 'Code example', snippetTmpl: '@example ${1:code}', type: 'keyword' },
    { label: '@format', detail: 'Output format hint', snippetTmpl: '@format ${1:table}', type: 'keyword' },
    { label: '@icon', detail: 'Tool icon', snippetTmpl: '@icon ${1:🔧}', type: 'keyword' },
    { label: '@autorun', detail: 'Auto-execute in Beam UI', apply: '@autorun', type: 'keyword' },
    { label: '@ui', detail: 'Link to UI template', snippetTmpl: '@ui ${1:view-name}', type: 'keyword' },
    { label: '@webhook', detail: 'HTTP webhook endpoint', snippetTmpl: '@webhook ${1:path}', type: 'keyword' },
    { label: '@scheduled', detail: 'Cron schedule', snippetTmpl: '@scheduled ${1:0 0 * * *}', type: 'keyword' },
    { label: '@cron', detail: 'Cron schedule (alias)', snippetTmpl: '@cron ${1:0 0 * * *}', type: 'keyword' },
    { label: '@locked', detail: 'Distributed lock', snippetTmpl: '@locked ${1:lock-name}', type: 'keyword' },
  ];

  // Inline parameter tags (inside @param descriptions)
  const inlineParamTags: TagDef[] = [
    { label: '{@min', detail: 'Minimum value', snippetTmpl: '{@min ${1:0}}', type: 'keyword' },
    { label: '{@max', detail: 'Maximum value', snippetTmpl: '{@max ${1:100}}', type: 'keyword' },
    { label: '{@format', detail: 'Input format', snippetTmpl: '{@format ${1:email}}', type: 'keyword' },
    { label: '{@pattern', detail: 'Regex pattern', snippetTmpl: '{@pattern ${1:^[a-z]+$$}}', type: 'keyword' },
    { label: '{@example', detail: 'Example value', snippetTmpl: '{@example ${1:value}}', type: 'keyword' },
    { label: '{@choice', detail: 'Allowed values', snippetTmpl: '{@choice ${1:a,b,c}}', type: 'keyword' },
    { label: '{@field', detail: 'HTML input type', snippetTmpl: '{@field ${1:textarea}}', type: 'keyword' },
    { label: '{@label', detail: 'Custom display label', snippetTmpl: '{@label ${1:Label}}', type: 'keyword' },
    { label: '{@default', detail: 'Default value', snippetTmpl: '{@default ${1:value}}', type: 'keyword' },
  ];

  const allTags: TagDef[] = [...classLevelTags, ...methodLevelTags];

  return { allTags, inlineParamTags };
}

/**
 * Convert a TagDef to a CM6 Completion, using snippet() for templates with tab-stops.
 */
function tagToCompletion(tag: TagDef): Completion {
  const base: Completion = {
    label: tag.label,
    detail: tag.detail,
    info: tag.info,
    type: tag.type,
  };
  if (tag.snippetTmpl) {
    base.apply = snippet(tag.snippetTmpl);
  } else if (tag.apply) {
    base.apply = tag.apply;
  }
  return base;
}

// Format values for @format tag completions
const formatValues: Completion[] = [
  { label: 'table', detail: 'Array as table', type: 'constant' },
  { label: 'list', detail: 'Styled list', type: 'constant' },
  { label: 'grid', detail: 'Visual grid', type: 'constant' },
  { label: 'tree', detail: 'Hierarchical data', type: 'constant' },
  { label: 'card', detail: 'Single object card', type: 'constant' },
  { label: 'json', detail: 'JSON highlight', type: 'constant' },
  { label: 'markdown', detail: 'Markdown render', type: 'constant' },
  { label: 'yaml', detail: 'YAML highlight', type: 'constant' },
  { label: 'mermaid', detail: 'Mermaid diagram', type: 'constant' },
  { label: 'code', detail: 'Code block', type: 'constant' },
  { label: 'code:typescript', detail: 'TypeScript code', type: 'constant' },
  { label: 'code:javascript', detail: 'JavaScript code', type: 'constant' },
  { label: 'code:python', detail: 'Python code', type: 'constant' },
];

/**
 * Check if cursor is inside a JSDoc comment block.
 */
function isInsideJSDoc(context: CompletionContext): boolean {
  const { state, pos } = context;
  const textBefore = state.doc.sliceString(Math.max(0, pos - 500), pos);
  const lastOpen = textBefore.lastIndexOf('/**');
  const lastClose = textBefore.lastIndexOf('*/');
  return lastOpen > lastClose;
}

/**
 * Check if current line has @param (for inline tag completions)
 */
function isInsideParam(context: CompletionContext): boolean {
  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text.substring(0, context.pos - line.from);
  return lineText.includes('@param');
}

/**
 * Create a CodeMirror autocomplete source for photon JSDoc tags.
 * Call with the runtime version to get the correct @runtime default.
 */
export function createDocblockCompletions(runtimeVersion = '') {
  const { allTags, inlineParamTags } = buildTags(runtimeVersion);

  return function photonDocblockCompletions(context: CompletionContext): CompletionResult | null {
    if (!isInsideJSDoc(context)) return null;

    // Check for inline tags starting with {@
    const inlineMatch = context.matchBefore(/\{@\w*/);
    if (inlineMatch && isInsideParam(context)) {
      return {
        from: inlineMatch.from,
        options: inlineParamTags.map(tagToCompletion),
        validFor: /^\{@\w*$/,
      };
    }

    // Check for @ tags at start of line (after * in JSDoc)
    const tagMatch = context.matchBefore(/@\w*/);
    if (!tagMatch) return null;

    return {
      from: tagMatch.from,
      options: allTags.map(tagToCompletion),
      validFor: /^@\w*$/,
    };
  };
}

/**
 * Default completions (without runtime version — fallback).
 */
export const photonDocblockCompletions = createDocblockCompletions();

/**
 * Completions for @format values.
 * Triggered after typing `@format `.
 */
export function photonFormatCompletions(context: CompletionContext): CompletionResult | null {
  if (!isInsideJSDoc(context)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text.substring(0, context.pos - line.from);

  // Match text after @format
  const formatMatch = lineText.match(/@format\s+(\w*)$/);
  if (!formatMatch) return null;

  const from = context.pos - formatMatch[1].length;
  return { from, options: formatValues, validFor: /^\w*$/ };
}
