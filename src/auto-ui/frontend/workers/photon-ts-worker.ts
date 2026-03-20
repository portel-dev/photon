import ts from 'typescript';

type CompletionKind =
  | 'function'
  | 'method'
  | 'property'
  | 'class'
  | 'variable'
  | 'keyword'
  | 'text';
type DiagnosticSeverity = 'error' | 'warning' | 'info';

type WorkerRequest =
  | {
      id: number;
      type: 'sync';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
    }
  | {
      id: number;
      type: 'completions';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
      pos: number;
      explicit: boolean;
    }
  | {
      id: number;
      type: 'diagnostics';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
    }
  | {
      id: number;
      type: 'hover';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
      pos: number;
    }
  | {
      id: number;
      type: 'definition';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
      pos: number;
    }
  | {
      id: number;
      type: 'references';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
      pos: number;
    }
  | {
      id: number;
      type: 'rename';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
      pos: number;
      newName: string;
    }
  | {
      id: number;
      type: 'codeFixes';
      filePath: string;
      source: string;
      supportFiles?: Array<{ path: string; source: string }>;
      from: number;
      to: number;
      errorCode: number;
    };

type WorkerResponse =
  | { id: number; ok: true; result: null }
  | {
      id: number;
      ok: true;
      result: {
        completions: Array<{ label: string; detail?: string; kind: CompletionKind }>;
      };
    }
  | {
      id: number;
      ok: true;
      result: {
        diagnostics: Array<{
          from: number;
          to: number;
          message: string;
          severity: DiagnosticSeverity;
          code?: number;
        }>;
      };
    }
  | {
      id: number;
      ok: true;
      result: {
        hover: {
          from: number;
          to: number;
          kind: string;
          display: string;
          documentation?: string;
          tags?: Array<{ name: string; text?: string }>;
        } | null;
      };
    }
  | {
      id: number;
      ok: true;
      result: {
        definition: {
          from: number;
          to: number;
          kind: 'source' | 'project' | 'virtual';
          filePath: string;
          targetFrom: number;
          targetTo: number;
          title: string;
          preview?: string;
        } | null;
      };
    }
  | {
      id: number;
      ok: true;
      result: {
        references: {
          symbolName: string;
          items: Array<{
            kind: 'source' | 'project';
            filePath: string;
            from: number;
            to: number;
            line: number;
            column: number;
            preview: string;
          }>;
        } | null;
      };
    }
  | {
      id: number;
      ok: true;
      result: {
        rename: {
          symbolName: string;
          nextName: string;
          files: Array<{
            kind: 'source' | 'project';
            filePath: string;
            source: string;
            changeCount: number;
          }>;
        } | null;
      };
    }
  | {
      id: number;
      ok: true;
      result: {
        fixes: Array<{
          description: string;
          files: Array<{
            kind: 'source' | 'project';
            filePath: string;
            source: string;
            changeCount: number;
          }>;
        }>;
      };
    }
  | { id: number; ok: false; error: string };

interface ShadowTransform {
  content: string;
  insertionPos: number;
  delta: number;
}

const PHOTON_RUNTIME_LIB = `
type PropertyKey = string | number | symbol;
interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { length: number; [index: number]: any; }
interface String {}
interface Number {}
interface Boolean {}
interface RegExp {}
interface Array<T> { length: number; [n: number]: T; }
interface ReadonlyArray<T> { readonly length: number; [n: number]: T; }
interface PromiseLike<T> { then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2>; }
interface Promise<T> { then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>; catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult>; }
interface PromiseConstructor { new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>; resolve<T>(value: T | PromiseLike<T>): Promise<T>; reject(reason?: any): Promise<never>; }
declare const Promise: PromiseConstructor;
type Record<K extends PropertyKey, T> = { [P in K]: T };
type Partial<T> = { [P in keyof T]?: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Exclude<T, U> = T extends U ? never : T;
declare const console: { log(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void; };
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(handle?: number): void;
declare function fetch(input: any, init?: any): Promise<any>;
declare const Buffer: any;
declare const process: { env: Record<string, string | undefined> };
type BufferEncoding = 'utf8' | 'utf-8' | 'ascii' | 'base64' | 'hex' | 'latin1' | 'binary' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';

type MemoryScope = 'photon' | 'session' | 'global';
interface CallerInfo {
  id: string;
  name?: string;
  anonymous: boolean;
  scope?: string;
  claims?: Record<string, unknown>;
}

declare class MemoryProvider {
  sessionId?: string;
  get<T = any>(key: string, scope?: MemoryScope): Promise<T | null>;
  set<T = any>(key: string, value: T, scope?: MemoryScope): Promise<void>;
  delete(key: string, scope?: MemoryScope): Promise<boolean>;
  has(key: string, scope?: MemoryScope): Promise<boolean>;
  keys(scope?: MemoryScope): Promise<string[]>;
  clear(scope?: MemoryScope): Promise<void>;
  getAll<T = any>(scope?: MemoryScope): Promise<Record<string, T>>;
  update<T = any>(key: string, updater: (current: T | null) => T, scope?: MemoryScope): Promise<T>;
}

interface ScheduledTask {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'error';
}

interface CreateScheduleOptions {
  name: string;
  schedule: string;
  method: string;
  params?: Record<string, any>;
  description?: string;
  fireOnce?: boolean;
  maxExecutions?: number;
}

interface UpdateScheduleOptions {
  schedule?: string;
  method?: string;
  params?: Record<string, any>;
  description?: string;
  fireOnce?: boolean;
  maxExecutions?: number;
}

declare class ScheduleProvider {
  create(options: CreateScheduleOptions): Promise<ScheduledTask>;
  get(taskId: string): Promise<ScheduledTask | null>;
  getByName(name: string): Promise<ScheduledTask | null>;
  list(status?: 'active' | 'paused' | 'completed' | 'error'): Promise<ScheduledTask[]>;
  update(taskId: string, updates: UpdateScheduleOptions): Promise<ScheduledTask>;
  pause(taskId: string): Promise<ScheduledTask>;
  resume(taskId: string): Promise<ScheduledTask>;
  cancel(taskId: string): Promise<boolean>;
  cancelByName(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  cancelAll(): Promise<number>;
}

declare class Photon {
  get caller(): CallerInfo;
  get memory(): MemoryProvider;
  get schedule(): ScheduleProvider;
  protected storage(subpath: string): string;
  protected assets(subpath: string): string;
  protected assets(subpath: string, load: boolean): string | Buffer;
  protected assets(subpath: string, options: { load: true; encoding?: BufferEncoding | null }): string | Buffer;
  protected assetUrl(subpath: string): string;
  get photon(): { use(name: string, instance?: string): Promise<any> };
  protected emit(data: any): void;
  protected render(): void;
  protected render(format: string, value: any): void;
  protected call(target: string, params?: Record<string, any>, options?: { instance?: string }): Promise<any>;
  mcp(mcpName: string): Record<string, (params?: any) => Promise<any>> & {
    call(tool: string, params?: Record<string, any>): Promise<any>;
    list(): Promise<any[]>;
    find(query: string): Promise<any[]>;
  };
  hasMCPAccess(): boolean;
  listMCPServers(): Promise<string[]>;
  protected withLock<T>(lockName: string, fn: () => Promise<T>, timeout?: number): Promise<T>;
  protected acquireLock(lockName: string, callerId: string, timeout?: number): Promise<boolean>;
  protected transferLock(lockName: string, toCallerId: string, fromCallerId?: string): Promise<boolean>;
  protected releaseLock(lockName: string, callerId?: string): Promise<boolean>;
  protected getLock(lockName: string): Promise<{ holder: string | null; acquiredAt?: number; expiresAt?: number }>;
}
`;

const STUB_LIB_PATH = '/__photon__/photon-runtime-lib.d.ts';
const VIRTUAL_SOURCE_PATH = '/__photon__/current.photon.ts';

let currentSource = '';
let currentFilePath = VIRTUAL_SOURCE_PATH;
let shadow: ShadowTransform = { content: '', insertionPos: 0, delta: 0 };
let version = 0;
const projectFiles = new Map<string, { content: string; version: number }>();

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function buildShadowSource(source: string): ShadowTransform {
  const classMatch = source.match(
    /export\s+default\s+class\s+([A-Za-z_$][\w$]*)(\s+extends\s+[^{\n]+)?\s*\{/
  );
  if (!classMatch) return { content: source, insertionPos: source.length, delta: 0 };
  if (classMatch[2]) return { content: source, insertionPos: source.length, delta: 0 };

  const fullMatch = classMatch[0];
  const braceIndex = classMatch.index! + fullMatch.lastIndexOf('{');
  const content = `${source.slice(0, braceIndex).trimEnd()} extends Photon ${source.slice(braceIndex)}`;
  return {
    content,
    insertionPos: braceIndex,
    delta: ' extends Photon '.length,
  };
}

function sourceToShadowPos(pos: number): number {
  if (shadow.delta === 0) return pos;
  return pos > shadow.insertionPos ? pos + shadow.delta : pos;
}

function shadowToSourcePos(pos: number): number {
  if (shadow.delta === 0) return pos;
  return pos > shadow.insertionPos ? pos - shadow.delta : pos;
}

const languageService = ts.createLanguageService({
  getScriptFileNames: () => [STUB_LIB_PATH, currentFilePath, ...projectFiles.keys()],
  getScriptVersion: (fileName) => {
    if (fileName === STUB_LIB_PATH) return '1';
    if (normalizePath(fileName) === normalizePath(currentFilePath)) return String(version);
    return String(projectFiles.get(normalizePath(fileName))?.version ?? 0);
  },
  getScriptSnapshot: (fileName) => {
    if (fileName === STUB_LIB_PATH) return ts.ScriptSnapshot.fromString(PHOTON_RUNTIME_LIB);
    if (normalizePath(fileName) === normalizePath(currentFilePath)) {
      return ts.ScriptSnapshot.fromString(shadow.content);
    }
    const entry = projectFiles.get(normalizePath(fileName));
    return entry ? ts.ScriptSnapshot.fromString(entry.content) : undefined;
  },
  getCurrentDirectory: () => '/',
  getCompilationSettings: () => ({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noLib: true,
    noEmit: true,
    allowJs: false,
    skipLibCheck: true,
  }),
  getDefaultLibFileName: () => 'lib.d.ts',
  fileExists: (fileName) =>
    fileName === STUB_LIB_PATH ||
    normalizePath(fileName) === normalizePath(currentFilePath) ||
    projectFiles.has(normalizePath(fileName)),
  readFile: (fileName) => {
    if (fileName === STUB_LIB_PATH) return PHOTON_RUNTIME_LIB;
    if (normalizePath(fileName) === normalizePath(currentFilePath)) return shadow.content;
    const entry = projectFiles.get(normalizePath(fileName));
    if (entry) return entry.content;
    return undefined;
  },
  readDirectory: () => [],
  directoryExists: (dirName) =>
    dirName === '/' ||
    dirName === '/__photon__' ||
    normalizePath(currentFilePath).startsWith(normalizePath(dirName)) ||
    Array.from(projectFiles.keys()).some((fileName) =>
      normalizePath(fileName).startsWith(normalizePath(dirName))
    ),
});

function syncDocument(
  filePath: string,
  source: string,
  supportFiles?: Array<{ path: string; source: string }>
): void {
  currentFilePath = normalizePath(filePath || VIRTUAL_SOURCE_PATH);
  currentSource = source;
  shadow = buildShadowSource(source);
  version++;
  if (!supportFiles) return;
  const nextFiles = new Set<string>();
  for (const supportFile of supportFiles) {
    const normalizedPath = normalizePath(supportFile.path);
    if (!normalizedPath || normalizedPath === currentFilePath) continue;
    nextFiles.add(normalizedPath);
    const existing = projectFiles.get(normalizedPath);
    if (existing?.content === supportFile.source) continue;
    projectFiles.set(normalizedPath, {
      content: supportFile.source,
      version: (existing?.version ?? 0) + 1,
    });
  }
  for (const existingPath of Array.from(projectFiles.keys())) {
    if (!nextFiles.has(existingPath)) {
      projectFiles.delete(existingPath);
    }
  }
}

function mapKind(kind: string): CompletionKind {
  const kindMap: Record<string, CompletionKind> = {
    [ts.ScriptElementKind.functionElement]: 'function',
    [ts.ScriptElementKind.memberFunctionElement]: 'method',
    [ts.ScriptElementKind.constructSignatureElement]: 'method',
    [ts.ScriptElementKind.memberVariableElement]: 'property',
    [ts.ScriptElementKind.memberGetAccessorElement]: 'property',
    [ts.ScriptElementKind.memberSetAccessorElement]: 'property',
    [ts.ScriptElementKind.classElement]: 'class',
    [ts.ScriptElementKind.variableElement]: 'variable',
    [ts.ScriptElementKind.keyword]: 'keyword',
  };
  return kindMap[kind] ?? 'text';
}

function mapSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Warning:
      return 'warning';
    case ts.DiagnosticCategory.Message:
    case ts.DiagnosticCategory.Suggestion:
      return 'info';
    default:
      return 'error';
  }
}

const IGNORED_DIAGNOSTIC_CODES = new Set([
  2584, // cannot find name 'console' etc — covered selectively, but ignore misses
  2304, // cannot find name ...
  2318, // cannot find global type ...
]);

function getDiagnostics() {
  const diagnostics = [
    ...languageService.getSyntacticDiagnostics(currentFilePath),
    ...languageService.getSemanticDiagnostics(currentFilePath),
  ];

  return diagnostics
    .filter((diag) => !IGNORED_DIAGNOSTIC_CODES.has(diag.code))
    .map((diag) => ({
      from: shadowToSourcePos(diag.start ?? 0),
      to: shadowToSourcePos((diag.start ?? 0) + (diag.length ?? 0)),
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      severity: mapSeverity(diag.category),
      code: diag.code,
    }));
}

function getCompletions(pos: number, explicit: boolean) {
  const shadowPos = sourceToShadowPos(pos);
  const completions = languageService.getCompletionsAtPosition(currentFilePath, shadowPos, {
    includeCompletionsForModuleExports: true,
    includeCompletionsWithInsertText: true,
    includeAutomaticOptionalChainCompletions: true,
    triggerCharacter: explicit ? undefined : currentSource[pos - 1],
  });

  if (!completions) return [];

  return completions.entries.slice(0, 80).map((entry) => ({
    label: entry.name,
    detail: entry.kindModifiers || entry.kind,
    kind: mapKind(entry.kind),
  }));
}

function flattenParts(parts: readonly ts.SymbolDisplayPart[] | undefined): string {
  return parts ? ts.displayPartsToString(parts).trim() : '';
}

function getHover(pos: number) {
  const shadowPos = sourceToShadowPos(pos);
  const info =
    languageService.getQuickInfoAtPosition(currentFilePath, shadowPos) ||
    (shadowPos > 0
      ? languageService.getQuickInfoAtPosition(currentFilePath, shadowPos - 1)
      : undefined);

  if (!info) return null;

  const display = flattenParts(info.displayParts);
  const documentation = flattenParts(info.documentation);
  const tags = (info.tags || []).map((tag) => ({
    name: tag.name,
    text: flattenParts(tag.text) || undefined,
  }));

  return {
    from: shadowToSourcePos(info.textSpan.start),
    to: shadowToSourcePos(info.textSpan.start + info.textSpan.length),
    kind: info.kind,
    display,
    documentation: documentation || undefined,
    tags: tags.length > 0 ? tags : undefined,
  };
}

function buildPreview(content: string, start: number, length: number): string {
  const lines = content.split('\n');
  let cursor = 0;
  let startLine = 0;
  let endLine = lines.length - 1;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1;
    if (start >= cursor && start < cursor + lineLength) {
      startLine = i;
    }
    if (start + length >= cursor && start + length <= cursor + lineLength) {
      endLine = i;
      break;
    }
    cursor += lineLength;
  }

  const fromLine = Math.max(0, startLine - 1);
  const toLine = Math.min(lines.length - 1, endLine + 2);
  return lines
    .slice(fromLine, toLine + 1)
    .join('\n')
    .trim();
}

function getFileContent(filePath: string): string | null {
  if (filePath === STUB_LIB_PATH) return PHOTON_RUNTIME_LIB;
  if (normalizePath(filePath) === normalizePath(currentFilePath)) return currentSource;
  return projectFiles.get(normalizePath(filePath))?.content || null;
}

function getLineInfo(
  content: string,
  start: number
): { line: number; column: number; preview: string } {
  const lines = content.split('\n');
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineEnd = cursor + lineText.length;
    if (start <= lineEnd) {
      return {
        line: i + 1,
        column: start - cursor + 1,
        preview: lineText.trim(),
      };
    }
    cursor = lineEnd + 1;
  }
  return { line: lines.length, column: 1, preview: lines[lines.length - 1]?.trim() || '' };
}

function normalizeIdentifierSpan(
  source: string,
  start: number,
  end: number
): { start: number; end: number } {
  let normalizedStart = Math.max(0, start);
  let normalizedEnd = Math.max(normalizedStart, end);

  while (normalizedStart > 0 && /[A-Za-z0-9_$]/.test(source[normalizedStart - 1] || '')) {
    normalizedStart--;
  }
  while (normalizedEnd < source.length && /[A-Za-z0-9_$]/.test(source[normalizedEnd] || '')) {
    normalizedEnd++;
  }

  return { start: normalizedStart, end: normalizedEnd };
}

function refineSpanToName(
  source: string,
  start: number,
  end: number,
  name: string | undefined
): { start: number; end: number } {
  const normalized = normalizeIdentifierSpan(source, start, end);
  if (!name) return normalized;

  const windowStart = Math.max(0, normalized.start - 24);
  const windowEnd = Math.min(source.length, normalized.end + 24);
  const windowText = source.slice(windowStart, windowEnd);
  const nameIndex = windowText.indexOf(name);

  if (nameIndex === -1) return normalized;

  const refinedStart = windowStart + nameIndex;
  return {
    start: refinedStart,
    end: refinedStart + name.length,
  };
}

function trimToIdentifierSpan(
  source: string,
  start: number,
  end: number
): { start: number; end: number } {
  let nextStart = Math.max(0, start);
  let nextEnd = Math.max(nextStart, end);

  while (nextStart < source.length && !/[A-Za-z0-9_$]/.test(source[nextStart] || '')) {
    nextStart++;
  }
  while (nextEnd > nextStart && !/[A-Za-z0-9_$]/.test(source[nextEnd - 1] || '')) {
    nextEnd--;
  }

  return normalizeIdentifierSpan(source, nextStart, nextEnd);
}

function getDefinition(pos: number) {
  const shadowPos = sourceToShadowPos(pos);
  const definitionInfo =
    languageService.getDefinitionAndBoundSpan(currentFilePath, shadowPos) ||
    (shadowPos > 0
      ? languageService.getDefinitionAndBoundSpan(currentFilePath, shadowPos - 1)
      : undefined);

  if (!definitionInfo || definitionInfo.definitions.length === 0) return null;

  const definition =
    definitionInfo.definitions.find(
      (entry) => normalizePath(entry.fileName) === normalizePath(currentFilePath)
    ) || definitionInfo.definitions[0];

  const originFrom = shadowToSourcePos(definitionInfo.textSpan.start);
  const originTo = shadowToSourcePos(
    definitionInfo.textSpan.start + definitionInfo.textSpan.length
  );

  if (normalizePath(definition.fileName) === normalizePath(currentFilePath)) {
    const targetStart = shadowToSourcePos(definition.textSpan.start);
    const targetEnd = shadowToSourcePos(definition.textSpan.start + definition.textSpan.length);
    const targetSpan = refineSpanToName(currentSource, targetStart, targetEnd, definition.name);
    return {
      from: originFrom,
      to: originTo,
      kind: 'source' as const,
      filePath: currentFilePath,
      targetFrom: targetSpan.start,
      targetTo: targetSpan.end,
      title: definition.name || 'Current photon',
    };
  }

  const normalizedDefinitionPath = normalizePath(definition.fileName);
  const previewSource =
    definition.fileName === STUB_LIB_PATH
      ? PHOTON_RUNTIME_LIB
      : projectFiles.get(normalizedDefinitionPath)?.content || '';
  return {
    from: originFrom,
    to: originTo,
    kind: definition.fileName === STUB_LIB_PATH ? ('virtual' as const) : ('project' as const),
    filePath: definition.fileName,
    targetFrom: definition.textSpan.start,
    targetTo: definition.textSpan.start + definition.textSpan.length,
    title: definition.name || definition.fileName.split('/').pop() || 'Definition',
    preview:
      previewSource && definition.textSpan
        ? buildPreview(previewSource, definition.textSpan.start, definition.textSpan.length)
        : undefined,
  };
}

function getReferences(pos: number) {
  const shadowPos = sourceToShadowPos(pos);
  const results =
    languageService.findReferences(currentFilePath, shadowPos) ||
    (shadowPos > 0 ? languageService.findReferences(currentFilePath, shadowPos - 1) : undefined);

  if (!results || results.length === 0) return null;

  const symbolName = results[0]?.definition?.name || 'Symbol';
  const items: Array<{
    kind: 'source' | 'project';
    filePath: string;
    from: number;
    to: number;
    line: number;
    column: number;
    preview: string;
  }> = [];

  for (const result of results) {
    for (const ref of result.references) {
      if (ref.isDefinition) continue;
      if (normalizePath(ref.fileName) === normalizePath(STUB_LIB_PATH)) continue;

      const content = getFileContent(ref.fileName);
      if (!content) continue;

      const isCurrent = normalizePath(ref.fileName) === normalizePath(currentFilePath);
      const start = isCurrent ? shadowToSourcePos(ref.textSpan.start) : ref.textSpan.start;
      const end = isCurrent
        ? shadowToSourcePos(ref.textSpan.start + ref.textSpan.length)
        : ref.textSpan.start + ref.textSpan.length;
      const lineInfo = getLineInfo(content, start);

      items.push({
        kind: isCurrent ? 'source' : 'project',
        filePath: ref.fileName,
        from: start,
        to: end,
        line: lineInfo.line,
        column: lineInfo.column,
        preview: lineInfo.preview,
      });
    }
  }

  return { symbolName, items };
}

function applyTextChanges(
  content: string,
  changes: Array<{ start: number; end: number; newText: string }>
): string {
  const sorted = [...changes].sort((a, b) => b.start - a.start);
  let next = content;
  for (const change of sorted) {
    next = next.slice(0, change.start) + change.newText + next.slice(change.end);
  }
  return next;
}

function getRenamePlan(pos: number, newName: string) {
  const shadowPos = sourceToShadowPos(pos);
  const renameInfo =
    languageService.getRenameInfo(currentFilePath, shadowPos, {
      allowRenameOfImportPath: false,
    }) ||
    (shadowPos > 0
      ? languageService.getRenameInfo(currentFilePath, shadowPos - 1, {
          allowRenameOfImportPath: false,
        })
      : undefined);

  if (!renameInfo || !renameInfo.canRename) {
    throw new Error(renameInfo?.localizedErrorMessage || 'This symbol cannot be renamed');
  }

  const locations =
    languageService.findRenameLocations(currentFilePath, shadowPos, false, false, false) ||
    (shadowPos > 0
      ? languageService.findRenameLocations(currentFilePath, shadowPos - 1, false, false, false)
      : undefined) ||
    [];

  if (locations.length === 0) return null;

  const grouped = new Map<string, Array<{ start: number; end: number; newText: string }>>();
  for (const location of locations) {
    if (normalizePath(location.fileName) === normalizePath(STUB_LIB_PATH)) continue;
    const isCurrent = normalizePath(location.fileName) === normalizePath(currentFilePath);
    const rawStart = isCurrent
      ? shadowToSourcePos(location.textSpan.start)
      : location.textSpan.start;
    const rawEnd = isCurrent
      ? shadowToSourcePos(location.textSpan.start + location.textSpan.length)
      : location.textSpan.start + location.textSpan.length;
    const fileContent = isCurrent ? currentSource : getFileContent(location.fileName) || '';
    const trimmed = trimToIdentifierSpan(fileContent, rawStart, rawEnd);
    const fileKey = normalizePath(location.fileName);
    const list = grouped.get(fileKey) || [];
    list.push({ start: trimmed.start, end: trimmed.end, newText: newName });
    grouped.set(fileKey, list);
  }

  const files = Array.from(grouped.entries()).map(([filePath, changes]) => {
    const isCurrent = normalizePath(filePath) === normalizePath(currentFilePath);
    const content = isCurrent ? currentSource : getFileContent(filePath) || '';
    return {
      kind: isCurrent ? ('source' as const) : ('project' as const),
      filePath,
      source: applyTextChanges(content, changes),
      changeCount: changes.length,
    };
  });

  return {
    symbolName: renameInfo.displayName || renameInfo.fullDisplayName || 'Symbol',
    nextName: newName,
    files,
  };
}

function getCodeFixes(from: number, to: number, errorCode: number) {
  const shadowFrom = sourceToShadowPos(from);
  const shadowTo = sourceToShadowPos(to);
  const fixes = languageService.getCodeFixesAtPosition(
    currentFilePath,
    shadowFrom,
    shadowTo,
    [errorCode],
    {},
    {}
  );

  return fixes
    .map((fix) => {
      const grouped = new Map<string, Array<{ start: number; end: number; newText: string }>>();

      for (const change of fix.changes) {
        if (normalizePath(change.fileName) === normalizePath(STUB_LIB_PATH)) continue;
        const fileKey = normalizePath(change.fileName);
        const list = grouped.get(fileKey) || [];

        for (const textChange of change.textChanges) {
          const isCurrent = fileKey === normalizePath(currentFilePath);
          const start = isCurrent
            ? shadowToSourcePos(textChange.span.start)
            : textChange.span.start;
          const end = isCurrent
            ? shadowToSourcePos(textChange.span.start + textChange.span.length)
            : textChange.span.start + textChange.span.length;
          list.push({ start, end, newText: textChange.newText });
        }

        grouped.set(fileKey, list);
      }

      const files = Array.from(grouped.entries())
        .map(([filePath, changes]) => {
          const isCurrent = normalizePath(filePath) === normalizePath(currentFilePath);
          const content = isCurrent ? currentSource : getFileContent(filePath) || '';
          if (!content) return null;

          return {
            kind: isCurrent ? ('source' as const) : ('project' as const),
            filePath,
            source: applyTextChanges(content, changes),
            changeCount: changes.length,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (files.length === 0) return null;

      return {
        description: fix.description,
        files,
      };
    })
    .filter((fix): fix is NonNullable<typeof fix> => fix !== null);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    syncDocument(msg.filePath, msg.source, msg.supportFiles);

    let response: WorkerResponse;
    if (msg.type === 'sync') {
      response = { id: msg.id, ok: true, result: null };
    } else if (msg.type === 'diagnostics') {
      response = {
        id: msg.id,
        ok: true,
        result: {
          diagnostics: getDiagnostics(),
        },
      };
    } else if (msg.type === 'hover') {
      response = {
        id: msg.id,
        ok: true,
        result: {
          hover: getHover(msg.pos),
        },
      };
    } else if (msg.type === 'definition') {
      response = {
        id: msg.id,
        ok: true,
        result: {
          definition: getDefinition(msg.pos),
        },
      };
    } else if (msg.type === 'references') {
      response = {
        id: msg.id,
        ok: true,
        result: {
          references: getReferences(msg.pos),
        },
      };
    } else if (msg.type === 'rename') {
      response = {
        id: msg.id,
        ok: true,
        result: {
          rename: getRenamePlan(msg.pos, msg.newName),
        },
      };
    } else if (msg.type === 'codeFixes') {
      response = {
        id: msg.id,
        ok: true,
        result: {
          fixes: getCodeFixes(msg.from, msg.to, msg.errorCode),
        },
      };
    } else {
      response = {
        id: msg.id,
        ok: true,
        result: {
          completions: getCompletions(msg.pos, msg.explicit),
        },
      };
    }

    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
