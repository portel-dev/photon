import { useEffect, useState } from 'react';

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

function encodePointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
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
  const root = `/${encodePointerSegment(key)}`;
  return (
    patches
      ?.filter((patch) => patch.path === root || patch.path.startsWith(`${root}/`))
      .map((patch) => ({
        ...patch,
        path: patch.path === root ? '' : patch.path.slice(root.length),
      })) ?? []
  );
}

export function usePhotonState<T = unknown>(key: string, initialValue: T): T {
  const [state, setState] = useState<T>(() => {
    const existing = photonBridge()?.widgetState?.[key];
    return existing === undefined ? initialValue : (existing as T);
  });

  useEffect(() => {
    const bridge = photonBridge();
    if (!bridge?.onEmit) return;
    return bridge.onEmit((event) => {
      if (event.emit !== 'state-changed') return;
      const patches = patchesForKey(key, event.data?.patches);
      if (patches?.length) {
        setState(
          (current) => patches.reduce((value, patch) => applyPatch(value, patch), current) as T
        );
      } else if (event.data?.property === key && 'value' in event.data) {
        setState(event.data.value as T);
      }
    });
  }, [key]);

  return state;
}
