export const MCP_PARAM_HEADER_PREFIX = 'Mcp-Param-';

const HEADER_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;
const BASE64_SENTINEL_SHAPE = /^=\?base64\?.*\?=$/;
const SENSITIVE_NAME =
  /(?:api.?key|authorization|bearer|credential|password|private.?key|secret|token)/i;
const MAX_BINDINGS = 64;
const MAX_HEADER_NAME_LENGTH = 128;

export interface MCPHeaderBinding {
  path: readonly string[];
  annotation: string;
  headerName: string;
  type: 'string' | 'integer' | 'boolean';
}

export type MCPHeaderBindingResult =
  | { ok: true; bindings: readonly MCPHeaderBinding[] }
  | { ok: false; issue: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function containsAnnotation(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAnnotation);
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'x-mcp-header')) return true;
  return Object.values(value).some(containsAnnotation);
}

function isSensitive(path: readonly string[], schema: Record<string, unknown>): boolean {
  return (
    path.some((segment) => SENSITIVE_NAME.test(segment)) ||
    schema.writeOnly === true ||
    schema.secret === true ||
    schema['x-secret'] === true ||
    schema['x-sensitive'] === true ||
    schema.format === 'password'
  );
}

/**
 * Extract the statically-known property paths defined by MCP 2026. Annotations
 * reached through arrays, composition, conditionals, or references are
 * rejected because an HTTP intermediary cannot resolve those routes safely.
 */
export function parseMCPHeaderBindings(inputSchema: unknown): MCPHeaderBindingResult {
  if (!isRecord(inputSchema)) return { ok: true, bindings: [] };
  if (Object.prototype.hasOwnProperty.call(inputSchema, 'x-mcp-header')) {
    return { ok: false, issue: 'x-mcp-header must annotate an inputSchema property' };
  }
  const bindings: MCPHeaderBinding[] = [];
  const names = new Set<string>();
  let issue: string | undefined;

  const visitProperties = (schema: Record<string, unknown>, path: readonly string[]) => {
    if (issue) return;
    const properties = schema.properties;
    if (properties !== undefined && !isRecord(properties)) {
      issue = 'inputSchema properties must be an object';
      return;
    }

    for (const [propertyName, propertyValue] of Object.entries(properties ?? {})) {
      if (!isRecord(propertyValue)) continue;
      const propertyPath = [...path, propertyName];
      const annotation = propertyValue['x-mcp-header'];
      if (annotation !== undefined) {
        if (
          typeof annotation !== 'string' ||
          annotation.length === 0 ||
          annotation.length > MAX_HEADER_NAME_LENGTH ||
          !HEADER_NAME_TOKEN.test(annotation)
        ) {
          issue = `invalid x-mcp-header on ${propertyPath.join('.')}`;
          return;
        }
        const normalized = annotation.toLowerCase();
        if (names.has(normalized)) {
          issue = `duplicate x-mcp-header name ${annotation}`;
          return;
        }
        if (
          propertyValue.type !== 'string' &&
          propertyValue.type !== 'integer' &&
          propertyValue.type !== 'boolean'
        ) {
          issue = `x-mcp-header property ${propertyPath.join('.')} must be string, integer, or boolean`;
          return;
        }
        if (isSensitive(propertyPath, propertyValue)) {
          issue = `x-mcp-header property ${propertyPath.join('.')} is sensitive`;
          return;
        }
        names.add(normalized);
        bindings.push({
          path: propertyPath,
          annotation,
          headerName: `${MCP_PARAM_HEADER_PREFIX}${annotation}`,
          type: propertyValue.type,
        });
        if (bindings.length > MAX_BINDINGS) {
          issue = `inputSchema exceeds ${MAX_BINDINGS} x-mcp-header bindings`;
          return;
        }
      }

      visitProperties(propertyValue, propertyPath);
      if (issue) return;

      for (const [keyword, nested] of Object.entries(propertyValue)) {
        if (keyword === 'properties' || keyword === 'x-mcp-header') continue;
        if (containsAnnotation(nested)) {
          issue = `x-mcp-header on ${propertyPath.join('.')} uses a non-static schema route`;
          return;
        }
      }
    }
  };

  visitProperties(inputSchema, []);
  if (!issue) {
    for (const [keyword, nested] of Object.entries(inputSchema)) {
      if (keyword === 'properties') continue;
      if (containsAnnotation(nested)) {
        issue = 'x-mcp-header at the inputSchema root uses a non-static schema route';
        break;
      }
    }
  }
  if (issue) return { ok: false, issue };
  return { ok: true, bindings };
}

function valueAtPath(argumentsValue: unknown, path: readonly string[]): unknown {
  let current = argumentsValue;
  for (const segment of path) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function encodeMCPHeaderValue(value: string | number | boolean): string {
  const canonical = typeof value === 'string' ? value : String(value);
  const safePlain =
    /^[\x20-\x7e]*$/.test(canonical) &&
    canonical.trim() === canonical &&
    !BASE64_SENTINEL_SHAPE.test(canonical);
  return safePlain ? canonical : `=?base64?${Buffer.from(canonical, 'utf8').toString('base64')}?=`;
}

export function decodeMCPHeaderValue(value: string): string | null {
  const sentinel = value.match(BASE64_SENTINEL);
  if (sentinel) {
    const payload = sentinel[1];
    if (payload.length % 4 !== 0) return null;
    const decoded = Buffer.from(payload, 'base64');
    if (decoded.toString('base64') !== payload) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    } catch {
      return null;
    }
  }
  if (BASE64_SENTINEL_SHAPE.test(value)) return null;
  if (!/^[\x20-\x7e]*$/.test(value) || value.trim() !== value) return null;
  return value;
}

export function buildMCPParamHeaders(
  bindings: readonly MCPHeaderBinding[],
  argumentsValue: unknown
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const binding of bindings) {
    const value = valueAtPath(argumentsValue, binding.path);
    if (value === undefined || value === null) continue;
    if (
      (binding.type === 'string' && typeof value !== 'string') ||
      (binding.type === 'boolean' && typeof value !== 'boolean') ||
      (binding.type === 'integer' && !Number.isSafeInteger(value))
    ) {
      continue;
    }
    headers[binding.headerName] = encodeMCPHeaderValue(value as string | number | boolean);
  }
  return headers;
}

function rawHeaderValues(rawHeaders: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === name.toLowerCase()) values.push(rawHeaders[index + 1]);
  }
  return values;
}

export function validateMCPParamHeaders(input: {
  bindings: readonly MCPHeaderBinding[];
  argumentsValue: unknown;
  rawHeaders: readonly string[];
}): { ok: true } | { ok: false; issue: string } {
  for (const binding of input.bindings) {
    const values = rawHeaderValues(input.rawHeaders, binding.headerName);
    if (values.length > 1) {
      return { ok: false, issue: `duplicate ${binding.headerName}` };
    }
    const bodyValue = valueAtPath(input.argumentsValue, binding.path);
    if (bodyValue === undefined || bodyValue === null) {
      if (values.length !== 0) return { ok: false, issue: `unexpected ${binding.headerName}` };
      continue;
    }
    if (values.length !== 1) return { ok: false, issue: `missing ${binding.headerName}` };
    const decoded = decodeMCPHeaderValue(values[0]);
    if (decoded === null) return { ok: false, issue: `malformed ${binding.headerName}` };

    const matches =
      binding.type === 'integer'
        ? Number.isSafeInteger(bodyValue) &&
          /^-?(?:0|[1-9]\d*)(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(decoded) &&
          Number.isSafeInteger(Number(decoded)) &&
          Number(decoded) === bodyValue
        : binding.type === 'boolean'
          ? typeof bodyValue === 'boolean' && decoded === String(bodyValue)
          : typeof bodyValue === 'string' && decoded === bodyValue;
    if (!matches) return { ok: false, issue: `mismatched ${binding.headerName}` };
  }
  return { ok: true };
}
