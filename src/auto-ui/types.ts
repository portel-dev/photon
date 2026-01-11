/**
 * Type definitions for Auto-UI system
 */

export type UIHint = 
  | 'table'
  | 'tree'
  | 'list'
  | 'card'
  | 'form'
  | 'json'
  | 'text'
  | 'markdown'
  | 'code'
  | 'progress'
  | 'chart';

export type ProgressType = 'spinner' | 'percentage' | 'steps';

export interface UIMetadata {
  hint?: UIHint;
  title?: string;
  description?: string;
  columns?: string[];
  expandable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  paginated?: boolean;
  theme?: string;
  customCSS?: string;
}

export interface ProgressState {
  type: ProgressType;
  current?: number;
  total?: number;
  message?: string;
  step?: number;
  totalSteps?: number;
}

export interface RenderContext {
  format: 'cli' | 'mcp' | 'web';
  theme?: string;
  width?: number;
  height?: number;
  interactive?: boolean;
}

export interface ComponentProps {
  data: any;
  metadata: UIMetadata;
  context: RenderContext;
}

export interface UIComponent {
  render(props: ComponentProps): string | object;
  supportsFormat(format: 'cli' | 'mcp' | 'web'): boolean;
}
