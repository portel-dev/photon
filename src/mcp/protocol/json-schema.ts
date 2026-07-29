import { Worker } from 'node:worker_threads';
import type { JSONSchema as Draft202012Schema } from 'json-schema-typed/draft-2020-12';

export const JSON_SCHEMA_2020_12_DIALECT = 'https://json-schema.org/draft/2020-12/schema' as const;

/**
 * Draft 2020-12 schema, including implementation-defined vocabulary
 * keywords. JSON Schema requires unknown keywords to remain annotations
 * rather than being stripped, so the object branch deliberately permits
 * extension keys in addition to the standard typed vocabulary.
 */
export type JSONSchema202012 =
  | Draft202012Schema
  | (Record<string, unknown> & Exclude<Draft202012Schema, boolean>);

export type FiniteJSONValue =
  | null
  | boolean
  | number
  | string
  | FiniteJSONValue[]
  | { [key: string]: FiniteJSONValue };

export interface JSONSchemaValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
}

export interface JSONSchemaValidationSuccess {
  ok: true;
  value: FiniteJSONValue;
}

export interface JSONSchemaValidationFailure {
  ok: false;
  kind:
    | 'invalid-schema'
    | 'invalid-output'
    | 'schema-limit'
    | 'output-limit'
    | 'validation-timeout'
    | 'validation-runtime';
  message: string;
  issues?: JSONSchemaValidationIssue[];
}

export type JSONSchemaValidationResult = JSONSchemaValidationSuccess | JSONSchemaValidationFailure;

export interface MCPJSONSchemaLimits {
  maxSchemaDepth: number;
  maxSchemaNodes: number;
  maxSchemaReferences: number;
  maxSchemaStringLength: number;
  maxOutputDepth: number;
  maxOutputNodes: number;
  maxOutputArrayLength: number;
  maxOutputObjectProperties: number;
  maxOutputStringLength: number;
  maxValidationMs: number;
  maxIssues: number;
  maxIssueMessageLength: number;
}

export const MCP_JSON_SCHEMA_LIMITS: Readonly<MCPJSONSchemaLimits> = {
  maxSchemaDepth: 32,
  maxSchemaNodes: 4_096,
  maxSchemaReferences: 128,
  maxSchemaStringLength: 16_384,
  maxOutputDepth: 64,
  maxOutputNodes: 100_000,
  maxOutputArrayLength: 10_000,
  maxOutputObjectProperties: 10_000,
  maxOutputStringLength: 1_048_576,
  maxValidationMs: 500,
  maxIssues: 8,
  maxIssueMessageLength: 256,
};

function boundedLimit(override: number | undefined, ceiling: number): number {
  if (override === undefined || !Number.isFinite(override)) return ceiling;
  return Math.min(Math.max(0, Math.floor(override)), ceiling);
}

function effectiveLimits(
  overrides: Readonly<Partial<MCPJSONSchemaLimits>>
): Readonly<MCPJSONSchemaLimits> {
  return {
    maxSchemaDepth: boundedLimit(overrides.maxSchemaDepth, MCP_JSON_SCHEMA_LIMITS.maxSchemaDepth),
    maxSchemaNodes: boundedLimit(overrides.maxSchemaNodes, MCP_JSON_SCHEMA_LIMITS.maxSchemaNodes),
    maxSchemaReferences: boundedLimit(
      overrides.maxSchemaReferences,
      MCP_JSON_SCHEMA_LIMITS.maxSchemaReferences
    ),
    maxSchemaStringLength: boundedLimit(
      overrides.maxSchemaStringLength,
      MCP_JSON_SCHEMA_LIMITS.maxSchemaStringLength
    ),
    maxOutputDepth: boundedLimit(overrides.maxOutputDepth, MCP_JSON_SCHEMA_LIMITS.maxOutputDepth),
    maxOutputNodes: boundedLimit(overrides.maxOutputNodes, MCP_JSON_SCHEMA_LIMITS.maxOutputNodes),
    maxOutputArrayLength: boundedLimit(
      overrides.maxOutputArrayLength,
      MCP_JSON_SCHEMA_LIMITS.maxOutputArrayLength
    ),
    maxOutputObjectProperties: boundedLimit(
      overrides.maxOutputObjectProperties,
      MCP_JSON_SCHEMA_LIMITS.maxOutputObjectProperties
    ),
    maxOutputStringLength: boundedLimit(
      overrides.maxOutputStringLength,
      MCP_JSON_SCHEMA_LIMITS.maxOutputStringLength
    ),
    maxValidationMs: boundedLimit(
      overrides.maxValidationMs,
      MCP_JSON_SCHEMA_LIMITS.maxValidationMs
    ),
    maxIssues: boundedLimit(overrides.maxIssues, MCP_JSON_SCHEMA_LIMITS.maxIssues),
    maxIssueMessageLength: boundedLimit(
      overrides.maxIssueMessageLength,
      MCP_JSON_SCHEMA_LIMITS.maxIssueMessageLength
    ),
  };
}

class BoundedValueError extends Error {
  constructor(
    readonly kind: 'schema-limit' | 'output-limit' | 'invalid-schema' | 'invalid-output',
    message: string
  ) {
    super(message);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function decodeJSONPointerToken(token: string): string {
  try {
    return decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~');
  } catch {
    throw new BoundedValueError('invalid-schema', 'Local reference contains invalid encoding');
  }
}

function resolveLocalAnchor(
  root: unknown,
  rawAnchor: string,
  limits: Readonly<MCPJSONSchemaLimits>
): unknown {
  let anchor: string;
  try {
    anchor = decodeURIComponent(rawAnchor);
  } catch {
    throw new BoundedValueError('invalid-schema', 'Local reference contains invalid encoding');
  }
  const seen = new Set<object>();
  const queue: unknown[] = [root];
  let cursor = 0;
  let nodes = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    nodes++;
    if (nodes > limits.maxSchemaNodes) {
      throw new BoundedValueError('schema-limit', 'Output schema exceeds the node limit');
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...current);
      continue;
    }
    if (!isPlainRecord(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current.$anchor === anchor) return current;
    queue.push(...Object.values(current));
  }
  throw new BoundedValueError('invalid-schema', 'Local reference is unresolved');
}

function resolveLocalReference(
  root: unknown,
  reference: string,
  limits: Readonly<MCPJSONSchemaLimits>
): unknown {
  if (reference === '#') return root;
  if (reference.startsWith('#') && !reference.startsWith('#/')) {
    return resolveLocalAnchor(root, reference.slice(1), limits);
  }
  if (!reference.startsWith('#/')) {
    throw new BoundedValueError(
      'invalid-schema',
      'Only local JSON Pointer references are supported'
    );
  }
  let current = root;
  for (const rawToken of reference.slice(2).split('/')) {
    const token = decodeJSONPointerToken(rawToken);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) {
        throw new BoundedValueError('invalid-schema', 'Local reference is unresolved');
      }
      current = current[Number(token)];
    } else if (isPlainRecord(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      throw new BoundedValueError('invalid-schema', 'Local reference is unresolved');
    }
  }
  if (typeof current !== 'boolean' && !isPlainRecord(current)) {
    throw new BoundedValueError('invalid-schema', 'Local references must resolve to a JSON Schema');
  }
  return current;
}

function assertBoundedSchema(
  schema: unknown,
  limits: Readonly<MCPJSONSchemaLimits>
): asserts schema is JSONSchema202012 {
  if (typeof schema !== 'boolean' && !isPlainRecord(schema)) {
    throw new BoundedValueError('invalid-schema', 'Output schema must be a boolean or object');
  }

  let nodes = 0;
  let references = 0;
  const ancestors = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > limits.maxSchemaDepth) {
      throw new BoundedValueError('schema-limit', 'Output schema exceeds the depth limit');
    }
    nodes++;
    if (nodes > limits.maxSchemaNodes) {
      throw new BoundedValueError('schema-limit', 'Output schema exceeds the node limit');
    }
    if (typeof value === 'string') {
      if (value.length > limits.maxSchemaStringLength) {
        throw new BoundedValueError('schema-limit', 'Output schema contains an oversized string');
      }
      return;
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return;
    }
    if (typeof value === 'number') {
      throw new BoundedValueError('invalid-schema', 'Output schema contains a non-finite number');
    }
    if (!Array.isArray(value) && !isPlainRecord(value)) {
      throw new BoundedValueError('invalid-schema', 'Output schema must contain only JSON values');
    }

    if (ancestors.has(value)) {
      throw new BoundedValueError('invalid-schema', 'Circular output schemas are not supported');
    }
    ancestors.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else {
      if (value.$dynamicRef !== undefined || value.$recursiveRef !== undefined) {
        throw new BoundedValueError(
          'invalid-schema',
          'Dynamic and recursive output schema references are not supported'
        );
      }
      const reference = value.$ref;
      if (reference !== undefined) {
        if (typeof reference !== 'string') {
          throw new BoundedValueError('invalid-schema', '$ref must be a string');
        }
        references++;
        if (references > limits.maxSchemaReferences) {
          throw new BoundedValueError('schema-limit', 'Output schema exceeds the reference limit');
        }
        if (!reference.startsWith('#')) {
          throw new BoundedValueError(
            'invalid-schema',
            'Network and filesystem output schema references are not allowed'
          );
        }
        const target = resolveLocalReference(schema, reference, limits);
        visit(target, depth + 1);
      }
      for (const [key, item] of Object.entries(value)) {
        if (key === '$ref' || key === '$dynamicRef' || key === '$recursiveRef') continue;
        visit(item, depth + 1);
      }
    }
    ancestors.delete(value);
  };

  visit(schema, 0);
}

function toFiniteJSONValue(value: unknown, limits: Readonly<MCPJSONSchemaLimits>): FiniteJSONValue {
  let nodes = 0;
  const ancestors = new Set<object>();

  const visit = (current: unknown, depth: number): FiniteJSONValue => {
    if (depth > limits.maxOutputDepth) {
      throw new BoundedValueError('output-limit', 'Tool output exceeds the depth limit');
    }
    nodes++;
    if (nodes > limits.maxOutputNodes) {
      throw new BoundedValueError('output-limit', 'Tool output exceeds the node limit');
    }
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new BoundedValueError('invalid-output', 'Tool output contains a non-finite number');
      }
      return current;
    }
    if (typeof current === 'string') {
      if (current.length > limits.maxOutputStringLength) {
        throw new BoundedValueError('output-limit', 'Tool output contains an oversized string');
      }
      return current;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maxOutputArrayLength) {
        throw new BoundedValueError('output-limit', 'Tool output exceeds the array length limit');
      }
      if (ancestors.has(current)) {
        throw new BoundedValueError('invalid-output', 'Tool output contains a circular value');
      }
      ancestors.add(current);
      const result = current.map((item) => visit(item, depth + 1));
      ancestors.delete(current);
      return result;
    }
    if (!isPlainRecord(current)) {
      throw new BoundedValueError('invalid-output', 'Tool output must be finite JSON');
    }
    const entries = Object.entries(current);
    if (entries.length > limits.maxOutputObjectProperties) {
      throw new BoundedValueError('output-limit', 'Tool output exceeds the object property limit');
    }
    if (ancestors.has(current)) {
      throw new BoundedValueError('invalid-output', 'Tool output contains a circular value');
    }
    ancestors.add(current);
    const result: Record<string, FiniteJSONValue> = {};
    for (const [key, item] of entries) result[key] = visit(item, depth + 1);
    ancestors.delete(current);
    return result;
  };

  return visit(value, 0);
}

export function isFiniteJSONValue(value: unknown): value is FiniteJSONValue {
  try {
    toFiniteJSONValue(value, MCP_JSON_SCHEMA_LIMITS);
    return true;
  } catch {
    return false;
  }
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  kind?: JSONSchemaValidationFailure['kind'];
  message?: string;
  issues?: JSONSchemaValidationIssue[];
}

interface PendingValidation {
  resolve: (result: JSONSchemaValidationResult) => void;
  timer: NodeJS.Timeout;
  value: FiniteJSONValue;
}

let validationWorker: Worker | undefined;
let nextValidationId = 1;
const pendingValidations = new Map<number, PendingValidation>();

function resetValidationWorker(failure?: JSONSchemaValidationFailure): void {
  const worker = validationWorker;
  validationWorker = undefined;
  if (worker) void worker.terminate();
  for (const pending of pendingValidations.values()) {
    clearTimeout(pending.timer);
    pending.resolve(
      failure ?? {
        ok: false,
        kind: 'validation-runtime',
        message: 'Output schema validator stopped unexpectedly',
      }
    );
  }
  pendingValidations.clear();
}

export function stopJSONSchemaValidationWorker(): void {
  resetValidationWorker();
}

function getValidationWorker(): Worker {
  if (validationWorker) return validationWorker;
  const worker = new Worker(new URL('./json-schema-worker.js', import.meta.url));
  worker.on('message', (response: WorkerResponse) => {
    const pending = pendingValidations.get(response.id);
    if (!pending) return;
    pendingValidations.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve({ ok: true, value: pending.value });
    } else {
      pending.resolve({
        ok: false,
        kind: response.kind ?? 'validation-runtime',
        message: (response.message ?? 'Output schema validation failed').slice(0, 1_024),
        ...(response.issues ? { issues: response.issues } : {}),
      });
    }
  });
  worker.on('error', () => {
    if (validationWorker === worker) {
      resetValidationWorker({
        ok: false,
        kind: 'validation-runtime',
        message: 'Output schema validator failed',
      });
    }
  });
  worker.on('exit', (code) => {
    if (validationWorker === worker && code !== 0) {
      resetValidationWorker({
        ok: false,
        kind: 'validation-runtime',
        message: 'Output schema validator exited unexpectedly',
      });
    }
  });
  worker.unref();
  validationWorker = worker;
  return worker;
}

export async function validateStructuredOutput(
  schema: unknown,
  value: unknown,
  limitOverrides: Readonly<Partial<MCPJSONSchemaLimits>> = MCP_JSON_SCHEMA_LIMITS
): Promise<JSONSchemaValidationResult> {
  const limits = effectiveLimits(limitOverrides);
  let finiteValue: FiniteJSONValue;
  try {
    assertBoundedSchema(schema, limits);
    finiteValue = toFiniteJSONValue(value, limits);
  } catch (error) {
    if (error instanceof BoundedValueError) {
      return { ok: false, kind: error.kind, message: error.message };
    }
    return {
      ok: false,
      kind: 'validation-runtime',
      message: 'Output schema validation preflight failed',
    };
  }

  return new Promise<JSONSchemaValidationResult>((resolve) => {
    const id = nextValidationId++;
    const timer = setTimeout(() => {
      if (!pendingValidations.has(id)) return;
      resetValidationWorker({
        ok: false,
        kind: 'validation-timeout',
        message: 'Output schema validation exceeded the time limit',
      });
    }, limits.maxValidationMs);
    pendingValidations.set(id, { resolve, timer, value: finiteValue });
    getValidationWorker().postMessage({ id, schema, value: finiteValue, limits });
  });
}

export function withJSONSchemaDialect(schema: JSONSchema202012): JSONSchema202012 {
  if (typeof schema === 'boolean' || schema.$schema !== undefined) return schema;
  return { ...schema, $schema: JSON_SCHEMA_2020_12_DIALECT };
}
