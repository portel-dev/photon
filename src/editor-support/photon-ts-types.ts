export interface PhotonTsDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: number;
}

export interface PhotonTsHover {
  from: number;
  to: number;
  kind: string;
  display: string;
  documentation?: string;
  tags?: Array<{ name: string; text?: string }>;
}

export interface PhotonTsDefinition {
  from: number;
  to: number;
  kind: 'source' | 'project' | 'virtual';
  filePath: string;
  targetFrom: number;
  targetTo: number;
  title: string;
  preview?: string;
}

export interface PhotonTsProjectFile {
  path: string;
  source: string;
}

export interface PhotonTsReferenceItem {
  kind: 'source' | 'project';
  filePath: string;
  from: number;
  to: number;
  line: number;
  column: number;
  preview: string;
}

export interface PhotonTsReferences {
  symbolName: string;
  items: PhotonTsReferenceItem[];
}

export interface PhotonTsRenamePlanFile {
  kind: 'source' | 'project';
  filePath: string;
  source: string;
  changeCount: number;
}

export interface PhotonTsRenamePlan {
  symbolName: string;
  nextName: string;
  files: PhotonTsRenamePlanFile[];
}

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

export interface PhotonTsOutlineItem {
  text: string;
  kind: string;
  from: number;
  to: number;
  level: number;
}
