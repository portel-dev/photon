import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
export type {
  PhotonTsCodeFix,
  PhotonTsDefinition,
  PhotonTsDiagnostic,
  PhotonTsHover,
  PhotonTsOutlineItem,
  PhotonTsProjectFile,
  PhotonTsReferences,
  PhotonTsRenamePlan,
  PhotonTsSignatureHelp,
} from '../../../editor-support/photon-ts-types.js';
import {
  PhotonTsSession,
  type PhotonTsCompletionEntry,
} from '../../../editor-support/photon-ts-session.js';
import type {
  PhotonTsCodeFix,
  PhotonTsDefinition,
  PhotonTsDiagnostic,
  PhotonTsHover,
  PhotonTsOutlineItem,
  PhotonTsProjectFile,
  PhotonTsReferences,
  PhotonTsRenamePlan,
  PhotonTsSignatureHelp,
} from '../../../editor-support/photon-ts-types.js';
import type {
  PhotonTsWorkerRequest,
  PhotonTsWorkerResponse,
} from '../../../editor-support/photon-ts-protocol.js';

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
  private readonly session: PhotonTsSession;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason?: unknown) => void }
  >();

  constructor() {
    this.worker = new Worker('/beam-ts-worker.js', { type: 'module' });
    this.session = new PhotonTsSession({
      send: (request) => this.requestMessage(request),
      dispose: () => this.worker.terminate(),
    });
    this.worker.onmessage = (event: MessageEvent<PhotonTsWorkerResponse>) => {
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

  private requestMessage(
    message: Omit<PhotonTsWorkerRequest, 'id'>
  ): Promise<PhotonTsWorkerResponse> {
    const id = this.nextId++;
    return new Promise<PhotonTsWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...message });
    });
  }

  sync(filePath: string, source: string, supportFiles: PhotonTsProjectFile[] = []): Promise<void> {
    return this.session.sync(filePath, source, supportFiles);
  }

  diagnostics(filePath: string, source: string): Promise<PhotonTsDiagnostic[]> {
    return this.session.diagnostics(filePath, source);
  }

  hover(filePath: string, source: string, pos: number): Promise<PhotonTsHover | null> {
    return this.session.hover(filePath, source, pos);
  }

  definition(filePath: string, source: string, pos: number): Promise<PhotonTsDefinition | null> {
    return this.session.definition(filePath, source, pos);
  }

  references(filePath: string, source: string, pos: number): Promise<PhotonTsReferences | null> {
    return this.session.references(filePath, source, pos);
  }

  rename(
    filePath: string,
    source: string,
    pos: number,
    newName: string
  ): Promise<PhotonTsRenamePlan | null> {
    return this.session.rename(filePath, source, pos, newName);
  }

  codeFixes(
    filePath: string,
    source: string,
    from: number,
    to: number,
    errorCode: number
  ): Promise<PhotonTsCodeFix[]> {
    return this.session.codeFixes(filePath, source, from, to, errorCode);
  }

  signatureHelp(
    filePath: string,
    source: string,
    pos: number
  ): Promise<PhotonTsSignatureHelp | null> {
    return this.session.signatureHelp(filePath, source, pos);
  }

  outline(filePath: string, source: string): Promise<PhotonTsOutlineItem[]> {
    return this.session.outline(filePath, source);
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

    const result = await this.session.completions(filePath, source, context.pos, context.explicit);

    if (!result.length) return null;

    return {
      from,
      options: result.map((entry: PhotonTsCompletionEntry) => ({
        label: entry.label,
        detail: entry.detail,
        type: entry.kind as Completion['type'],
      })),
      validFor: /^[A-Za-z_$][\w$]*$/,
    };
  }

  destroy(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('TypeScript worker disposed'));
    }
    this.pending.clear();
    void this.session.destroy();
  }
}
