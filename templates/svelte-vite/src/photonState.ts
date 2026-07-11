import { readable } from 'svelte/store';

type JsonPatch = { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown };
type StateChangedEvent = {
  emit?: string;
  data?: { patches?: JsonPatch[]; property?: string; value?: unknown };
};
type PhotonBridge = {
  onEmit?: (cb: (event: StateChangedEvent) => void) => () => void;
  widgetState?: Record<string, unknown>;
};

function photonBridge(): PhotonBridge | undefined {
  return (window as typeof window & { photon?: PhotonBridge }).photon;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodePointer(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function applyPatch(current: unknown, patch: JsonPatch): unknown {
  const next = clone(current ?? {});
  const parts = decodePointer(patch.path);
  if (parts.length === 0) return patch.op === 'remove' ? undefined : patch.value;

  let target: any = next;
  for (const part of parts.slice(0, -1)) {
    if (target[part] === undefined || target[part] === null) target[part] = {};
    target = target[part];
  }

  const key = parts[parts.length - 1];
  if (Array.isArray(target)) {
    const index = key === '-' ? target.length : Number(key);
    if (patch.op === 'remove') target.splice(index, 1);
    else if (patch.op === 'add') target.splice(index, 0, patch.value);
    else target[index] = patch.value;
    return next;
  }

  if (patch.op === 'remove') delete target[key];
  else target[key] = patch.value;
  return next;
}

function patchesForKey(key: string, patches?: JsonPatch[]): JsonPatch[] {
  return (
    patches
      ?.filter((patch) => patch.path === `/${key}` || patch.path.startsWith(`/${key}/`))
      .map((patch) => ({
        ...patch,
        path: patch.path === `/${key}` ? '' : patch.path.slice(key.length + 1),
      })) ?? []
  );
}

export function photonState<T = unknown>(key: string, initialValue: T) {
  const existing = photonBridge()?.widgetState?.[key];
  return readable<T>((existing === undefined ? initialValue : existing) as T, (set, update) => {
    const unsubscribe = photonBridge()?.onEmit?.((event) => {
      if (event.emit !== 'state-changed') return;
      const patches = patchesForKey(key, event.data?.patches);
      if (patches?.length) {
        update(
          (current) => patches.reduce((value, patch) => applyPatch(value, patch), current) as T
        );
      } else if (event.data?.property === key && 'value' in event.data) {
        set(event.data.value as T);
      }
    });
    return () => unsubscribe?.();
  });
}
