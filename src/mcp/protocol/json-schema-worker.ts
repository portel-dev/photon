import { parentPort } from 'node:worker_threads';
import AjvDraft7, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';

interface ValidationRequest {
  id: number;
  schema: unknown;
  value: unknown;
  limits: {
    maxIssues: number;
    maxIssueMessageLength: number;
  };
}

const validators = {
  draft7: new AjvDraft7({
    allErrors: false,
    strict: false,
    validateFormats: false,
    allowUnionTypes: true,
  }),
  draft2019: new Ajv2019({
    allErrors: false,
    strict: false,
    validateFormats: false,
    allowUnionTypes: true,
  }),
  draft2020: new Ajv2020({
    allErrors: false,
    strict: false,
    validateFormats: false,
    allowUnionTypes: true,
  }),
};

const compiled = new Map<string, ValidateFunction>();
const MAX_COMPILED_SCHEMAS = 128;

function schemaDialect(schema: unknown): keyof typeof validators {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'draft2020';
  const dialect = (schema as Record<string, unknown>).$schema;
  if (
    dialect === undefined ||
    dialect === 'https://json-schema.org/draft/2020-12/schema' ||
    dialect === 'https://json-schema.org/draft/2020-12/schema#'
  ) {
    return 'draft2020';
  }
  if (
    dialect === 'https://json-schema.org/draft/2019-09/schema' ||
    dialect === 'http://json-schema.org/draft/2019-09/schema#'
  ) {
    return 'draft2019';
  }
  if (
    dialect === 'http://json-schema.org/draft-07/schema#' ||
    dialect === 'https://json-schema.org/draft-07/schema'
  ) {
    return 'draft7';
  }
  throw new Error('Unsupported output schema dialect');
}

function compile(schema: unknown): ValidateFunction {
  const dialect = schemaDialect(schema);
  const key = `${dialect}:${JSON.stringify(schema)}`;
  const existing = compiled.get(key);
  if (existing) return existing;
  const validate = validators[dialect].compile(schema as AnySchema);
  if (compiled.size >= MAX_COMPILED_SCHEMAS) {
    const first = compiled.keys().next().value;
    if (typeof first === 'string') compiled.delete(first);
  }
  compiled.set(key, validate);
  return validate;
}

function boundedIssues(
  errors: ErrorObject[] | null | undefined,
  limits: ValidationRequest['limits']
) {
  return (errors ?? []).slice(0, limits.maxIssues).map((error) => ({
    instancePath: error.instancePath.slice(0, 256),
    keyword: error.keyword.slice(0, 64),
    message: (error.message ?? 'does not match the declared schema').slice(
      0,
      limits.maxIssueMessageLength
    ),
  }));
}

parentPort?.on('message', (request: ValidationRequest) => {
  try {
    const validate = compile(request.schema);
    const valid = validate(request.value);
    if (valid) {
      parentPort?.postMessage({ id: request.id, ok: true });
      return;
    }
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      kind: 'invalid-output',
      message: 'Tool output does not match the declared output schema',
      issues: boundedIssues(validate.errors, request.limits),
    });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      kind: 'invalid-schema',
      message:
        error instanceof Error
          ? `Invalid output schema: ${error.message}`.slice(0, 1_024)
          : 'Invalid output schema',
    });
  }
});
