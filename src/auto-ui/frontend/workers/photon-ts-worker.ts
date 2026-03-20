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
    }
  | {
      id: number;
      type: 'completions';
      filePath: string;
      source: string;
      pos: number;
      explicit: boolean;
    }
  | {
      id: number;
      type: 'diagnostics';
      filePath: string;
      source: string;
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
  getScriptFileNames: () => [STUB_LIB_PATH, currentFilePath],
  getScriptVersion: () => String(version),
  getScriptSnapshot: (fileName) => {
    if (fileName === STUB_LIB_PATH) return ts.ScriptSnapshot.fromString(PHOTON_RUNTIME_LIB);
    if (normalizePath(fileName) === normalizePath(currentFilePath)) {
      return ts.ScriptSnapshot.fromString(shadow.content);
    }
    return undefined;
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
    fileName === STUB_LIB_PATH || normalizePath(fileName) === normalizePath(currentFilePath),
  readFile: (fileName) => {
    if (fileName === STUB_LIB_PATH) return PHOTON_RUNTIME_LIB;
    if (normalizePath(fileName) === normalizePath(currentFilePath)) return shadow.content;
    return undefined;
  },
  readDirectory: () => [],
  directoryExists: (dirName) =>
    dirName === '/' ||
    dirName === '/__photon__' ||
    normalizePath(currentFilePath).startsWith(normalizePath(dirName)),
});

function syncDocument(filePath: string, source: string): void {
  currentFilePath = normalizePath(filePath || VIRTUAL_SOURCE_PATH);
  currentSource = source;
  shadow = buildShadowSource(source);
  version++;
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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    syncDocument(msg.filePath, msg.source);

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
