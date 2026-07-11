/**
 * OpenAPI 3.1 Spec Generator for Photon Beam
 *
 * Generates OpenAPI specification from Photon schemas.
 * Uses standard OpenAPI/JSON Schema where possible,
 * extends with x-* properties for UI-specific features.
 *
 * Standard Mappings:
 * - type, minimum, maximum, enum, format, description → native JSON Schema
 *
 * Extensions (x-*):
 * - x-accept: File type filter for file picker
 * - x-output-format: Rendering format (table, list, card, tree, etc.)
 * - x-layout-hints: Field mapping for smart rendering
 * - x-button-label: Custom submit button text
 * - x-icon: Method/field icon
 * - x-autorun: Auto-execute on selection
 */

import type { HttpRouteDef } from '../shared/http-route-extractor.js';

// OpenAPI 3.1 types (simplified to avoid complex type compatibility issues)
interface OpenAPIDocument {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string; [key: string]: any }>;
  paths: Record<string, any>;
  [key: string]: any; // Allow extensions
}

interface MethodInfo {
  name: string;
  description: string;
  icon?: string;
  params: any; // JSON Schema
  returns: any;
  autorun?: boolean;
  outputFormat?: string;
  layoutHints?: Record<string, string>;
  buttonLabel?: string;
  linkedUi?: string;
}

interface PhotonInfo {
  name: string;
  path: string;
  configured: boolean;
  methods?: MethodInfo[];
  httpRoutes?: HttpRouteDef[];
  isApp?: boolean;
  requiredParams?: Array<{
    name: string;
    envVar: string;
    type: string;
    isOptional: boolean;
    hasDefault: boolean;
    defaultValue?: any;
  }>;
  errorMessage?: string;
}

/**
 * Generate OpenAPI 3.1 specification from Photon schemas
 */
export function generateOpenAPISpec(
  photons: PhotonInfo[],
  serverUrl: string = 'http://localhost:3000' // dev-only default, caller provides actual URL
): OpenAPIDocument {
  const paths: Record<string, any> = {};
  const tags: Array<{ name: string; description?: string; [key: string]: any }> = [];

  // Include every configured photon that exposes an MCP method or HTTP route.
  const configuredPhotons = photons.filter(
    (p) => p.configured && ((p.methods?.length ?? 0) > 0 || (p.httpRoutes?.length ?? 0) > 0)
  );

  for (const photon of configuredPhotons) {
    // Add tag for photon
    tags.push({
      name: photon.name,
      description: `Methods from ${photon.name} photon`,
      ...(photon.isApp && { 'x-app': true }),
    });

    for (const method of photon.methods ?? []) {
      const operationId = `${photon.name}_${method.name}`;
      const path = `/api/v1/photon/${encodeURIComponent(photon.name)}/tools/${encodeURIComponent(method.name)}`;

      // Convert params schema to OpenAPI request body
      const requestSchema = convertToOpenAPISchema(method.params);

      // Build operation object
      const operation: Record<string, any> = {
        operationId,
        summary: method.description || `Execute ${method.name}`,
        tags: [photon.name],
        security: [{ PhotonBearer: [] }, { PhotonRequest: [] }],
        requestBody: hasProperties(method.params)
          ? {
              required: true,
              content: {
                'application/json': {
                  schema: requestSchema,
                },
              },
            }
          : undefined,
        responses: {
          '200': {
            description: 'Successful execution',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: method.returns || { type: 'object' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid parameters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      };

      // Add extensions for UI features
      if (method.icon) {
        operation['x-icon'] = method.icon;
      }
      if (method.autorun) {
        operation['x-autorun'] = true;
      }
      if (method.outputFormat) {
        operation['x-output-format'] = method.outputFormat;
      }
      if (method.layoutHints && Object.keys(method.layoutHints).length > 0) {
        operation['x-layout-hints'] = method.layoutHints;
      }
      if (method.buttonLabel) {
        operation['x-button-label'] = method.buttonLabel;
      }
      paths[path] = {
        post: operation,
      };
    }

    // Add HTTP routes explicitly defined via @get, @post, @put, @patch, @delete
    if (photon.httpRoutes) {
      for (const route of photon.httpRoutes) {
        const operationId = `${photon.name}_${route.handler}`;
        // ensure path starts with /
        const routePath = route.path.startsWith('/') ? route.path : '/' + route.path;
        const pathParams: string[] = [];
        const openApiRoutePath = routePath.replace(/:([A-Za-z_$][\w$]*)/g, (_match, name) => {
          pathParams.push(name);
          return `{${name}}`;
        });
        const openApiPath = `/web/${encodeURIComponent(photon.name)}${openApiRoutePath}`;

        // Find existing method metadata if possible, although they are mostly filtered out.
        // We will just generate a generic operation.
        const operation: Record<string, any> = {
          operationId,
          summary: `HTTP ${route.method} route ${route.path}`,
          tags: [photon.name],
          ...(pathParams.length > 0 && {
            parameters: pathParams.map((name) => ({
              name,
              in: 'path',
              required: true,
              schema: { type: 'string' },
            })),
          }),
        };

        // For POST/PUT/PATCH, we might expect a body but without schema it's loose
        if (['POST', 'PUT', 'PATCH'].includes(route.method.toUpperCase())) {
          operation.requestBody = {
            content: {
              'application/json': { schema: { type: 'object' } },
            },
          };
        }

        operation.responses = {
          '200': { description: 'Successful execution' },
        };

        if (route.format) {
          operation['x-output-format'] = route.format;
        }

        if (!paths[openApiPath]) {
          paths[openApiPath] = {};
        }
        paths[openApiPath][route.method.toLowerCase()] = operation;
      }
    }
  }

  // Add unconfigured photons as x-unconfigured extension
  const unconfiguredPhotons = photons.filter((p) => !p.configured);

  const spec: OpenAPIDocument = {
    openapi: '3.1.0',
    info: {
      title: 'Photon Beam API',
      version: '1.0.0',
      description:
        'Auto-generated OpenAPI specification for Photon methods. Supports standard JSON Schema with UI extensions.',
    },
    servers: [
      {
        url: serverUrl,
        description: 'Local Beam server',
      },
    ],
    tags,
    paths,
    components: {
      securitySchemes: {
        PhotonBearer: { type: 'http', scheme: 'bearer' },
        PhotonRequest: { type: 'apiKey', in: 'header', name: 'X-Photon-Request' },
      },
    },
  };

  // Add unconfigured photons info as extension
  if (unconfiguredPhotons.length > 0) {
    spec['x-unconfigured-photons'] = unconfiguredPhotons.map((p) => ({
      name: p.name,
      requiredParams: p.requiredParams,
      errorMessage: p.errorMessage,
    }));
  }

  return spec;
}

/**
 * Convert internal JSON Schema to OpenAPI 3.1 compatible schema
 * Maps custom properties to standard or x-* extensions
 */
function convertToOpenAPISchema(schema: any): Record<string, any> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object' };
  }

  const result: any = {};

  // Copy standard JSON Schema properties
  const standardProps = [
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'const',
    'default',
    'description',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'pattern',
    'format',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    '$ref',
    'title',
    'examples',
    'deprecated',
    'readOnly',
    'writeOnly',
    'nullable',
    'multipleOf',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'uniqueItems',
    'additionalProperties',
  ];

  for (const prop of standardProps) {
    if (schema[prop] !== undefined) {
      result[prop] = schema[prop];
    }
  }

  // Map custom Photon properties to x-* extensions
  const extensionMap: Record<string, string> = {
    accept: 'x-accept',
    field: 'x-field',
    hint: 'x-hint',
    placeholder: 'x-placeholder',
    hidden: 'x-hidden',
  };

  for (const [internal, extension] of Object.entries(extensionMap)) {
    if (schema[internal] !== undefined) {
      result[extension] = schema[internal];
    }
  }

  // Recursively process nested properties
  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, value]) => [key, convertToOpenAPISchema(value)])
    );
  }

  // Process array items
  if (result.items) {
    result.items = convertToOpenAPISchema(result.items);
  }

  // Process allOf/anyOf/oneOf
  for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
    if (result[combinator]) {
      result[combinator] = result[combinator].map((s: any) => convertToOpenAPISchema(s));
    }
  }

  return result;
}

/**
 * Check if schema has properties (i.e., expects request body)
 */
function hasProperties(schema: any): boolean {
  return (
    schema &&
    typeof schema === 'object' &&
    schema.properties &&
    Object.keys(schema.properties).length > 0
  );
}
