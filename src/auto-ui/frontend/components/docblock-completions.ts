/**
 * CodeMirror autocomplete source for photon JSDoc tags.
 * Provides completions for class-level, method-level, and inline parameter tags.
 */
import { snippet } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import {
  buildPhotonDocblockTagCatalog,
  type PhotonDocblockTagDef as TagDef,
} from '../../../editor-support/docblock-tag-catalog.js';

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
  // Structural
  { label: 'table', detail: 'Array as table', type: 'constant' },
  { label: 'list', detail: 'Styled list', type: 'constant' },
  { label: 'grid', detail: 'Visual grid', type: 'constant' },
  { label: 'tree', detail: 'Hierarchical data', type: 'constant' },
  { label: 'card', detail: 'Single object card', type: 'constant' },
  { label: 'kanban', detail: 'Column board (Trello-style)', type: 'constant' },
  { label: 'steps', detail: 'Step indicator (pipeline/wizard)', type: 'constant' },
  { label: 'comparison', detail: 'Side-by-side feature/pricing table', type: 'constant' },
  // Content
  { label: 'json', detail: 'JSON highlight', type: 'constant' },
  { label: 'markdown', detail: 'Markdown render', type: 'constant' },
  { label: 'yaml', detail: 'YAML highlight', type: 'constant' },
  { label: 'mermaid', detail: 'Mermaid diagram', type: 'constant' },
  { label: 'code', detail: 'Syntax-highlighted code', type: 'constant' },
  { label: 'code:typescript', detail: 'TypeScript code', type: 'constant' },
  { label: 'code:javascript', detail: 'JavaScript code', type: 'constant' },
  { label: 'code:python', detail: 'Python code', type: 'constant' },
  { label: 'diff', detail: 'Color-coded diff viewer', type: 'constant' },
  { label: 'log', detail: 'Severity-colored log viewer', type: 'constant' },
  { label: 'embed', detail: 'Embedded URL/video iframe', type: 'constant' },
  // Visualization
  { label: 'chart:bar', detail: 'Bar chart', type: 'constant' },
  { label: 'chart:hbar', detail: 'Horizontal bar chart', type: 'constant' },
  { label: 'chart:line', detail: 'Line chart', type: 'constant' },
  { label: 'chart:pie', detail: 'Pie chart', type: 'constant' },
  { label: 'chart:area', detail: 'Area chart', type: 'constant' },
  { label: 'chart:donut', detail: 'Donut chart', type: 'constant' },
  { label: 'metric', detail: 'KPI display (number + trend)', type: 'constant' },
  { label: 'stat-group', detail: 'Row of KPI metric cards', type: 'constant' },
  { label: 'gauge', detail: 'Circular gauge', type: 'constant' },
  { label: 'progress', detail: 'Progress bar', type: 'constant' },
  { label: 'badge', detail: 'Status badge', type: 'constant' },
  { label: 'timeline', detail: 'Event timeline', type: 'constant' },
  { label: 'heatmap', detail: '2D intensity grid', type: 'constant' },
  { label: 'calendar', detail: 'Month calendar with events', type: 'constant' },
  { label: 'map', detail: 'Geographic map with markers', type: 'constant' },
  { label: 'network', detail: 'Force-directed node graph', type: 'constant' },
  { label: 'cron', detail: 'Cron schedule visualizer', type: 'constant' },
  { label: 'qr', detail: 'QR code', type: 'constant' },
  // Design/Layout
  { label: 'image', detail: 'Image or gallery', type: 'constant' },
  { label: 'carousel', detail: 'Swipeable image slides', type: 'constant' },
  { label: 'gallery', detail: 'Photo grid with lightbox', type: 'constant' },
  { label: 'masonry', detail: 'Pinterest-style layout', type: 'constant' },
  { label: 'hero', detail: 'Landing section with CTA', type: 'constant' },
  { label: 'banner', detail: 'Alert/notification bar', type: 'constant' },
  { label: 'quote', detail: 'Blockquote with attribution', type: 'constant' },
  { label: 'profile', detail: 'User card with avatar', type: 'constant' },
  { label: 'feature-grid', detail: 'Feature list with icons', type: 'constant' },
  { label: 'invoice', detail: 'Invoice/receipt document', type: 'constant' },
  // Presentation
  { label: 'slides', detail: 'Slide presentation', type: 'constant' },
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
  const { allTags, inlineGeneralTags, inlineParamTags } =
    buildPhotonDocblockTagCatalog(runtimeVersion);

  return function photonDocblockCompletions(context: CompletionContext): CompletionResult | null {
    if (!isInsideJSDoc(context)) return null;

    // Check for inline tags starting with {@
    const inlineMatch = context.matchBefore(/\{@\w*/);
    if (inlineMatch) {
      const inlineTags = isInsideParam(context)
        ? [...inlineGeneralTags, ...inlineParamTags]
        : inlineGeneralTags;
      return {
        from: inlineMatch.from,
        options: inlineTags.map(tagToCompletion),
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
  const formatMatch = lineText.match(/@format\s+([^\s{]*)$/);
  if (!formatMatch) return null;

  const from = context.pos - formatMatch[1].length;
  return { from, options: formatValues, validFor: /^[^\s{]*$/ };
}

interface RuntimeCompletionDef {
  label: string;
  detail: string;
  type: Completion['type'];
  info?: string;
  snippetTmpl?: string;
}

function runtimeCompletion(def: RuntimeCompletionDef): Completion {
  return {
    label: def.label,
    detail: def.detail,
    type: def.type,
    info: def.info,
    apply: def.snippetTmpl ? snippet(def.snippetTmpl) : undefined,
  };
}

const photonInstanceCompletions: Completion[] = [
  runtimeCompletion({
    label: 'assets',
    detail: 'Resolve or load a photon asset',
    type: 'method',
    snippetTmpl: "assets(${1:'slides.md'})",
  }),
  runtimeCompletion({
    label: 'assetUrl',
    detail: 'Get a Beam-served asset URL',
    type: 'method',
    snippetTmpl: "assetUrl(${1:'images/logo.png'})",
  }),
  runtimeCompletion({
    label: 'storage',
    detail: 'Get a photon data directory path',
    type: 'method',
    snippetTmpl: "storage(${1:'data'})",
  }),
  runtimeCompletion({
    label: 'memory',
    detail: 'Persistent key-value storage',
    type: 'property',
  }),
  runtimeCompletion({
    label: 'schedule',
    detail: 'Runtime task scheduling',
    type: 'property',
  }),
  runtimeCompletion({
    label: 'photon',
    detail: 'Access other photons dynamically',
    type: 'property',
  }),
  runtimeCompletion({
    label: 'caller',
    detail: 'Authenticated caller identity',
    type: 'property',
  }),
  runtimeCompletion({
    label: 'emit',
    detail: 'Emit progress or events',
    type: 'method',
    snippetTmpl: "emit(${1:{ status: 'processing', progress: 50 }})",
  }),
  runtimeCompletion({
    label: 'render',
    detail: 'Render intermediate formatted output',
    type: 'method',
    snippetTmpl: "render(${1:'table'}, ${2:value})",
  }),
  runtimeCompletion({
    label: 'call',
    detail: 'Call another photon method',
    type: 'method',
    snippetTmpl: "call(${1:'billing.generate'}, ${2:{ orderId: '123' }})",
  }),
  runtimeCompletion({
    label: 'mcp',
    detail: 'Connect to an MCP server client',
    type: 'method',
    snippetTmpl: "mcp(${1:'github'})",
  }),
  runtimeCompletion({
    label: 'hasMCPAccess',
    detail: 'Check whether MCP access is available',
    type: 'method',
    snippetTmpl: 'hasMCPAccess()',
  }),
  runtimeCompletion({
    label: 'listMCPServers',
    detail: 'List available MCP servers',
    type: 'method',
    snippetTmpl: 'listMCPServers()',
  }),
  runtimeCompletion({
    label: 'withLock',
    detail: 'Run code with a distributed lock',
    type: 'method',
    snippetTmpl: "withLock(${1:'resource:write'}, async () => {\n  ${2}\n})",
  }),
  runtimeCompletion({
    label: 'acquireLock',
    detail: 'Assign a lock to a caller',
    type: 'method',
    snippetTmpl: "acquireLock(${1:'turn'}, ${2:this.caller.id})",
  }),
  runtimeCompletion({
    label: 'transferLock',
    detail: 'Transfer a lock to another caller',
    type: 'method',
    snippetTmpl: "transferLock(${1:'turn'}, ${2:nextCallerId})",
  }),
  runtimeCompletion({
    label: 'releaseLock',
    detail: 'Release a held lock',
    type: 'method',
    snippetTmpl: "releaseLock(${1:'turn'})",
  }),
  runtimeCompletion({
    label: 'getLock',
    detail: 'Query lock holder info',
    type: 'method',
    snippetTmpl: "getLock(${1:'turn'})",
  }),
];

const photonMemoryCompletions: Completion[] = [
  runtimeCompletion({
    label: 'get',
    detail: 'Read a value',
    type: 'method',
    snippetTmpl: "get(${1:'key'})",
  }),
  runtimeCompletion({
    label: 'set',
    detail: 'Write a value',
    type: 'method',
    snippetTmpl: "set(${1:'key'}, ${2:value})",
  }),
  runtimeCompletion({
    label: 'delete',
    detail: 'Delete a value',
    type: 'method',
    snippetTmpl: "delete(${1:'key'})",
  }),
  runtimeCompletion({
    label: 'has',
    detail: 'Check key existence',
    type: 'method',
    snippetTmpl: "has(${1:'key'})",
  }),
  runtimeCompletion({
    label: 'keys',
    detail: 'List keys',
    type: 'method',
    snippetTmpl: "keys(${1:'photon'})",
  }),
  runtimeCompletion({
    label: 'clear',
    detail: 'Clear a scope',
    type: 'method',
    snippetTmpl: "clear(${1:'photon'})",
  }),
  runtimeCompletion({
    label: 'getAll',
    detail: 'Read all values',
    type: 'method',
    snippetTmpl: "getAll(${1:'photon'})",
  }),
  runtimeCompletion({
    label: 'update',
    detail: 'Read-modify-write helper',
    type: 'method',
    snippetTmpl: "update(${1:'key'}, (${2:current}) => ${3:current})",
  }),
  runtimeCompletion({ label: 'sessionId', detail: 'Current session scope id', type: 'property' }),
];

const photonScheduleCompletions: Completion[] = [
  runtimeCompletion({
    label: 'create',
    detail: 'Create a scheduled task',
    type: 'method',
    snippetTmpl:
      "create({\n  name: ${1:'nightly-cleanup'},\n  schedule: ${2:'0 0 * * *'},\n  method: ${3:'cleanup'}${4:,}\n})",
  }),
  runtimeCompletion({
    label: 'get',
    detail: 'Get a task by id',
    type: 'method',
    snippetTmpl: 'get(${1:taskId})',
  }),
  runtimeCompletion({
    label: 'getByName',
    detail: 'Get a task by name',
    type: 'method',
    snippetTmpl: "getByName(${1:'nightly-cleanup'})",
  }),
  runtimeCompletion({
    label: 'list',
    detail: 'List scheduled tasks',
    type: 'method',
    snippetTmpl: "list(${1:'active'})",
  }),
  runtimeCompletion({
    label: 'update',
    detail: 'Update a scheduled task',
    type: 'method',
    snippetTmpl: "update(${1:taskId}, ${2:{ schedule: '0 0 * * *' }})",
  }),
  runtimeCompletion({
    label: 'pause',
    detail: 'Pause a task',
    type: 'method',
    snippetTmpl: 'pause(${1:taskId})',
  }),
  runtimeCompletion({
    label: 'resume',
    detail: 'Resume a task',
    type: 'method',
    snippetTmpl: 'resume(${1:taskId})',
  }),
  runtimeCompletion({
    label: 'cancel',
    detail: 'Cancel a task',
    type: 'method',
    snippetTmpl: 'cancel(${1:taskId})',
  }),
  runtimeCompletion({
    label: 'cancelByName',
    detail: 'Cancel a task by name',
    type: 'method',
    snippetTmpl: "cancelByName(${1:'nightly-cleanup'})",
  }),
  runtimeCompletion({
    label: 'has',
    detail: 'Check schedule existence',
    type: 'method',
    snippetTmpl: "has(${1:'nightly-cleanup'})",
  }),
  runtimeCompletion({
    label: 'cancelAll',
    detail: 'Cancel all tasks',
    type: 'method',
    snippetTmpl: 'cancelAll()',
  }),
];

const photonCallerCompletions: Completion[] = [
  runtimeCompletion({ label: 'id', detail: 'Stable caller identifier', type: 'property' }),
  runtimeCompletion({ label: 'name', detail: 'Caller display name', type: 'property' }),
  runtimeCompletion({
    label: 'anonymous',
    detail: 'True when no auth token was provided',
    type: 'property',
  }),
  runtimeCompletion({ label: 'scope', detail: 'Granted OAuth scopes', type: 'property' }),
  runtimeCompletion({ label: 'claims', detail: 'Raw JWT claims', type: 'property' }),
];

const photonNestedCompletions: Record<string, Completion[]> = {
  memory: photonMemoryCompletions,
  schedule: photonScheduleCompletions,
  caller: photonCallerCompletions,
  photon: [
    runtimeCompletion({
      label: 'use',
      detail: 'Access another photon instance',
      type: 'method',
      snippetTmpl: "use(${1:'billing'}, ${2:'default'})",
    }),
  ],
};

export function photonRuntimeCompletions(context: CompletionContext): CompletionResult | null {
  if (isInsideJSDoc(context)) return null;

  const fullMatch = context.matchBefore(/this(?:\.[A-Za-z_$][\w$]*)*\.[A-Za-z_$]*$/);
  if (!fullMatch) return null;

  const expression = fullMatch.text;
  const segments = expression.split('.');
  if (segments[0] !== 'this') return null;

  const prefix = segments.at(-1) ?? '';
  const parent = segments.length > 2 ? segments[segments.length - 2] : null;
  const options = parent ? photonNestedCompletions[parent] : photonInstanceCompletions;
  if (!options || options.length === 0) return null;

  return {
    from: context.pos - prefix.length,
    options,
    validFor: /^[A-Za-z_$][\w$]*$/,
  };
}
