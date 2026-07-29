/**
 * Small, dependency-free model-provider adapters.
 *
 * These are the preferred replacement for MCP sampling in new Photon code.
 * They deliberately expose one stable Photon interface instead of leaking a
 * provider SDK into photon method signatures.
 */

export interface ModelProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelCompletionRequest {
  prompt?: string;
  messages?: ModelProviderMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  signal?: AbortSignal;
}

export interface ModelCompletionResult {
  text: string;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ModelProvider {
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResult>;
}

interface ProviderBaseOptions {
  apiKey: string | (() => string | Promise<string>);
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

export interface OpenAICompatibleProviderOptions extends ProviderBaseOptions {
  organization?: string;
  project?: string;
}

export interface AnthropicProviderOptions extends ProviderBaseOptions {
  anthropicVersion?: string;
}

function normalizeRequest(request: ModelCompletionRequest): {
  messages: ModelProviderMessage[];
  maxTokens: number;
} {
  const messages = request.messages?.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string'
  );
  const normalizedMessages =
    messages && messages.length > 0
      ? messages
      : typeof request.prompt === 'string' && request.prompt.length > 0
        ? [{ role: 'user' as const, content: request.prompt }]
        : [];
  if (normalizedMessages.length === 0) {
    throw new TypeError('Model completion requires prompt or messages');
  }
  const maxTokens = request.maxTokens === undefined ? 1024 : Math.floor(Number(request.maxTokens));
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new TypeError('maxTokens must be a positive finite number');
  }
  return { messages: normalizedMessages, maxTokens };
}

async function resolveApiKey(apiKey: string | (() => string | Promise<string>)): Promise<string> {
  const value = typeof apiKey === 'function' ? await apiKey() : apiKey;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Model provider API key is not configured');
  }
  return value;
}

function providerFetch(fetchOverride?: typeof globalThis.fetch): typeof globalThis.fetch {
  const implementation = fetchOverride ?? globalThis.fetch;
  if (typeof implementation !== 'function') {
    throw new Error('A Fetch API implementation is required for model-provider adapters');
  }
  return implementation;
}

function endpoint(baseUrl: string | undefined, fallback: string, path: string): string {
  return `${(baseUrl ?? fallback).replace(/\/+$/, '')}${path}`;
}

async function parseProviderResponse(response: Response, provider: string): Promise<any> {
  let body: any;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const providerMessage =
      typeof body?.error?.message === 'string'
        ? body.error.message
        : typeof body?.message === 'string'
          ? body.message
          : `${response.status} ${response.statusText}`.trim();
    throw new Error(`${provider} request failed: ${providerMessage.slice(0, 512)}`);
  }
  return body;
}

export class OpenAICompatibleProvider implements ModelProvider {
  constructor(private readonly options: OpenAICompatibleProviderOptions) {}

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const { messages, maxTokens } = normalizeRequest(request);
    const apiKey = await resolveApiKey(this.options.apiKey);
    const response = await providerFetch(this.options.fetch)(
      endpoint(this.options.baseUrl, 'https://api.openai.com/v1', '/chat/completions'),
      {
        method: 'POST',
        signal: request.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...(this.options.organization
            ? { 'openai-organization': this.options.organization }
            : {}),
          ...(this.options.project ? { 'openai-project': this.options.project } : {}),
          ...this.options.headers,
        },
        body: JSON.stringify({
          model: request.model ?? this.options.model,
          messages: [
            ...(request.systemPrompt
              ? [{ role: 'system' as const, content: request.systemPrompt }]
              : []),
            ...messages,
          ],
          max_tokens: maxTokens,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        }),
      }
    );
    const body = await parseProviderResponse(response, 'OpenAI-compatible provider');
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new Error('OpenAI-compatible provider returned no text content');
    }
    return {
      text,
      ...(typeof body.model === 'string' ? { model: body.model } : {}),
      ...(body.usage
        ? {
            usage: {
              ...(typeof body.usage.prompt_tokens === 'number'
                ? { inputTokens: body.usage.prompt_tokens }
                : {}),
              ...(typeof body.usage.completion_tokens === 'number'
                ? { outputTokens: body.usage.completion_tokens }
                : {}),
            },
          }
        : {}),
    };
  }
}

export class AnthropicProvider implements ModelProvider {
  constructor(private readonly options: AnthropicProviderOptions) {}

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const { messages, maxTokens } = normalizeRequest(request);
    const apiKey = await resolveApiKey(this.options.apiKey);
    const response = await providerFetch(this.options.fetch)(
      endpoint(this.options.baseUrl, 'https://api.anthropic.com/v1', '/messages'),
      {
        method: 'POST',
        signal: request.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': this.options.anthropicVersion ?? '2023-06-01',
          'content-type': 'application/json',
          ...this.options.headers,
        },
        body: JSON.stringify({
          model: request.model ?? this.options.model,
          messages,
          max_tokens: maxTokens,
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        }),
      }
    );
    const body = await parseProviderResponse(response, 'Anthropic provider');
    const text = Array.isArray(body?.content)
      ? body.content
          .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text)
          .join('')
      : '';
    if (!text) throw new Error('Anthropic provider returned no text content');
    return {
      text,
      ...(typeof body.model === 'string' ? { model: body.model } : {}),
      ...(body.usage
        ? {
            usage: {
              ...(typeof body.usage.input_tokens === 'number'
                ? { inputTokens: body.usage.input_tokens }
                : {}),
              ...(typeof body.usage.output_tokens === 'number'
                ? { outputTokens: body.usage.output_tokens }
                : {}),
            },
          }
        : {}),
    };
  }
}

/** Convenience helper for code that only needs the generated text. */
export async function generateText(
  provider: ModelProvider,
  request: ModelCompletionRequest
): Promise<string> {
  return (await provider.complete(request)).text;
}
