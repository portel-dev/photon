import type { PhotonIntentMeta } from './types.js';

export interface IntentAwareMethod {
  intent?: PhotonIntentMeta;
  params?: Array<{ optional?: boolean }> | { required?: unknown[] };
  outputFormat?: string;
  format?: string;
  buttonLabel?: string;
  destructiveHint?: boolean;
  readOnlyHint?: boolean;
}

export function methodRequiresInput(method: IntentAwareMethod | undefined): boolean {
  if (!method) return false;

  const schemaRequiresInput = Array.isArray(method.params)
    ? method.params.some((param) => !param.optional)
    : Array.isArray(method.params?.required) && method.params.required.length > 0;

  // Required schema fields cannot be hidden by stale or contradictory intent
  // metadata. Intent remains authoritative when the schema is optional.
  if (schemaRequiresInput) return true;
  return method.intent?.input?.requiresInput === true;
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

/** Background refresh must never infer safety from a method's arity or name. */
export function canRevalidateMethod(method: IntentAwareMethod | undefined): boolean {
  return (
    !!method &&
    !isDestructiveIntent(method) &&
    (method.readOnlyHint === true || method.intent?.safety?.readOnly === true)
  );
}
