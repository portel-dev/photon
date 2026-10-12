/**
 * Transport-neutral MCP elicitation policy.
 *
 * PhotonServer owns transport capability checks and client calls; this module
 * owns the wire schema and value/default mapping for Photon ask payloads.
 */

export interface ElicitationOption {
  value: unknown;
  label?: string;
  description?: string;
  image?: unknown;
  price?: unknown;
  badge?: unknown;
  badgeType?: unknown;
  category?: unknown;
}

export interface PhotonAsk {
  ask?: string;
  mode?: string;
  message?: string;
  label?: string;
  hint?: string;
  default?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  options?: Array<string | ElicitationOption>;
  multi?: boolean;
  url?: string;
  requestedSchema?: Record<string, unknown>;
}

export function buildMcpElicitParams(ask: PhotonAsk): Record<string, unknown> {
  const baseMessage = ask.message || 'Please provide input';

  switch (ask.ask) {
    case 'text':
    case 'password':
      return {
        mode: 'form',
        message: baseMessage,
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              title: ask.label || 'Input',
              description: ask.hint || ask.message,
              default: ask.default,
            },
          },
          required: ask.required !== false ? ['value'] : [],
        },
      };

    case 'confirm':
      return {
        mode: 'form',
        message: baseMessage,
        requestedSchema: {
          type: 'object',
          properties: {
            confirmed: {
              type: 'boolean',
              title: 'Confirm',
              description: ask.message,
              default: ask.default ?? false,
            },
          },
          required: ['confirmed'],
        },
      };

    case 'number':
      return {
        mode: 'form',
        message: baseMessage,
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'number',
              title: ask.label || 'Number',
              description: ask.hint || ask.message,
              default: ask.default,
              minimum: ask.min,
              maximum: ask.max,
            },
          },
          required: ask.required !== false ? ['value'] : [],
        },
      };

    case 'select': {
      const selectOptions = ask.options || [];
      const options = selectOptions.map((option) =>
        typeof option === 'string' ? option : option.value
      );
      const labels = selectOptions.map((option) =>
        typeof option === 'string' ? option : option.label
      );
      const photonOptions = selectOptions
        .filter((option): option is ElicitationOption => typeof option === 'object')
        .map((option) => ({
          value: option.value,
          ...(option.label ? { label: option.label } : {}),
          ...(option.description ? { description: option.description } : {}),
          ...(option.image ? { image: option.image } : {}),
          ...(option.price != null ? { price: option.price } : {}),
          ...(option.badge ? { badge: option.badge } : {}),
          ...(option.badgeType ? { badgeType: option.badgeType } : {}),
          ...(option.category ? { category: option.category } : {}),
        }));
      const photonOptionMetadata =
        photonOptions.length > 0 ? { 'x-photon-options': photonOptions } : {};
      return {
        mode: 'form',
        message: baseMessage + (ask.multi ? ' (select multiple)' : ''),
        requestedSchema: {
          type: 'object',
          properties: {
            selection: ask.multi
              ? {
                  type: 'array',
                  items: { type: 'string', enum: options, ...photonOptionMetadata },
                  title: ask.label || 'Selection',
                  description: `Options: ${labels.join(', ')}`,
                }
              : {
                  type: 'string',
                  enum: options,
                  title: ask.label || 'Selection',
                  description: `Options: ${labels.join(', ')}`,
                  ...photonOptionMetadata,
                },
          },
          required: ask.required !== false ? ['selection'] : [],
        },
      };
    }

    case 'date':
      return {
        mode: 'form',
        message: baseMessage,
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              format: 'date',
              title: ask.label || 'Date',
              description: ask.hint || ask.message,
              default: ask.default,
            },
          },
          required: ask.required !== false ? ['value'] : [],
        },
      };

    default:
      return {
        mode: 'form',
        message: baseMessage,
        requestedSchema: {
          type: 'object',
          properties: { value: { type: 'string', title: 'Input' } },
        },
      };
  }
}

export function extractMcpElicitValue(ask: PhotonAsk, content: Record<string, unknown>): unknown {
  switch (ask.ask) {
    case 'confirm':
      return content.confirmed ?? false;
    case 'select':
      return content.selection;
    default:
      return content.value;
  }
}

export function getDefaultMcpElicitValue(ask: PhotonAsk): unknown {
  if ('default' in ask) return ask.default;

  switch (ask.ask) {
    case 'confirm':
      return false;
    case 'number':
      return 0;
    case 'select':
      return ask.multi ? [] : null;
    case 'date':
      return new Date().toISOString().split('T')[0];
    default:
      return '';
  }
}
