import { getRequestContext } from './telemetry/context.js';

export interface PhotonAppContext {
  navigation?: {
    photon?: string;
    method?: string;
    instance?: string;
    view?: string;
  };
  selection?: unknown;
  focus?: unknown;
  updatedAt?: string;
  source?: 'beam' | 'app' | 'agent' | 'system';
}

const MAX_CONTEXT_BYTES = 16 * 1024;

export function validateAppContext(value: unknown): PhotonAppContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Photon app context must be an object');
  }
  const encoded = JSON.stringify(value);
  if (encoded.length > MAX_CONTEXT_BYTES) {
    throw new Error(`Photon app context exceeds ${MAX_CONTEXT_BYTES} bytes`);
  }
  const input = value as Record<string, unknown>;
  const context: PhotonAppContext = {
    navigation:
      input.navigation && typeof input.navigation === 'object'
        ? (input.navigation as PhotonAppContext['navigation'])
        : undefined,
    selection: input.selection,
    focus: input.focus,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    source:
      input.source === 'beam' ||
      input.source === 'app' ||
      input.source === 'agent' ||
      input.source === 'system'
        ? input.source
        : 'system',
  };
  return Object.freeze(context);
}

export function getCurrentAppContext(): PhotonAppContext | undefined {
  return getRequestContext()?.appContext;
}

export { MAX_CONTEXT_BYTES };
