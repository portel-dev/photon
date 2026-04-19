/**
 * A2UI v0.9 Protocol Types
 *
 * Zero-dependency definitions for the A2UI v0.9 Draft wire format — a
 * declarative generative-UI protocol that rides on AG-UI transport.
 *
 * @see https://a2ui.org/specification/v0.9-a2ui/
 *
 * Scope: producer-side only. These types describe the JSON messages the
 * Photon runtime emits, not the full renderer contract.
 */

export const A2UI_VERSION = 'v0.9';
export const A2UI_BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

// ════════════════════════════════════════════════════════════════════════════════
// DYNAMIC VALUES (JSON Pointer bindings, function calls, literals)
// ════════════════════════════════════════════════════════════════════════════════

export interface A2UIPath {
  path: string;
}

export interface A2UIFunctionCall {
  call: string;
  args?: Record<string, unknown>;
}

export type DynamicString = string | A2UIPath | A2UIFunctionCall;
export type DynamicNumber = number | A2UIPath | A2UIFunctionCall;
export type DynamicBoolean = boolean | A2UIPath | A2UIFunctionCall;

// ════════════════════════════════════════════════════════════════════════════════
// COMPONENTS (flat adjacency list; exactly one must have id === 'root')
// ════════════════════════════════════════════════════════════════════════════════

export interface A2UIComponentBase {
  id: string;
  component: string;
}

export interface A2UIText extends A2UIComponentBase {
  component: 'Text';
  text: DynamicString;
  variant?: 'h1' | 'h2' | 'h3' | 'body' | 'caption';
}

export interface A2UIImage extends A2UIComponentBase {
  component: 'Image';
  url: DynamicString;
  alt?: DynamicString;
}

export interface A2UIDivider extends A2UIComponentBase {
  component: 'Divider';
}

export interface A2UIRow extends A2UIComponentBase {
  component: 'Row';
  children: string[];
}

export interface A2UIColumn extends A2UIComponentBase {
  component: 'Column';
  children: string[];
}

export interface A2UICard extends A2UIComponentBase {
  component: 'Card';
  child: string;
}

export interface A2UIListTemplate {
  template: { id: string };
  data: A2UIPath;
}

export interface A2UIList extends A2UIComponentBase {
  component: 'List';
  list: A2UIListTemplate;
}

export interface A2UIButton extends A2UIComponentBase {
  component: 'Button';
  text: DynamicString;
  variant?: 'primary' | 'borderless';
  action?: {
    event?: { name: string; context?: Record<string, unknown> };
    functionCall?: A2UIFunctionCall;
  };
}

export interface A2UITextField extends A2UIComponentBase {
  component: 'TextField';
  label?: DynamicString;
  value?: A2UIPath;
  checks?: Array<{ call: string; args?: Record<string, unknown>; message?: string }>;
}

export type A2UIComponent =
  | A2UIText
  | A2UIImage
  | A2UIDivider
  | A2UIRow
  | A2UIColumn
  | A2UICard
  | A2UIList
  | A2UIButton
  | A2UITextField;

// ════════════════════════════════════════════════════════════════════════════════
// MESSAGES (server → client JSONL stream)
// ════════════════════════════════════════════════════════════════════════════════

export interface CreateSurfaceMessage {
  version: typeof A2UI_VERSION;
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: {
      primaryColor?: string;
      iconUrl?: string;
      agentDisplayName?: string;
    };
    sendDataModel?: boolean;
  };
}

export interface UpdateComponentsMessage {
  version: typeof A2UI_VERSION;
  updateComponents: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface UpdateDataModelMessage {
  version: typeof A2UI_VERSION;
  updateDataModel: {
    surfaceId: string;
    path: string;
    value: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: typeof A2UI_VERSION;
  deleteSurface: { surfaceId: string };
}

export type A2UIMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

// ════════════════════════════════════════════════════════════════════════════════
// ESCAPE HATCH — power users return this shape to bypass auto-mapping
// ════════════════════════════════════════════════════════════════════════════════

export interface A2UIEscapeHatch {
  __a2ui: true;
  components: A2UIComponent[];
  data?: unknown;
  surfaceId?: string;
  theme?: CreateSurfaceMessage['createSurface']['theme'];
}

export function isA2UIEscapeHatch(value: unknown): value is A2UIEscapeHatch {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __a2ui?: unknown }).__a2ui === true &&
    Array.isArray((value as { components?: unknown }).components)
  );
}
