/**
 * A2UI v0.9 Result Mapper
 *
 * Converts a Photon method's return value into a valid A2UI JSONL message
 * sequence (createSurface → updateComponents → updateDataModel). Mirrors
 * the auto-mapping heuristics used by @format table/list/card so photon
 * authors can add `@format a2ui` without writing any UI code.
 *
 * Escape hatch: returning `{ __a2ui: true, components, data }` bypasses
 * heuristics and emits the components verbatim.
 *
 * @see https://a2ui.org/specification/v0.9-a2ui/
 */

import { randomUUID } from 'crypto';
import {
  A2UI_VERSION,
  A2UI_BASIC_CATALOG,
  type A2UIComponent,
  type A2UIMessage,
  type A2UIEscapeHatch,
  isA2UIEscapeHatch,
} from './types.js';

export interface MapperOptions {
  surfaceId?: string;
  theme?: {
    primaryColor?: string;
    iconUrl?: string;
    agentDisplayName?: string;
  };
}

/** Wrapper keys that identify each A2UI message variant (see ./types.ts). */
const A2UI_MESSAGE_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'];

/**
 * Does the given array look like a pre-serialized A2UI JSONL stream that
 * should be forwarded verbatim instead of re-mapped? Every element must be
 * a well-formed A2UI message (has `version` AND one of the message wrapper
 * keys). Empty arrays are not streams — they're empty lists, and should go
 * through the mapper so the lifecycle messages are emitted.
 *
 * Extracted into the mapper module so CLI, AG-UI adapter, and future
 * transports share one classifier instead of drifting apart.
 */
export function looksLikeA2UIStream(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  return arr.every((m) => {
    if (typeof m !== 'object' || m === null) return false;
    const rec = m as Record<string, unknown>;
    if (typeof rec.version !== 'string') return false;
    // Must carry EXACTLY ONE wrapper key whose value is itself an object
    // with the surfaceId that A2UI messages always include. This rejects
    // row data that happens to carry both a `version` string and a key
    // named `updateDataModel` / similar as arbitrary column values.
    let wrapperCount = 0;
    for (const k of A2UI_MESSAGE_KEYS) {
      if (!(k in rec)) continue;
      wrapperCount++;
      const wrapped = rec[k];
      if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) return false;
      if (typeof (wrapped as Record<string, unknown>).surfaceId !== 'string') return false;
    }
    return wrapperCount === 1;
  });
}

/**
 * Translate a method result into the A2UI JSONL sequence.
 * Always returns at least three messages: createSurface, updateComponents,
 * updateDataModel. The component list always contains exactly one `root`.
 */
export function resultToA2UIMessages(result: unknown, options: MapperOptions = {}): A2UIMessage[] {
  const tree = buildTree(result);
  // Escape-hatch overrides win over caller options when both are present —
  // the escape hatch is the photon author's explicit intent, options are
  // the transport's defaults.
  const surfaceId = tree.surfaceId ?? options.surfaceId ?? `s-${randomUUID()}`;
  const theme = tree.theme ?? options.theme;

  const { components, data } = tree;
  assertSingleRoot(components);

  const messages: A2UIMessage[] = [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: A2UI_BASIC_CATALOG,
        ...(theme ? { theme } : {}),
      },
    },
    {
      version: A2UI_VERSION,
      updateComponents: { surfaceId, components },
    },
    {
      version: A2UI_VERSION,
      updateDataModel: { surfaceId, path: '/', value: data },
    },
  ];

  return messages;
}

// ════════════════════════════════════════════════════════════════════════════════
// TREE BUILDERS
// ════════════════════════════════════════════════════════════════════════════════

interface Tree {
  components: A2UIComponent[];
  data: unknown;
  /** Escape-hatch override for the createSurface surfaceId. */
  surfaceId?: string;
  /** Escape-hatch override for the createSurface theme. */
  theme?: MapperOptions['theme'];
}

function buildTree(result: unknown): Tree {
  if (isA2UIEscapeHatch(result)) {
    return buildFromEscapeHatch(result);
  }

  if (result === null || result === undefined) {
    return buildPrimitive('');
  }

  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return buildPrimitive(String(result));
  }

  if (Array.isArray(result)) {
    return buildList(result);
  }

  if (isCardShaped(result)) {
    return buildCard(result as CardShaped);
  }

  if (typeof result === 'object') {
    return buildKeyValueColumn(result as Record<string, unknown>);
  }

  // Functions, symbols, bigints — render their type rather than risk [object Object].
  return buildPrimitive(`<${typeof result}>`);
}

function buildFromEscapeHatch(hatch: A2UIEscapeHatch): Tree {
  if (!hatch.components.some((c) => c.id === 'root')) {
    throw new Error("A2UI escape hatch must include a component with id 'root'");
  }
  return {
    components: hatch.components,
    data: hatch.data ?? {},
    surfaceId: hatch.surfaceId,
    theme: hatch.theme,
  };
}

function buildPrimitive(value: string): Tree {
  return {
    components: [{ id: 'root', component: 'Text', text: value }],
    data: { value },
  };
}

function buildList(rows: unknown[]): Tree {
  if (rows.length === 0) {
    return buildPrimitive('(empty list)');
  }

  const firstRow = rows[0];
  if (firstRow === null || typeof firstRow !== 'object' || Array.isArray(firstRow)) {
    return buildPrimitiveList(rows);
  }

  const keys = Object.keys(firstRow as Record<string, unknown>);
  const titleKey = pickTitleKey(keys);

  const components: A2UIComponent[] = [
    {
      id: 'root',
      component: 'List',
      list: {
        template: { id: 'rowCard' },
        data: { path: '/items' },
      },
    },
    {
      id: 'rowCard',
      component: 'Card',
      child: 'rowText',
    },
    {
      id: 'rowText',
      component: 'Text',
      text: { path: titleKey },
    },
  ];

  return { components, data: { items: rows } };
}

function buildPrimitiveList(values: unknown[]): Tree {
  const items = values.map((v, i) => ({ label: String(v), index: i }));
  const components: A2UIComponent[] = [
    {
      id: 'root',
      component: 'List',
      list: {
        template: { id: 'rowCard' },
        data: { path: '/items' },
      },
    },
    { id: 'rowCard', component: 'Card', child: 'rowText' },
    { id: 'rowText', component: 'Text', text: { path: 'label' } },
  ];
  return { components, data: { items } };
}

interface CardShaped {
  title: string;
  description?: string;
  actions?: Array<{ label: string; name?: string }>;
}

/**
 * Does this object look like a Card result? Card layout renders only
 * `title` + optional `description` + optional `actions`; anything else
 * would silently be dropped. Require that there are no extra "data"
 * fields — a result like `{ title: 'prod-01', region: 'us-east', cpu: '42%' }`
 * should go through buildKeyValueColumn instead so every field renders.
 */
const CARD_KEYS = new Set(['title', 'description', 'actions']);
function isCardShaped(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.title !== 'string') return false;
  if (obj.actions !== undefined && !Array.isArray(obj.actions)) return false;
  // Reject objects that carry fields beyond the card schema — those are
  // data-bearing records, not cards.
  for (const key of Object.keys(obj)) {
    if (!CARD_KEYS.has(key)) return false;
  }
  return true;
}

function buildCard(card: CardShaped): Tree {
  const contentIds: string[] = ['cardTitle'];
  const components: A2UIComponent[] = [
    { id: 'root', component: 'Card', child: 'cardBody' },
    {
      id: 'cardTitle',
      component: 'Text',
      text: { path: '/title' },
      variant: 'h2',
    },
  ];

  if (card.description) {
    components.push({
      id: 'cardDesc',
      component: 'Text',
      text: { path: '/description' },
    });
    contentIds.push('cardDesc');
  }

  const actions = card.actions ?? [];
  actions.forEach((action, i) => {
    const btnId = `cardBtn${i}`;
    components.push({
      id: btnId,
      component: 'Button',
      text: action.label,
      variant: i === 0 ? 'primary' : 'borderless',
      action: {
        event: { name: action.name ?? action.label },
      },
    });
    contentIds.push(btnId);
  });

  components.push({
    id: 'cardBody',
    component: 'Column',
    children: contentIds,
  });

  return { components, data: card };
}

function buildKeyValueColumn(obj: Record<string, unknown>): Tree {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return buildPrimitive('(empty object)');
  }

  const childIds: string[] = [];
  const components: A2UIComponent[] = [];

  keys.forEach((key, i) => {
    const rowId = `row${i}`;
    // RFC 6901: encode ~ as ~0 and / as ~1 when a key is embedded in a JSON
    // Pointer. Order matters — ~0 first would double-encode / produced by ~1.
    const pointerKey = key.replace(/~/g, '~0').replace(/\//g, '~1');
    components.push({
      id: rowId,
      component: 'Text',
      text: {
        call: 'formatString',
        args: { value: `**${key}:** \${/${pointerKey}}` },
      },
    });
    childIds.push(rowId);
  });

  components.unshift({
    id: 'root',
    component: 'Column',
    children: childIds,
  });

  return { components, data: obj };
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function pickTitleKey(keys: string[]): string {
  const preferred = ['title', 'name', 'label', 'subject'];
  for (const p of preferred) {
    if (keys.includes(p)) return p;
  }
  return keys[0] ?? 'value';
}

function assertSingleRoot(components: A2UIComponent[]): void {
  const rootCount = components.filter((c) => c.id === 'root').length;
  if (rootCount !== 1) {
    throw new Error(`A2UI component tree must have exactly one 'root' component, got ${rootCount}`);
  }
}
