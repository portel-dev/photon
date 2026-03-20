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

export type PhotonTsCompletionKind =
  | 'function'
  | 'method'
  | 'property'
  | 'class'
  | 'variable'
  | 'keyword'
  | 'text';

export type PhotonTsWorkerRequest =
  | {
      id: number;
      type: 'sync';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
    }
  | {
      id: number;
      type: 'completions';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      pos: number;
      explicit: boolean;
    }
  | {
      id: number;
      type: 'diagnostics';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
    }
  | {
      id: number;
      type: 'hover';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      pos: number;
    }
  | {
      id: number;
      type: 'definition';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      pos: number;
    }
  | {
      id: number;
      type: 'references';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      pos: number;
    }
  | {
      id: number;
      type: 'rename';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      pos: number;
      newName: string;
    }
  | {
      id: number;
      type: 'codeFixes';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      from: number;
      to: number;
      errorCode: number;
    }
  | {
      id: number;
      type: 'signatureHelp';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
      pos: number;
    }
  | {
      id: number;
      type: 'outline';
      filePath: string;
      source: string;
      supportFiles?: PhotonTsProjectFile[];
    };

export type PhotonTsWorkerResponse =
  | { id: number; ok: true; result: null }
  | {
      id: number;
      ok: true;
      result: {
        completions: Array<{
          label: string;
          detail?: string;
          kind: PhotonTsCompletionKind;
        }>;
      };
    }
  | { id: number; ok: true; result: { diagnostics: PhotonTsDiagnostic[] } }
  | { id: number; ok: true; result: { hover: PhotonTsHover | null } }
  | { id: number; ok: true; result: { definition: PhotonTsDefinition | null } }
  | { id: number; ok: true; result: { references: PhotonTsReferences | null } }
  | { id: number; ok: true; result: { rename: PhotonTsRenamePlan | null } }
  | { id: number; ok: true; result: { fixes: PhotonTsCodeFix[] } }
  | { id: number; ok: true; result: { signatureHelp: PhotonTsSignatureHelp | null } }
  | { id: number; ok: true; result: { outline: PhotonTsOutlineItem[] } }
  | { id: number; ok: false; error: string };
