/**
 * Adapters for MCP 2026 durable input rounds.
 *
 * The wire protocol deliberately exposes generic `elicitation/create`
 * requests. Beam maps the common single-field forms to its richer native
 * controls and keeps the original form shape when a request needs multiple
 * fields.
 */

import type { ElicitationData, ElicitationOption } from '../components/elicitation-modal.js';
import type { MCPInputRequiredResult } from './mcp-client.js';

export interface MCPInputRequest {
  method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
  params?: Record<string, unknown>;
}

export interface BeamInputRequestPresentation {
  key: string;
  data: ElicitationData;
  /** Single-field native controls return the value directly and need wrapping. */
  responseProperty?: string;
  responseMode?: 'elicitation' | 'sampling' | 'roots';
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function optionFromSchema(value: unknown): ElicitationOption | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const metadata = asRecord(record['x-photon-option']) || {};
  const optionValue = record.const ?? metadata.value;
  if (typeof optionValue !== 'string') return undefined;
  const option: ElicitationOption = {
    value: optionValue,
    label: typeof record.title === 'string' ? record.title : optionValue,
    description: typeof record.description === 'string' ? record.description : undefined,
  };
  if (typeof metadata.image === 'string') option.image = metadata.image;
  return option;
}

function schemaOptions(schema: Record<string, any>): ElicitationOption[] {
  const photonOptions = Array.isArray(schema['x-photon-options'])
    ? schema['x-photon-options']
        .map((option: unknown) => {
          const record = asRecord(option);
          if (!record || typeof record.value !== 'string') return undefined;
          return {
            value: record.value,
            label: typeof record.label === 'string' ? record.label : record.value,
            description: typeof record.description === 'string' ? record.description : undefined,
            image: typeof record.image === 'string' ? record.image : undefined,
          };
        })
        .filter(Boolean)
    : [];
  if (photonOptions.length > 0) return photonOptions as ElicitationOption[];

  const direct = Array.isArray(schema.enum)
    ? schema.enum
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => ({ value, label: value }))
    : [];
  if (direct.length > 0) return direct;

  const anyOf = Array.isArray(schema.anyOf)
    ? schema.anyOf.map(optionFromSchema).filter(Boolean)
    : [];
  return anyOf as ElicitationOption[];
}

/**
 * Convert one MCP 2026 input request into the control data understood by the
 * existing Beam elicitation modal.
 */
export function presentMCPInputRequest(
  key: string,
  request: MCPInputRequest,
  context: { photonName?: string; methodName?: string; methodTitle?: string } = {}
): BeamInputRequestPresentation {
  const params = request.params || {};
  const message = typeof params.message === 'string' ? params.message : 'Input required';

  if (request.method !== 'elicitation/create') {
    return {
      key,
      responseMode: request.method === 'sampling/createMessage' ? 'sampling' : 'roots',
      data: {
        ask: request.method === 'sampling/createMessage' ? 'text' : 'confirm',
        message,
        description:
          request.method === 'sampling/createMessage'
            ? 'Provide the response Beam should return to the Photon.'
            : 'Allow the Photon to inspect the available workspace roots.',
        ...context,
      },
    };
  }

  if (params.mode === 'url') {
    return {
      key,
      data: {
        ask: 'url',
        message,
        url: typeof params.url === 'string' ? params.url : undefined,
        ...context,
      },
    };
  }

  const schema = asRecord(params.requestedSchema) || { type: 'object', properties: {} };
  const properties = asRecord(schema.properties) || {};
  const entries = Object.entries(properties);

  // Photon-native select/confirm/number prompts are represented as a single
  // form property by MCP. Preserve Beam's richer controls for those shapes.
  if (entries.length === 1) {
    const [propertyName, rawSchema] = entries[0];
    const property = asRecord(rawSchema) || {};
    const itemSchema = asRecord(property.items) || {};
    const options = property.type === 'array' ? schemaOptions(itemSchema) : schemaOptions(property);

    if (options.length > 0 && (property.type === 'array' || property.type === 'string')) {
      return {
        key,
        responseProperty: propertyName,
        data: {
          ask: 'select',
          message,
          options,
          multi: property.type === 'array',
          ...context,
        },
      };
    }

    if (property.type === 'boolean') {
      return {
        key,
        responseProperty: propertyName,
        data: {
          ask: 'confirm',
          message,
          default: property.default ?? false,
          ...context,
        },
      };
    }

    if (property.type === 'number' || property.type === 'integer') {
      return {
        key,
        responseProperty: propertyName,
        data: {
          ask: 'number',
          message,
          default: property.default,
          min: property.minimum,
          max: property.maximum,
          step: property.multipleOf ?? (property.type === 'integer' ? 1 : undefined),
          ...context,
        },
      };
    }
  }

  return {
    key,
    data: {
      ask: 'form',
      message,
      schema,
      ...context,
    },
  };
}

/** Wrap a native single-field control value in MCP form content. */
export function inputResponseValue(
  value: unknown,
  responseProperty?: string
): Record<string, unknown> {
  return responseProperty ? { [responseProperty]: value } : (value as Record<string, unknown>);
}

export function isMCPInputRequired(value: unknown): value is MCPInputRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    result.resultType === 'input_required' &&
    typeof result.requestState === 'string' &&
    !!result.inputRequests &&
    typeof result.inputRequests === 'object' &&
    !Array.isArray(result.inputRequests)
  );
}
