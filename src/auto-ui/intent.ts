import type { PhotonIntentMeta } from './types.js';

export interface IntentAwareMethod {
  intent?: PhotonIntentMeta;
  params?: Array<{ optional?: boolean }> | { required?: unknown[] };
  outputFormat?: string;
  format?: string;
  buttonLabel?: string;
  destructiveHint?: boolean;
}

export function methodRequiresInput(method: IntentAwareMethod | undefined): boolean {
  if (!method) return false;
  if (method.intent?.input?.requiresInput !== undefined) {
    return method.intent.input.requiresInput;
  }
  if (Array.isArray(method.params)) {
    return method.params.some((param) => !param.optional);
  }
  return Array.isArray(method.params?.required) && method.params.required.length > 0;
}

export function isDestructiveIntent(method: IntentAwareMethod | undefined): boolean {
  return (
    method?.destructiveHint === true ||
    method?.intent?.safety?.destructive === true ||
    method?.intent?.action === 'delete'
  );
}

export function getIntentOutputFormat(method: IntentAwareMethod | undefined): string | undefined {
  return method?.outputFormat ?? method?.format ?? method?.intent?.output?.format;
}
