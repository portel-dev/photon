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
    {
      label: '@version',
      detail: 'Photon version',
      snippetTmpl: '@version ${1:1.0.0}',
      type: 'keyword',
    },
    { label: '@author', detail: 'Author name', snippetTmpl: '@author ${1:Name}', type: 'keyword' },
    {
      label: '@license',
      detail: 'License type',
      snippetTmpl: '@license ${1:MIT}',
      type: 'keyword',
    },
    {
      label: '@repository',
      detail: 'Source repository URL',
      snippetTmpl: '@repository ${1:https://github.com/user/repo}',
      type: 'keyword',
    },
    {
      label: '@homepage',
      detail: 'Project homepage URL',
      snippetTmpl: '@homepage ${1:https://example.com}',
      type: 'keyword',
    },
    {
      label: '@runtime',
      detail: 'Required runtime version',
      info: "Photon refuses to load if the runtime doesn't match",
      apply: `@runtime ^${ver}`,
      type: 'keyword',
    },
    {
      label: '@dependencies',
      detail: 'NPM packages to auto-install',
      snippetTmpl: '@dependencies ${1:package@^1.0.0}',
      type: 'keyword',
    },
    {
      label: '@mcp',
      detail: 'MCP dependency injection',
      snippetTmpl: '@mcp ${1:name} ${2:package}',
      type: 'keyword',
    },
    {
      label: '@mcps',
      detail: 'MCP dependency list for diagrams',
      snippetTmpl: '@mcps ${1:filesystem, git}',
      type: 'keyword',
    },
    {
      label: '@photon',
      detail: 'Photon dependency injection',
      snippetTmpl: '@photon ${1:name} ${2:./path.photon.ts}',
      type: 'keyword',
    },
    {
      label: '@photons',
      detail: 'Photon dependency list for diagrams',
      snippetTmpl: '@photons ${1:calculator, billing}',
      type: 'keyword',
    },
    {
      label: '@cli',
      detail: 'System CLI tool dependency',
      snippetTmpl: '@cli ${1:tool} - ${2:https://install-url}',
      type: 'keyword',
    },
    {
      label: '@stateful',
      detail: 'Maintains state between calls',
      apply: '@stateful true',
      type: 'keyword',
    },
    {
      label: '@idleTimeout',
      detail: 'Idle timeout in ms',
      snippetTmpl: '@idleTimeout ${1:300000}',
      type: 'keyword',
    },
    {
      label: '@ui',
      detail: 'UI template asset',
      snippetTmpl: '@ui ${1:view-name} ${2:./ui/view.photon.html}',
      type: 'keyword',
    },
    {
      label: '@prompt',
      detail: 'Static prompt asset',
      snippetTmpl: '@prompt ${1:name} ${2:./prompts/prompt.txt}',
      type: 'keyword',
    },
    {
      label: '@resource',
      detail: 'Static resource asset',
      snippetTmpl: '@resource ${1:name} ${2:./data.json}',
      type: 'keyword',
    },
    {
      label: '@icon',
      detail: 'Photon icon (emoji)',
      snippetTmpl: '@icon ${1:🔧}',
      type: 'keyword',
    },
    {
      label: '@icons',
      detail: 'Photon icon variants',
      snippetTmpl: '@icons ${1:./icons/tool-48.png} ${2:48x48} ${3:dark}',
      type: 'keyword',
    },
    {
      label: '@tags',
      detail: 'Categorization tags',
      snippetTmpl: '@tags ${1:tag1, tag2}',
      type: 'keyword',
    },
    {
      label: '@label',
      detail: 'Custom Beam sidebar label',
      snippetTmpl: '@label ${1:My Custom Tool}',
      type: 'keyword',
    },
    { label: '@persist', detail: 'Persist settings UI state', apply: '@persist', type: 'keyword' },
    { label: '@worker', detail: 'Force worker isolation', apply: '@worker', type: 'keyword' },
    {
      label: '@noworker',
      detail: 'Force in-process execution',
      apply: '@noworker',
      type: 'keyword',
    },
    {
      label: '@auth',
      detail: 'OAuth auth requirement',
      snippetTmpl: '@auth ${1:required}',
      type: 'keyword',
    },
    {
      label: '@forkedFrom',
      detail: 'Origin reference for forked photons',
      snippetTmpl: '@forkedFrom ${1:portel-dev/photons#kanban}',
      type: 'keyword',
    },
    { label: '@internal', detail: 'Hidden from main UI', apply: '@internal', type: 'keyword' },
  ];

  // Method-level tags (before method declaration)
  const methodLevelTags: TagDef[] = [
    {
      label: '@param',
      detail: 'Tool parameter',
      snippetTmpl: '@param ${1:name} ${2:Description}',
      type: 'keyword',
    },
    {
      label: '@returns',
      detail: 'Return value description',
      snippetTmpl: '@returns ${1:Description}',
      type: 'keyword',
    },
    {
      label: '@example',
      detail: 'Code example',
      snippetTmpl: '@example ${1:code}',
      type: 'keyword',
    },
    {
      label: '@format',
      detail: 'Output format hint',
      snippetTmpl: '@format ${1:table}',
      type: 'keyword',
    },
    { label: '@icon', detail: 'Tool icon', snippetTmpl: '@icon ${1:🔧}', type: 'keyword' },
    {
      label: '@icons',
      detail: 'Tool icon variants',
      snippetTmpl: '@icons ${1:./icons/tool-48.png} ${2:48x48} ${3:dark}',
      type: 'keyword',
    },
    { label: '@autorun', detail: 'Auto-execute in Beam UI', apply: '@autorun', type: 'keyword' },
    { label: '@async', detail: 'Run in background', apply: '@async', type: 'keyword' },
    {
      label: '@ui',
      detail: 'Link to UI template',
      snippetTmpl: '@ui ${1:view-name}',
      type: 'keyword',
    },
    {
      label: '@fallback',
      detail: 'Return default value on error',
      snippetTmpl: '@fallback ${1:[]}',
      type: 'keyword',
    },
    {
      label: '@logged',
      detail: 'Auto-log execution with timing',
      snippetTmpl: '@logged ${1:debug}',
      type: 'keyword',
    },
    {
      label: '@circuitBreaker',
      detail: 'Fast-reject after repeated failures',
      snippetTmpl: '@circuitBreaker ${1:5} ${2:30s}',
      type: 'keyword',
    },
    {
      label: '@cached',
      detail: 'Memoize results with TTL',
      snippetTmpl: '@cached ${1:5m}',
      type: 'keyword',
    },
    {
      label: '@timeout',
      detail: 'Execution time limit',
      snippetTmpl: '@timeout ${1:30s}',
      type: 'keyword',
    },
    {
      label: '@retryable',
      detail: 'Auto-retry on failure',
      snippetTmpl: '@retryable ${1:3} ${2:1s}',
      type: 'keyword',
    },
    {
      label: '@throttled',
      detail: 'Rate limit per method',
      snippetTmpl: '@throttled ${1:10/min}',
      type: 'keyword',
    },
    {
      label: '@debounced',
      detail: 'Collapse rapid repeated calls',
      snippetTmpl: '@debounced ${1:500ms}',
      type: 'keyword',
    },
    {
      label: '@queued',
      detail: 'Sequential execution queue',
      snippetTmpl: '@queued ${1:1}',
      type: 'keyword',
    },
    {
      label: '@validate',
      detail: 'Runtime input validation rule',
      snippetTmpl: '@validate ${1:params.email must be a valid email}',
      type: 'keyword',
    },
    {
      label: '@deprecated',
      detail: 'Mark tool as deprecated',
      snippetTmpl: '@deprecated ${1:Use v2 instead}',
      type: 'keyword',
    },
    {
      label: '@internal',
      detail: 'Hide method from sidebar and LLM',
      apply: '@internal',
      type: 'keyword',
    },
    {
      label: '@use',
      detail: 'Apply middleware with inline config',
      snippetTmpl: '@use ${1:audit} ${2:{@level info}}',
      type: 'keyword',
    },
    {
      label: '@title',
      detail: 'Human-readable MCP tool title',
      snippetTmpl: '@title ${1:Create New Task}',
      type: 'keyword',
    },
    { label: '@readOnly', detail: 'Tool has no side effects', apply: '@readOnly', type: 'keyword' },
    {
      label: '@destructive',
      detail: 'Tool performs destructive operations',
      apply: '@destructive',
      type: 'keyword',
    },
    {
      label: '@idempotent',
      detail: 'Tool is safe to retry',
      apply: '@idempotent',
      type: 'keyword',
    },
    {
      label: '@openWorld',
      detail: 'Tool touches external systems',
      apply: '@openWorld',
      type: 'keyword',
    },
    {
      label: '@closedWorld',
      detail: 'Tool only uses local data',
      apply: '@closedWorld',
      type: 'keyword',
    },
    {
      label: '@audience',
      detail: 'Who should see results',
      snippetTmpl: '@audience ${1:user}',
      type: 'keyword',
    },
    {
      label: '@priority',
      detail: 'Result importance hint',
      snippetTmpl: '@priority ${1:0.8}',
      type: 'keyword',
    },
    {
      label: '@webhook',
      detail: 'HTTP webhook endpoint',
      snippetTmpl: '@webhook ${1:path}',
      type: 'keyword',
    },
    {
      label: '@scheduled',
      detail: 'Cron schedule',
      snippetTmpl: '@scheduled ${1:0 0 * * *}',
      type: 'keyword',
    },
    {
      label: '@cron',
      detail: 'Cron schedule (alias)',
      snippetTmpl: '@cron ${1:0 0 * * *}',
      type: 'keyword',
    },
    {
      label: '@locked',
      detail: 'Distributed lock',
      snippetTmpl: '@locked ${1:lock-name}',
      type: 'keyword',
    },
  ];

  const inlineGeneralTags: TagDef[] = [
    {
      label: '{@label',
      detail: 'Custom label or button title',
      snippetTmpl: '{@label ${1:Label}}',
      type: 'keyword',
    },
    {
      label: '{@title',
      detail: 'Layout title field mapping',
      snippetTmpl: '{@title ${1:title}}',
      type: 'keyword',
    },
    {
      label: '{@subtitle',
      detail: 'Layout subtitle field mapping',
      snippetTmpl: '{@subtitle ${1:subtitle}}',
      type: 'keyword',
    },
    {
      label: '{@badge',
      detail: 'Layout badge field mapping',
      snippetTmpl: '{@badge ${1:status}}',
      type: 'keyword',
    },
    {
      label: '{@detail',
      detail: 'Layout detail field mapping',
      snippetTmpl: '{@detail ${1:detail}}',
      type: 'keyword',
    },
    {
      label: '{@style',
      detail: 'Layout style hint',
      snippetTmpl: '{@style ${1:compact}}',
      type: 'keyword',
    },
    {
      label: '{@columns',
      detail: 'Layout column hint',
      snippetTmpl: '{@columns ${1:3}}',
      type: 'keyword',
    },
    {
      label: '{@value',
      detail: 'Value mapping for format/layout hints',
      snippetTmpl: '{@value ${1:value}}',
      type: 'keyword',
    },
    { label: '{@x', detail: 'Chart x-axis field', snippetTmpl: '{@x ${1:month}}', type: 'keyword' },
    {
      label: '{@y',
      detail: 'Chart y-axis field',
      snippetTmpl: '{@y ${1:amount}}',
      type: 'keyword',
    },
    {
      label: '{@series',
      detail: 'Chart series field',
      snippetTmpl: '{@series ${1:category}}',
      type: 'keyword',
    },
    {
      label: '{@min',
      detail: 'Gauge or numeric minimum',
      snippetTmpl: '{@min ${1:0}}',
      type: 'keyword',
    },
    {
      label: '{@max',
      detail: 'Gauge or numeric maximum',
      snippetTmpl: '{@max ${1:100}}',
      type: 'keyword',
    },
    {
      label: '{@date',
      detail: 'Date field mapping',
      snippetTmpl: '{@date ${1:createdAt}}',
      type: 'keyword',
    },
    {
      label: '{@description',
      detail: 'Description field mapping',
      snippetTmpl: '{@description ${1:summary}}',
      type: 'keyword',
    },
    {
      label: '{@group',
      detail: 'Grouping field mapping',
      snippetTmpl: '{@group ${1:team}}',
      type: 'keyword',
    },
    {
      label: '{@inner',
      detail: 'Nested inner format',
      snippetTmpl: '{@inner ${1:table}}',
      type: 'keyword',
    },
    {
      label: '{@level',
      detail: 'Logging or middleware level',
      snippetTmpl: '{@level ${1:info}}',
      type: 'keyword',
    },
    {
      label: '{@tags',
      detail: 'Middleware tags',
      snippetTmpl: '{@tags ${1:api,billing}}',
      type: 'keyword',
    },
    {
      label: '{@threshold',
      detail: 'Circuit breaker threshold',
      snippetTmpl: '{@threshold ${1:5}}',
      type: 'keyword',
    },
    {
      label: '{@resetAfter',
      detail: 'Circuit breaker reset duration',
      snippetTmpl: '{@resetAfter ${1:30s}}',
      type: 'keyword',
    },
    { label: '{@ttl', detail: 'Cache duration', snippetTmpl: '{@ttl ${1:5m}}', type: 'keyword' },
    {
      label: '{@ms',
      detail: 'Timeout duration',
      snippetTmpl: '{@ms ${1:30s}}',
      type: 'keyword',
    },
    {
      label: '{@count',
      detail: 'Retry count',
      snippetTmpl: '{@count ${1:3}}',
      type: 'keyword',
    },
    {
      label: '{@delay',
      detail: 'Retry or debounce delay',
      snippetTmpl: '{@delay ${1:1s}}',
      type: 'keyword',
    },
    {
      label: '{@rate',
      detail: 'Throttle rate',
      snippetTmpl: '{@rate ${1:10/min}}',
      type: 'keyword',
    },
    {
      label: '{@concurrency',
      detail: 'Queue concurrency',
      snippetTmpl: '{@concurrency ${1:1}}',
      type: 'keyword',
    },
    {
      label: '{@name',
      detail: 'Custom middleware or lock name',
      snippetTmpl: '{@name ${1:board:write}}',
      type: 'keyword',
    },
  ];

  // Inline parameter tags (inside @param descriptions)
  const inlineParamTags: TagDef[] = [
    { label: '{@min', detail: 'Minimum value', snippetTmpl: '{@min ${1:0}}', type: 'keyword' },
    { label: '{@max', detail: 'Maximum value', snippetTmpl: '{@max ${1:100}}', type: 'keyword' },
    {
      label: '{@format',
      detail: 'Input format',
      snippetTmpl: '{@format ${1:email}}',
      type: 'keyword',
    },
    {
      label: '{@pattern',
      detail: 'Regex pattern',
      snippetTmpl: '{@pattern ${1:^[a-z]+$$}}',
      type: 'keyword',
    },
    {
      label: '{@example',
      detail: 'Example value',
      snippetTmpl: '{@example ${1:value}}',
      type: 'keyword',
    },
    {
      label: '{@choice',
      detail: 'Allowed values',
      snippetTmpl: '{@choice ${1:a,b,c}}',
      type: 'keyword',
    },
    {
      label: '{@choice-from',
      detail: 'Dynamic values from tool',
      snippetTmpl: '{@choice-from ${1:toolName.field}}',
      type: 'keyword',
    },
    {
      label: '{@field',
      detail: 'HTML input type',
      snippetTmpl: '{@field ${1:textarea}}',
      type: 'keyword',
    },
    {
      label: '{@label',
      detail: 'Custom display label',
      snippetTmpl: '{@label ${1:Label}}',
      type: 'keyword',
    },
    {
      label: '{@default',
      detail: 'Default value',
      snippetTmpl: '{@default ${1:value}}',
      type: 'keyword',
    },
    {
      label: '{@placeholder',
      detail: 'Placeholder text',
      snippetTmpl: '{@placeholder ${1:Enter value...}}',
      type: 'keyword',
    },
    {
      label: '{@hint',
      detail: 'Help text',
      snippetTmpl: '{@hint ${1:Found in your dashboard}}',
      type: 'keyword',
    },
    {
      label: '{@readOnly',
      detail: 'Marks param as read-only',
      apply: '{@readOnly}',
      type: 'keyword',
    },
    {
      label: '{@writeOnly',
      detail: 'Marks param as write-only',
      apply: '{@writeOnly}',
      type: 'keyword',
    },
    {
      label: '{@unique',
      detail: 'Marks array items as unique',
      apply: '{@unique}',
      type: 'keyword',
    },
    {
      label: '{@multipleOf',
      detail: 'Numeric multiple constraint',
      snippetTmpl: '{@multipleOf ${1:5}}',
      type: 'keyword',
    },
    {
      label: '{@deprecated',
      detail: 'Marks parameter as deprecated',
      snippetTmpl: '{@deprecated ${1:Use newField instead}}',
      type: 'keyword',
    },
    {
      label: '{@accept',
      detail: 'File picker accept filter',
      snippetTmpl: '{@accept ${1:.ts,.js}}',
      type: 'keyword',
    },
  ];

  const allTags: TagDef[] = [...classLevelTags, ...methodLevelTags];

  return { allTags, inlineGeneralTags, inlineParamTags };
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
  const { allTags, inlineGeneralTags, inlineParamTags } = buildTags(runtimeVersion);

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
