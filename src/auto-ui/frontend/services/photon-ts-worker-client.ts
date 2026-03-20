import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
export type {
  PhotonTsDefinition,
  PhotonTsDiagnostic,
  PhotonTsHover,
  PhotonTsProjectFile,
  PhotonTsReferences,
  PhotonTsRenamePlan,
} from '../../../editor-support/photon-ts-types.js';
import type {
  PhotonTsDefinition,
  PhotonTsDiagnostic,
  PhotonTsHover,
  PhotonTsProjectFile,
  PhotonTsReferences,
  PhotonTsRenamePlan,
} from '../../../editor-support/photon-ts-types.js';

export interface PhotonTsCodeFixFile {
  kind: 'source' | 'project';
  filePath: string;
  source: string;
  changeCount: number;
}

export interface PhotonTsCodeFix {
  description: string;
  files: PhotonTsCodeFixFile[];
}

export interface PhotonTsSignatureHelp {
  items: Array<{
    prefix: string;
    suffix: string;
    separator: string;
    parameters: Array<{ text: string; documentation?: string }>;
    documentation?: string;
  }>;
  activeItem: number;
  activeParameter: number;
}

interface WorkerSuccess<T> {
  id: number;
  ok: true;
  result: T;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse<T> = WorkerSuccess<T> | WorkerFailure;

export class PhotonTsWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason?: unknown) => void }
  >();

  constructor() {
    this.worker = new Worker('/beam-ts-worker.js', { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse<any>>) => {
      const msg = event.data;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(msg.error));
      }
    };
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...payload });
    });
  }

  sync(filePath: string, source: string, supportFiles: PhotonTsProjectFile[] = []): Promise<void> {
    return this.request<void>({ type: 'sync', filePath, source, supportFiles });
  }

  diagnostics(filePath: string, source: string): Promise<PhotonTsDiagnostic[]> {
    return this.request<{ diagnostics: PhotonTsDiagnostic[] }>({
      type: 'diagnostics',
      filePath,
      source,
    }).then((r) => r.diagnostics);
  }

  hover(filePath: string, source: string, pos: number): Promise<PhotonTsHover | null> {
    return this.request<{ hover: PhotonTsHover | null }>({
      type: 'hover',
      filePath,
      source,
      pos,
    }).then((r) => r.hover);
  }

  definition(filePath: string, source: string, pos: number): Promise<PhotonTsDefinition | null> {
    return this.request<{ definition: PhotonTsDefinition | null }>({
      type: 'definition',
      filePath,
      source,
      pos,
    }).then((r) => r.definition);
  }

  references(filePath: string, source: string, pos: number): Promise<PhotonTsReferences | null> {
    return this.request<{ references: PhotonTsReferences | null }>({
      type: 'references',
      filePath,
      source,
      pos,
    }).then((r) => r.references);
  }

  rename(
    filePath: string,
    source: string,
    pos: number,
    newName: string
  ): Promise<PhotonTsRenamePlan | null> {
    return this.request<{ rename: PhotonTsRenamePlan | null }>({
      type: 'rename',
      filePath,
      source,
      pos,
      newName,
    }).then((r) => r.rename);
  }

  codeFixes(
    filePath: string,
    source: string,
    from: number,
    to: number,
    errorCode: number
  ): Promise<PhotonTsCodeFix[]> {
    return this.request<{ fixes: PhotonTsCodeFix[] }>({
      type: 'codeFixes',
      filePath,
      source,
      from,
      to,
      errorCode,
    }).then((r) => r.fixes);
  }

  signatureHelp(
    filePath: string,
    source: string,
    pos: number
  ): Promise<PhotonTsSignatureHelp | null> {
    return this.request<{ signatureHelp: PhotonTsSignatureHelp | null }>({
      type: 'signatureHelp',
      filePath,
      source,
      pos,
    }).then((r) => r.signatureHelp);
  }

  async completions(
    filePath: string,
    source: string,
    context: CompletionContext
  ): Promise<CompletionResult | null> {
    const before = context.state.sliceDoc(Math.max(0, context.pos - 64), context.pos);
    const hasMeaningfulTrigger =
      context.explicit || /[.\w$]$/.test(before) || before.endsWith('this.');

    if (!hasMeaningfulTrigger) return null;

    const word = context.matchBefore(/[A-Za-z_$][\w$]*/);
    const from = word ? word.from : context.pos;

    const result = await this.request<{
      completions: Array<{ label: string; detail?: string; kind: Completion['type'] }>;
    }>({
      type: 'completions',
      filePath,
      source,
      pos: context.pos,
      explicit: context.explicit,
    });

    if (!result.completions.length) return null;

    return {
      from,
      options: result.completions.map((entry) => ({
        label: entry.label,
        detail: entry.detail,
        type: entry.kind,
      })),
      validFor: /^[A-Za-z_$][\w$]*$/,
    };
  }

  destroy(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('TypeScript worker disposed'));
    }
    this.pending.clear();
    this.worker.terminate();
  }
}
