export interface PhotonDocblockTagDef {
  label: string;
  detail: string;
  info?: string;
  apply?: string;
  snippetTmpl?: string;
  type: 'keyword';
}

export interface PhotonDocblockTagCatalog {
  allTags: PhotonDocblockTagDef[];
  inlineGeneralTags: PhotonDocblockTagDef[];
  inlineParamTags: PhotonDocblockTagDef[];
}

export function buildPhotonDocblockTagCatalog(runtimeVersion: string): PhotonDocblockTagCatalog {
  const ver = runtimeVersion || '1.0.0';

  const classLevelTags: PhotonDocblockTagDef[] = [
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

  const methodLevelTags: PhotonDocblockTagDef[] = [
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

  const inlineGeneralTags: PhotonDocblockTagDef[] = [
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
    { label: '{@ms', detail: 'Timeout duration', snippetTmpl: '{@ms ${1:30s}}', type: 'keyword' },
    { label: '{@count', detail: 'Retry count', snippetTmpl: '{@count ${1:3}}', type: 'keyword' },
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

  const inlineParamTags: PhotonDocblockTagDef[] = [
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

  return {
    allTags: [...classLevelTags, ...methodLevelTags],
    inlineGeneralTags,
    inlineParamTags,
  };
}
