import type {
  PhotonTsCompletionKind,
  PhotonTsWorkerRequest,
  PhotonTsWorkerResponse,
} from './photon-ts-protocol.js';
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
} from './photon-ts-types.js';

export interface PhotonTsTransport {
  send(request: PhotonTsWorkerRequest): PhotonTsWorkerResponse | Promise<PhotonTsWorkerResponse>;
  dispose?(): void | Promise<void>;
}

export interface PhotonTsCompletionEntry {
  label: string;
  detail?: string;
  kind: PhotonTsCompletionKind;
}

type PhotonTsRequestPayload<TType extends PhotonTsWorkerRequest['type']> = Omit<
  Extract<PhotonTsWorkerRequest, { type: TType }>,
  'id'
>;

export class PhotonTsSession {
  private nextId = 1;

  constructor(private readonly transport: PhotonTsTransport) {}

  private async request<
    T,
    TType extends PhotonTsWorkerRequest['type'] = PhotonTsWorkerRequest['type'],
  >(payload: PhotonTsRequestPayload<TType>): Promise<T> {
    const response = await this.transport.send({
      id: this.nextId++,
      ...payload,
    } as PhotonTsWorkerRequest);

    if (!response.ok) {
      throw new Error(response.error);
    }

    return response.result as T;
  }

  sync(filePath: string, source: string, supportFiles: PhotonTsProjectFile[] = []): Promise<void> {
    return this.request<void, 'sync'>({ type: 'sync', filePath, source, supportFiles });
  }

  diagnostics(
    filePath: string,
    source: string,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsDiagnostic[]> {
    return this.request<{ diagnostics: PhotonTsDiagnostic[] }, 'diagnostics'>({
      type: 'diagnostics',
      filePath,
      source,
      supportFiles,
    }).then((r) => r.diagnostics);
  }

  hover(
    filePath: string,
    source: string,
    pos: number,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsHover | null> {
    return this.request<{ hover: PhotonTsHover | null }, 'hover'>({
      type: 'hover',
      filePath,
      source,
      pos,
      supportFiles,
    }).then((r) => r.hover);
  }

  definition(
    filePath: string,
    source: string,
    pos: number,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsDefinition | null> {
    return this.request<{ definition: PhotonTsDefinition | null }, 'definition'>({
      type: 'definition',
      filePath,
      source,
      pos,
      supportFiles,
    }).then((r) => r.definition);
  }

  references(
    filePath: string,
    source: string,
    pos: number,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsReferences | null> {
    return this.request<{ references: PhotonTsReferences | null }, 'references'>({
      type: 'references',
      filePath,
      source,
      pos,
      supportFiles,
    }).then((r) => r.references);
  }

  rename(
    filePath: string,
    source: string,
    pos: number,
    newName: string,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsRenamePlan | null> {
    return this.request<{ rename: PhotonTsRenamePlan | null }, 'rename'>({
      type: 'rename',
      filePath,
      source,
      pos,
      newName,
      supportFiles,
    }).then((r) => r.rename);
  }

  codeFixes(
    filePath: string,
    source: string,
    from: number,
    to: number,
    errorCode: number,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsCodeFix[]> {
    return this.request<{ fixes: PhotonTsCodeFix[] }, 'codeFixes'>({
      type: 'codeFixes',
      filePath,
      source,
      from,
      to,
      errorCode,
      supportFiles,
    }).then((r) => r.fixes);
  }

  signatureHelp(
    filePath: string,
    source: string,
    pos: number,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsSignatureHelp | null> {
    return this.request<{ signatureHelp: PhotonTsSignatureHelp | null }, 'signatureHelp'>({
      type: 'signatureHelp',
      filePath,
      source,
      pos,
      supportFiles,
    }).then((r) => r.signatureHelp);
  }

  outline(
    filePath: string,
    source: string,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsOutlineItem[]> {
    return this.request<{ outline: PhotonTsOutlineItem[] }, 'outline'>({
      type: 'outline',
      filePath,
      source,
      supportFiles,
    }).then((r) => r.outline);
  }

  completions(
    filePath: string,
    source: string,
    pos: number,
    explicit: boolean,
    supportFiles: PhotonTsProjectFile[] = []
  ): Promise<PhotonTsCompletionEntry[]> {
    return this.request<{ completions: PhotonTsCompletionEntry[] }, 'completions'>({
      type: 'completions',
      filePath,
      source,
      pos,
      explicit,
      supportFiles,
    }).then((r) => r.completions);
  }

  async destroy(): Promise<void> {
    await this.transport.dispose?.();
  }
}
