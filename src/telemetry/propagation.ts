/**
 * Bounded W3C trace-context and baggage validation.
 *
 * These values are untrusted request metadata. Photon carries only canonical,
 * size-bounded values and never expands baggage into metric attributes.
 */

export const MAX_TRACESTATE_LENGTH = 512;
export const MAX_TRACESTATE_MEMBERS = 32;
export const MAX_BAGGAGE_BYTES = 8 * 1024;
export const MAX_BAGGAGE_MEMBERS = 64;

export interface TracePropagationContext {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}

export type TracePropagationField = keyof TracePropagationContext;

export type TracePropagationValidation =
  | { ok: true; context: TracePropagationContext }
  | { ok: false; field: TracePropagationField; reason: string };

export function parseTraceparent(
  traceparent: string | undefined | null
): { version: string; traceId: string; spanId: string; flags: string } | null {
  if (!traceparent || typeof traceparent !== 'string' || traceparent !== traceparent.trim()) {
    return null;
  }
  if (!/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
    return null;
  }
  const [version, traceId, spanId, flags] = traceparent.split('-');
  if (version === 'ff' || /^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { version, traceId, spanId, flags };
}

export function normalizeTracestate(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_TRACESTATE_LENGTH || /[\r\n]/.test(value)) {
    return null;
  }
  const members = value.split(',');
  if (members.length === 0 || members.length > MAX_TRACESTATE_MEMBERS) return null;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawMember of members) {
    const member = rawMember.trim();
    const separator = member.indexOf('=');
    if (separator <= 0) return null;
    const key = member.slice(0, separator);
    const memberValue = member.slice(separator + 1).trim();
    if (!validTracestateKey(key) || !validTracestateValue(memberValue) || seen.has(key)) {
      return null;
    }
    seen.add(key);
    normalized.push(`${key}=${memberValue}`);
  }
  return normalized.join(',');
}

export function normalizeBaggage(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > MAX_BAGGAGE_BYTES ||
    /[\r\n]/.test(value)
  ) {
    return null;
  }
  const members = value.split(',');
  if (members.length === 0 || members.length > MAX_BAGGAGE_MEMBERS) return null;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawMember of members) {
    const segments = rawMember.split(';');
    const pair = segments.shift()?.trim() ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) return null;
    const key = pair.slice(0, separator).trim();
    const memberValue = pair.slice(separator + 1).trim();
    if (!HTTP_TOKEN.test(key) || seen.has(key) || !validBaggageValue(memberValue)) return null;
    seen.add(key);
    const properties: string[] = [];
    for (const rawProperty of segments) {
      const property = rawProperty.trim();
      if (!property || !validBaggageProperty(property)) return null;
      properties.push(property);
    }
    normalized.push(`${key}=${memberValue}${properties.map((item) => `;${item}`).join('')}`);
  }
  return normalized.join(',');
}

export function validateTracePropagation(
  input: TracePropagationContext
): TracePropagationValidation {
  const context: TracePropagationContext = {};
  if (input.traceparent !== undefined) {
    const parsed = parseTraceparent(input.traceparent);
    if (!parsed) {
      return { ok: false, field: 'traceparent', reason: 'invalid W3C traceparent' };
    }
    context.traceparent = input.traceparent;
  }
  if (input.tracestate !== undefined) {
    if (!context.traceparent) {
      return {
        ok: false,
        field: 'tracestate',
        reason: 'tracestate requires a valid traceparent',
      };
    }
    const normalized = normalizeTracestate(input.tracestate);
    if (!normalized) {
      return { ok: false, field: 'tracestate', reason: 'invalid or oversized tracestate' };
    }
    context.tracestate = normalized;
  }
  if (input.baggage !== undefined) {
    const normalized = normalizeBaggage(input.baggage);
    if (!normalized) {
      return { ok: false, field: 'baggage', reason: 'invalid or oversized baggage' };
    }
    context.baggage = normalized;
  }
  return { ok: true, context };
}

export function traceContextMeta(
  context: TracePropagationContext | undefined
): Record<string, string> {
  if (!context) return {};
  return {
    ...(context.traceparent ? { traceparent: context.traceparent } : {}),
    ...(context.tracestate ? { tracestate: context.tracestate } : {}),
    ...(context.baggage ? { baggage: context.baggage } : {}),
  };
}

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SIMPLE_TRACESTATE_KEY = /^[a-z][_0-9a-z*\/-]{0,255}$/;
const MULTI_TENANT_TRACESTATE_KEY = /^[a-z0-9][_0-9a-z*\/-]{0,240}@[a-z][_0-9a-z*\/-]{0,13}$/;

function validTracestateKey(value: string): boolean {
  return SIMPLE_TRACESTATE_KEY.test(value) || MULTI_TENANT_TRACESTATE_KEY.test(value);
}

function validTracestateValue(value: string): boolean {
  if (!value || value.length > 256 || value.endsWith(' ')) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code > 0x7e || character === ',' || character === '=') return false;
  }
  return true;
}

function validBaggageValue(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code < 0x21 ||
      code > 0x7e ||
      character === ',' ||
      character === ';' ||
      character === '\\'
    ) {
      return false;
    }
  }
  return true;
}

function validBaggageProperty(value: string): boolean {
  const separator = value.indexOf('=');
  if (separator < 0) return HTTP_TOKEN.test(value);
  return (
    HTTP_TOKEN.test(value.slice(0, separator)) && validBaggageValue(value.slice(separator + 1))
  );
}
