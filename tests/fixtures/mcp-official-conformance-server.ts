import http from 'node:http';

const workingDir = process.argv[2];
if (!workingDir) throw new Error('working directory is required');
process.env.PHOTON_DIR = workingDir;

const { handleStreamableHTTP, stopSessionCleanup } =
  await import('../../dist/auto-ui/streamable-http-transport.js');

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lrZ5WQAAAABJRU5ErkJggg==';
const WAV = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const jsonSchema202012 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  $defs: {
    address: {
      $anchor: 'addressDef',
      type: 'object',
      properties: { street: { type: 'string' }, city: { type: 'string' } },
    },
  },
  properties: {
    name: { type: 'string' },
    address: { $ref: '#/$defs/address' },
    contactMethod: { type: 'string', enum: ['phone', 'email'] },
    phone: { type: 'string' },
    email: { type: 'string' },
  },
  allOf: [{ anyOf: [{ required: ['phone'] }, { required: ['email'] }] }],
  if: {
    properties: { contactMethod: { const: 'phone' } },
    required: ['contactMethod'],
  },
  then: { required: ['phone'] },
  else: { required: ['email'] },
  additionalProperties: false,
};

const toolNames = [
  'test_simple_text',
  'test_image_content',
  'test_audio_content',
  'test_embedded_resource',
  'test_multiple_content_types',
  'test_error_handling',
  'test_tool_with_progress',
  'test_tool_with_logging',
  'test_sampling',
  'test_elicitation',
  'test_elicitation_sep1034_defaults',
  'test_elicitation_sep1330_enums',
  'test_missing_capability',
  'test_streaming_elicitation',
  'test_logging_tool',
  'test_trigger_tool_change',
  'test_trigger_prompt_change',
  'test_input_required_result_elicitation',
  'test_input_required_result_sampling',
  'test_input_required_result_list_roots',
  'test_input_required_result_request_state',
  'test_input_required_result_multiple_inputs',
  'test_input_required_result_multi_round',
  'test_input_required_result_tampered_state',
  'test_input_required_result_capabilities',
];

const methods: any[] = toolNames.map((name) => ({
  name,
  description: `Official MCP conformance fixture: ${name}`,
  params: emptySchema,
  returns: {},
  ...(name === 'test_missing_capability' ? { requiredClientCapabilities: ['sampling'] } : {}),
}));
methods.push(
  {
    name: 'greet',
    description: 'Synchronous greeting',
    params: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
    returns: {},
    taskSupport: 'none',
  },
  {
    name: 'slow_compute',
    description: 'Durable computation',
    params: {
      type: 'object',
      properties: {
        seconds: { type: 'number' },
        label: { type: 'string' },
      },
      required: ['seconds'],
      additionalProperties: false,
    },
    returns: {},
    isAsync: true,
    taskSupport: 'optional',
  },
  {
    name: 'failing_job',
    description: 'Required failing task',
    params: emptySchema,
    returns: {},
    isAsync: true,
    taskSupport: 'required',
  },
  {
    name: 'protocol_error_job',
    description: 'Protocol-error task',
    params: emptySchema,
    returns: {},
    isAsync: true,
    taskSupport: 'optional',
  },
  {
    name: 'confirm_delete',
    description: 'Task that requires confirmation',
    params: {
      type: 'object',
      properties: { filename: { type: 'string' } },
      required: ['filename'],
      additionalProperties: false,
    },
    returns: {},
    hasGeneratorAsks: true,
    taskSupport: 'optional',
  },
  {
    name: 'multi_input',
    description: 'Task requiring multiple inputs',
    params: emptySchema,
    returns: {},
    hasGeneratorAsks: true,
    taskSupport: 'optional',
  },
  {
    name: 'test_tool_with_task',
    description: 'MRTR then task composition',
    params: emptySchema,
    returns: {},
    taskSupport: 'required',
    taskAfterInput: true,
    hasGeneratorAsks: true,
  }
);
for (const method of methods) {
  if (method.name === 'test_sampling') {
    method.params = {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
      additionalProperties: false,
    };
  }
  if (method.name === 'test_elicitation') {
    method.params = {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    };
  }
}
methods.push({
  name: 'json_schema_2020_12_tool',
  description: 'Tool with JSON Schema 2020-12 features',
  params: jsonSchema202012,
  returns: {},
});
methods.push({
  name: 'test_custom_header',
  description: 'Custom routing header fixture',
  params: {
    type: 'object',
    properties: {
      route: { type: 'string', 'x-mcp-header': 'Route', minLength: 1 },
    },
    required: ['route'],
    additionalProperties: false,
  },
  returns: {},
});

const templates = [
  {
    name: 'test_simple_prompt',
    description: 'Simple prompt',
    inputSchema: emptySchema,
  },
  {
    name: 'test_prompt_with_arguments',
    description: 'Prompt with arguments',
    inputSchema: {
      type: 'object',
      properties: {
        arg1: { type: 'string', description: 'First argument' },
        arg2: { type: 'number', description: 'Second argument' },
      },
      required: ['arg1'],
    },
  },
  {
    name: 'test_prompt_with_embedded_resource',
    description: 'Prompt with embedded resource',
    inputSchema: {
      type: 'object',
      properties: { resource_uri: { type: 'string' } },
      required: ['resource_uri'],
    },
  },
  {
    name: 'test_prompt_with_image',
    description: 'Prompt with image',
    inputSchema: emptySchema,
  },
  {
    name: 'test_input_required_result_prompt',
    description: 'Prompt requiring input',
    inputSchema: emptySchema,
  },
];

const statics = [
  {
    name: 'static_text',
    uri: 'test://static-text',
    description: 'Static text',
    mimeType: 'text/plain',
  },
  {
    name: 'static_binary',
    uri: 'test://static-binary',
    description: 'Static binary',
    mimeType: 'image/png',
  },
  {
    name: 'template_data',
    uri: 'test://template/{id}/data',
    description: 'Template data',
    mimeType: 'application/json',
  },
  {
    name: 'watched_resource',
    uri: 'test://watched-resource',
    description: 'Watched resource',
    mimeType: 'text/plain',
  },
];

const instance = Object.fromEntries(
  [...methods, ...templates, ...statics].map(({ name }) => [name, () => undefined])
);
const mcp = { instance, templates, statics };

function authored(content: unknown[], isError = false) {
  return { _mcpResult: true, content, isError };
}

const context: any = {
  photons: [
    {
      id: 'official-conformance',
      name: 'conformance',
      path: `${workingDir}/conformance.photon.ts`,
      configured: true,
      methods,
    },
  ],
  photonMCPs: new Map([['conformance', mcp]]),
  externalMCPs: [],
  externalMCPClients: new Map(),
  externalMCPSDKClients: new Map(),
  reconnectExternalMCP: async () => false,
  loadUIAsset: async () => null,
  configurePhoton: async () => ({ success: false }),
  reloadPhoton: async () => ({ success: false }),
  removePhoton: async () => ({ success: false }),
  updateMetadata: () => undefined,
  generatePhotonHelp: () => '',
  broadcast: () => undefined,
  workingDir,
  singleServerNames: true,
  loader: {
    executeTool: async (
      _target: unknown,
      name: string,
      args: Record<string, unknown>,
      options: {
        outputHandler?: (value: unknown) => void;
        inputProvider?: (ask: Record<string, unknown>) => Promise<unknown>;
        samplingProvider?: (params: Record<string, unknown>) => Promise<unknown>;
        rootsProvider?: (params?: Record<string, unknown>) => Promise<unknown>;
        inputRequestProvider?: (
          requests: Record<
            string,
            {
              method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
              params?: Record<string, unknown>;
            }
          >
        ) => Promise<Record<string, unknown>>;
      } = {}
    ) => {
      switch (name) {
        case 'test_simple_text':
          return authored([{ type: 'text', text: 'This is a simple text response for testing.' }]);
        case 'test_image_content':
          return authored([{ type: 'image', data: PNG, mimeType: 'image/png' }]);
        case 'test_audio_content':
          return authored([{ type: 'audio', data: WAV, mimeType: 'audio/wav' }]);
        case 'test_embedded_resource':
          return authored([
            {
              type: 'resource',
              resource: {
                uri: 'test://embedded-resource',
                mimeType: 'text/plain',
                text: 'This is an embedded resource content.',
              },
            },
          ]);
        case 'test_multiple_content_types':
          return authored([
            { type: 'text', text: 'Multiple content types test:' },
            { type: 'image', data: PNG, mimeType: 'image/png' },
            {
              type: 'resource',
              resource: {
                uri: 'test://mixed-content-resource',
                mimeType: 'application/json',
                text: '{"test":"data","value":123}',
              },
            },
          ]);
        case 'test_error_handling':
          return authored([{ type: 'text', text: 'Intentional test error' }], true);
        case 'test_tool_with_progress':
          for (const value of [0, 0.5, 1]) {
            options.outputHandler?.({ emit: 'progress', value });
          }
          return authored([{ type: 'text', text: 'Progress complete' }]);
        case 'test_tool_with_logging':
        case 'test_logging_tool':
          for (const data of [
            'Tool execution started',
            'Tool processing data',
            'Tool execution completed',
          ]) {
            options.outputHandler?.({
              emit: 'log',
              level: 'info',
              logger: 'conformance',
              data,
            });
          }
          return authored([{ type: 'text', text: 'Logging complete' }]);
        case 'test_sampling': {
          const sampled = await options.samplingProvider?.({
            messages: [
              { role: 'user', content: { type: 'text', text: String(args.prompt ?? 'test') } },
            ],
            maxTokens: 100,
          });
          return authored([{ type: 'text', text: JSON.stringify(sampled ?? {}) }]);
        }
        case 'test_elicitation':
        case 'test_streaming_elicitation': {
          const answer = await options.inputProvider?.({
            id: 'user',
            mode: 'form',
            message: 'Enter a username',
            requestedSchema: {
              type: 'object',
              properties: { username: { type: 'string' } },
              required: ['username'],
            },
          });
          return authored([{ type: 'text', text: JSON.stringify(answer ?? {}) }]);
        }
        case 'test_elicitation_sep1034_defaults': {
          const answer = await options.inputProvider?.({
            id: 'defaults',
            mode: 'form',
            message: 'Defaults',
            requestedSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', default: 'John Doe' },
                age: { type: 'integer', default: 30 },
                score: { type: 'number', default: 95.5 },
                status: {
                  type: 'string',
                  enum: ['active', 'inactive', 'pending'],
                  default: 'active',
                },
                verified: { type: 'boolean', default: true },
              },
            },
          });
          return authored([{ type: 'text', text: JSON.stringify(answer ?? {}) }]);
        }
        case 'test_elicitation_sep1330_enums': {
          const answer = await options.inputProvider?.({
            id: 'enums',
            mode: 'form',
            message: 'Enums',
            requestedSchema: {
              type: 'object',
              properties: {
                untitledSingle: {
                  type: 'string',
                  enum: ['option1', 'option2', 'option3'],
                },
                titledSingle: {
                  type: 'string',
                  oneOf: [
                    { const: 'value1', title: 'First Option' },
                    { const: 'value2', title: 'Second Option' },
                    { const: 'value3', title: 'Third Option' },
                  ],
                },
                legacyEnum: {
                  type: 'string',
                  enum: ['opt1', 'opt2', 'opt3'],
                  enumNames: ['Option One', 'Option Two', 'Option Three'],
                },
                untitledMulti: {
                  type: 'array',
                  items: { type: 'string', enum: ['option1', 'option2', 'option3'] },
                },
                titledMulti: {
                  type: 'array',
                  items: {
                    anyOf: [
                      { const: 'value1', title: 'First Choice' },
                      { const: 'value2', title: 'Second Choice' },
                      { const: 'value3', title: 'Third Choice' },
                    ],
                  },
                },
              },
            },
          });
          return authored([{ type: 'text', text: JSON.stringify(answer ?? {}) }]);
        }
        case 'test_missing_capability':
          return authored([{ type: 'text', text: 'sampling declared' }]);
        case 'test_input_required_result_elicitation':
        case 'test_input_required_result_request_state':
        case 'test_input_required_result_tampered_state': {
          const answer = await options.inputProvider?.({
            id: 'user_name',
            mode: 'form',
            message: 'What is your name?',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          });
          return authored([{ type: 'text', text: `Hello, ${JSON.stringify(answer)}!` }]);
        }
        case 'test_input_required_result_sampling': {
          const answer = await options.samplingProvider?.({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: 'What is the capital of France?' },
              },
            ],
            maxTokens: 100,
          });
          return authored([{ type: 'text', text: JSON.stringify(answer) }]);
        }
        case 'test_input_required_result_list_roots': {
          const answer = await options.rootsProvider?.({});
          return authored([{ type: 'text', text: JSON.stringify(answer) }]);
        }
        case 'test_input_required_result_multiple_inputs': {
          const responses = await options.inputRequestProvider?.({
            user_name: {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'Name?',
                requestedSchema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                  required: ['name'],
                },
              },
            },
            greeting: {
              method: 'sampling/createMessage',
              params: {
                messages: [{ role: 'user', content: { type: 'text', text: 'Give a greeting' } }],
                maxTokens: 50,
              },
            },
            client_roots: { method: 'roots/list', params: {} },
          });
          return authored([{ type: 'text', text: JSON.stringify(responses) }]);
        }
        case 'test_input_required_result_multi_round': {
          const first = await options.inputProvider?.({
            id: 'round_one',
            mode: 'form',
            message: 'Round one?',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          });
          const second = await options.inputProvider?.({
            id: 'round_two',
            mode: 'form',
            message: 'Round two?',
            requestedSchema: {
              type: 'object',
              properties: { color: { type: 'string' } },
              required: ['color'],
            },
          });
          return authored([{ type: 'text', text: JSON.stringify({ first, second }) }]);
        }
        case 'test_input_required_result_capabilities': {
          const answer = await options.samplingProvider?.({
            messages: [{ role: 'user', content: { type: 'text', text: 'Sampling only' } }],
            maxTokens: 50,
          });
          return authored([{ type: 'text', text: JSON.stringify(answer) }]);
        }
        case 'test_trigger_tool_change':
        case 'test_trigger_prompt_change':
          return authored([{ type: 'text', text: 'change triggered' }]);
        case 'test_custom_header':
          return authored([{ type: 'text', text: String(args.route) }]);
        case 'greet':
          return authored([{ type: 'text', text: `Hello, ${String(args.name)}!` }]);
        case 'slow_compute':
          await new Promise((resolve) => setTimeout(resolve, 75));
          return authored([
            {
              type: 'text',
              text: `Completed ${String(args.label ?? 'compute')}`,
            },
          ]);
        case 'failing_job':
          throw new Error('Intentional task failure');
        case 'protocol_error_job':
          throw Object.assign(new Error('Intentional protocol task failure'), {
            mcpProtocolError: {
              code: -32603,
              message: 'Intentional protocol task failure',
            },
          });
        case 'confirm_delete': {
          const confirmation = await options.inputProvider?.({
            id: 'confirm',
            ask: 'confirm',
            message: `Delete ${String(args.filename)}?`,
          });
          return authored([
            { type: 'text', text: `Delete confirmation: ${JSON.stringify(confirmation)}` },
          ]);
        }
        case 'multi_input': {
          const responses = await options.inputRequestProvider?.({
            first: {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'First input',
                requestedSchema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, confirm: { type: 'boolean' } },
                  required: ['name', 'confirm'],
                },
              },
            },
            second: {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'Second input',
                requestedSchema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, confirm: { type: 'boolean' } },
                  required: ['name', 'confirm'],
                },
              },
            },
          });
          return authored([{ type: 'text', text: JSON.stringify(responses) }]);
        }
        case 'test_tool_with_task': {
          const answer = await options.inputProvider?.({
            id: 'user_name',
            mode: 'form',
            message: 'What is your name?',
            requestedSchema: {
              type: 'object',
              properties: { user_name: { type: 'string' } },
              required: ['user_name'],
            },
          });
          return authored([
            {
              type: 'text',
              text: `Task created for ${JSON.stringify(answer)}`,
            },
          ]);
        }
        case 'static_text':
          return 'This is the content of the static text resource.';
        case 'static_binary':
          return { blob: PNG };
        case 'template_data':
          return JSON.stringify({
            id: args.id,
            templateTest: true,
            data: `Data for ID: ${String(args.id)}`,
          });
        case 'watched_resource':
          return 'Watched resource content';
        case 'test_simple_prompt':
          return {
            messages: [{ role: 'user', content: { type: 'text', text: 'Simple test prompt' } }],
          };
        case 'test_prompt_with_arguments':
          return {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Arguments: ${String(args.arg1)}, ${String(args.arg2 ?? '')}`,
                },
              },
            ],
          };
        case 'test_prompt_with_embedded_resource':
          return {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'resource',
                  resource: {
                    uri: String(args.resource_uri),
                    mimeType: 'text/plain',
                    text: 'Embedded prompt resource',
                  },
                },
              },
            ],
          };
        case 'test_prompt_with_image':
          return {
            messages: [
              { role: 'user', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
            ],
          };
        case 'test_input_required_result_prompt': {
          const answer = await options.inputProvider?.({
            id: 'user_context',
            mode: 'form',
            message: 'What context should the prompt use?',
            requestedSchema: {
              type: 'object',
              properties: { context: { type: 'string' } },
              required: ['context'],
            },
          });
          return {
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: `Context: ${JSON.stringify(answer)}` },
              },
            ],
          };
        }
        default:
          return authored([{ type: 'text', text: `Executed ${name}` }]);
      }
    },
  },
};

const server = http.createServer(async (request, response) => {
  if (process.env.MCP_FIXTURE_DEBUG === '1') {
    process.stderr.write(`${request.method} ${request.url} ${JSON.stringify(request.headers)}\n`);
  }
  if (!(await handleStreamableHTTP(request, response, context))) {
    response.writeHead(404);
    response.end();
  }
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('failed to bind');
process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);

const shutdown = () => {
  stopSessionCleanup();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
