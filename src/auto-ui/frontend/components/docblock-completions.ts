/**
 * CodeMirror autocomplete source for photon JSDoc tags.
 * Provides completions for class-level, method-level, and inline parameter tags.
 */
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';

interface TagDef {
  label: string;
  detail: string;
  info?: string;
  template?: string;
  type: 'keyword';
}

// Class-level tags (before class declaration)
const classLevelTags: TagDef[] = [
  { label: '@version', detail: 'Photon version', template: '@version ${1:1.0.0}', type: 'keyword' },
  { label: '@author', detail: 'Author name', template: '@author ${1:Name}', type: 'keyword' },
  { label: '@license', detail: 'License type', template: '@license ${1:MIT}', type: 'keyword' },
  { label: '@repository', detail: 'Source repository URL', template: '@repository ${1:https://github.com/user/repo}', type: 'keyword' },
  { label: '@homepage', detail: 'Project homepage URL', template: '@homepage ${1:https://example.com}', type: 'keyword' },
  { label: '@runtime', detail: 'Required runtime version', info: 'The photon will refuse to load if the runtime doesn\'t match', template: '@runtime ^${1:1.5.0}', type: 'keyword' },
  { label: '@dependencies', detail: 'NPM packages to auto-install', template: '@dependencies ${1:package@^1.0.0}', type: 'keyword' },
  { label: '@mcp', detail: 'MCP dependency injection', template: '@mcp ${1:name} ${2:package}', type: 'keyword' },
  { label: '@photon', detail: 'Photon dependency injection', template: '@photon ${1:name} ${2:./path.photon.ts}', type: 'keyword' },
  { label: '@cli', detail: 'System CLI tool dependency', template: '@cli ${1:tool} - ${2:https://install-url}', type: 'keyword' },
  { label: '@stateful', detail: 'Maintains state between calls', template: '@stateful true', type: 'keyword' },
  { label: '@idleTimeout', detail: 'Idle timeout in ms', template: '@idleTimeout ${1:300000}', type: 'keyword' },
  { label: '@ui', detail: 'UI template asset', template: '@ui ${1:view-name} ${2:./ui/view.html}', type: 'keyword' },
  { label: '@prompt', detail: 'Static prompt asset', template: '@prompt ${1:name} ${2:./prompts/prompt.txt}', type: 'keyword' },
  { label: '@resource', detail: 'Static resource asset', template: '@resource ${1:name} ${2:./data.json}', type: 'keyword' },
  { label: '@icon', detail: 'Photon icon (emoji)', template: '@icon ${1:🔧}', type: 'keyword' },
  { label: '@tags', detail: 'Categorization tags', template: '@tags ${1:tag1, tag2}', type: 'keyword' },
  { label: '@internal', detail: 'Hidden from main UI', template: '@internal', type: 'keyword' },
];

// Method-level tags (before method declaration)
const methodLevelTags: TagDef[] = [
  { label: '@param', detail: 'Tool parameter', template: '@param ${1:name} ${2:Description}', type: 'keyword' },
  { label: '@returns', detail: 'Return value description', template: '@returns ${1:Description}', type: 'keyword' },
  { label: '@example', detail: 'Code example', template: '@example ${1:code}', type: 'keyword' },
  { label: '@format', detail: 'Output format hint', template: '@format ${1:table}', type: 'keyword' },
  { label: '@icon', detail: 'Tool icon', template: '@icon ${1:🔧}', type: 'keyword' },
  { label: '@autorun', detail: 'Auto-execute in Beam UI', template: '@autorun', type: 'keyword' },
  { label: '@ui', detail: 'Link to UI template', template: '@ui ${1:view-name}', type: 'keyword' },
  { label: '@webhook', detail: 'HTTP webhook endpoint', template: '@webhook ${1:path}', type: 'keyword' },
  { label: '@scheduled', detail: 'Cron schedule', template: '@scheduled ${1:0 0 * * *}', type: 'keyword' },
  { label: '@cron', detail: 'Cron schedule (alias)', template: '@cron ${1:0 0 * * *}', type: 'keyword' },
  { label: '@locked', detail: 'Distributed lock', template: '@locked ${1:lock-name}', type: 'keyword' },
];

// Inline parameter tags (inside @param descriptions)
const inlineParamTags: TagDef[] = [
  { label: '{@min', detail: 'Minimum value', template: '{@min ${1:0}}', type: 'keyword' },
  { label: '{@max', detail: 'Maximum value', template: '{@max ${1:100}}', type: 'keyword' },
  { label: '{@format', detail: 'Input format', template: '{@format ${1:email}}', type: 'keyword' },
  { label: '{@pattern', detail: 'Regex pattern', template: '{@pattern ${1:^[a-z]+$}}', type: 'keyword' },
  { label: '{@example', detail: 'Example value', template: '{@example ${1:value}}', type: 'keyword' },
  { label: '{@choice', detail: 'Allowed values', template: '{@choice ${1:a,b,c}}', type: 'keyword' },
  { label: '{@field', detail: 'HTML input type', template: '{@field ${1:textarea}}', type: 'keyword' },
  { label: '{@label', detail: 'Custom display label', template: '{@label ${1:Label}}', type: 'keyword' },
  { label: '{@default', detail: 'Default value', template: '{@default ${1:value}}', type: 'keyword' },
];

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

// All tags combined for general matching
const allTags: TagDef[] = [...classLevelTags, ...methodLevelTags];

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
 * CodeMirror autocomplete source for photon JSDoc tags.
 * Triggered when typing `@` or `{@` inside a JSDoc comment block.
 */
export function photonDocblockCompletions(context: CompletionContext): CompletionResult | null {
  if (!isInsideJSDoc(context)) return null;

  // Check for inline tags starting with {@
  const inlineMatch = context.matchBefore(/\{@\w*/);
  if (inlineMatch && isInsideParam(context)) {
    const options: Completion[] = inlineParamTags.map(tag => ({
      label: tag.label,
      detail: tag.detail,
      type: tag.type,
      apply: tag.template || tag.label,
    }));
    return { from: inlineMatch.from, options, validFor: /^\{@\w*$/ };
  }

  // Check for @ tags at start of line (after * in JSDoc)
  const tagMatch = context.matchBefore(/@\w*/);
  if (!tagMatch) return null;

  const options: Completion[] = allTags.map(tag => ({
    label: tag.label,
    detail: tag.detail,
    info: tag.info,
    type: tag.type,
    apply: tag.template || tag.label,
  }));

  return { from: tagMatch.from, options, validFor: /^@\w*$/ };
}

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
