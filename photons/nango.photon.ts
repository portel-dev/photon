/**
 * Nango
 *
 * Bridge Nango Auth, proxy requests, action functions, and sync records into
 * Photon surfaces. Configure with `NANGO_SECRET_KEY`; optionally override
 * `NANGO_BASE_URL` for self-hosted or regional Nango deployments.
 *
 * @description Use Nango-managed API connections from Photon, Beam, CLI, and MCP.
 * @tags nango integrations oauth api mcp
 * @category integrations
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;
type QueryValue = string | number | boolean | null | undefined;
type QueryObject = Record<string, QueryValue | Record<string, QueryValue>>;

interface NangoResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

interface ConnectSessionParams {
  /**
   * Integration IDs the user is allowed to connect in this session.
   * @example ["github"]
   */
  allowedIntegrations: string[];
  /**
   * Optional tags to attach to the connection, such as end_user_id.
   * @example {"end_user_id":"user_123","organization_id":"org_456"}
   */
  tags?: Record<string, string>;
  /** Convenience tag for the end user ID. */
  endUserId?: string;
  /** Convenience tag for the end user email. */
  endUserEmail?: string;
  /** Convenience tag for the organization ID. */
  organizationId?: string;
}

interface ConnectionQuery {
  /** Nango integration ID / provider config key. */
  integrationId?: string;
  /**
   * Tags to filter by.
   * @example {"end_user_id":"user_123"}
   */
  tags?: Record<string, string>;
}

interface ConnectionParams {
  /** Nango integration ID / provider config key. */
  integrationId: string;
  /** Nango connection ID. */
  connectionId: string;
}

interface ActionParams extends ConnectionParams {
  /** Nango action function name. */
  actionName: string;
  /** Input payload passed to the action function. */
  input?: JsonValue;
  /** Trigger asynchronously and return the action handle instead of waiting. */
  async?: boolean;
  /** Retry count for idempotent async action functions. */
  maxRetries?: number;
}

interface RecordsParams extends ConnectionParams {
  /** Nango record model name. */
  model: string;
  /** Cursor from the previous records response. */
  cursor?: string;
  /** Optional page size if supported by the Nango records endpoint. */
  limit?: number;
}

interface ProxyParams extends ConnectionParams {
  /** HTTP method to use for the external API request. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** External API path, for example `/v3/contacts`. */
  endpoint: string;
  /** Query parameters for the external API request. */
  params?: Record<string, QueryValue>;
  /** JSON body for POST, PUT, and PATCH requests. */
  data?: JsonValue;
  /** Additional headers forwarded to the proxied API request. */
  headers?: Record<string, string>;
  /** Optional retry count handled by Nango. */
  retries?: number;
  /** Optional base URL override for APIs that require it. */
  baseUrlOverride?: string;
}

interface ToolConfigParams {
  /** Nango integration ID / provider config key. */
  integrationId: string;
  /** Tool schema format returned by Nango. */
  format?: 'nango' | 'openai';
}

export default class Nango {
  private readonly apiBaseUrl: string;

  constructor(
    private readonly secretKey: string,
    baseUrl: string = 'https://api.nango.dev'
  ) {
    this.apiBaseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Create a Nango Connect session for a user to authorize an external API.
   *
   * Return the session token/link to the user, then store the resulting
   * connection ID in your app or photon state.
   */
  async createConnectSession(params: ConnectSessionParams) {
    const tags = this.mergeTags(params);

    return this.request('/connect/sessions', {
      method: 'POST',
      body: {
        allowed_integrations: params.allowedIntegrations,
        ...(Object.keys(tags).length ? { tags } : {}),
      },
    });
  }

  /**
   * List Nango connections, optionally filtered by integration and tags.
   *
   * @format table
   */
  async listConnections(params: ConnectionQuery = {}) {
    const query: QueryObject = {};
    if (params.integrationId) query.integration_id = params.integrationId;
    if (params.tags) query.tags = params.tags;

    return this.request('/connections', { query });
  }

  /**
   * Get a single Nango connection.
   */
  async getConnection(params: ConnectionParams) {
    return this.request(`/connections/${encodeURIComponent(params.connectionId)}`, {
      query: { provider_config_key: params.integrationId },
    });
  }

  /**
   * Discover enabled Nango action functions as tool definitions.
   */
  async discoverTools(params: ToolConfigParams) {
    return this.request('/scripts/config', {
      query: {
        provider_config_key: params.integrationId,
        format: params.format || 'openai',
      },
    });
  }

  /**
   * Trigger a Nango action function for a specific user connection.
   */
  async triggerAction(params: ActionParams) {
    return this.request('/action/trigger', {
      method: 'POST',
      headers: {
        'Connection-Id': params.connectionId,
        'Provider-Config-Key': params.integrationId,
        ...(params.async ? { 'X-Async': 'true' } : {}),
        ...(params.maxRetries !== undefined ? { 'X-Max-Retries': String(params.maxRetries) } : {}),
      },
      body: {
        action_name: params.actionName,
        input: params.input ?? {},
      },
    });
  }

  /**
   * Fetch the result of an async Nango action.
   */
  async getAsyncActionResult(params: { actionId: string }) {
    return this.request(`/action/${encodeURIComponent(params.actionId)}`);
  }

  /**
   * List records from a Nango sync cursor.
   */
  async listRecords(params: RecordsParams) {
    return this.request('/records', {
      headers: {
        'Connection-Id': params.connectionId,
        'Provider-Config-Key': params.integrationId,
      },
      query: {
        model: params.model,
        cursor: params.cursor,
        limit: params.limit,
      },
    });
  }

  /**
   * Make an authenticated request to an external API through Nango's proxy.
   */
  async proxyRequest(params: ProxyParams): Promise<NangoResponse> {
    const endpoint = params.endpoint.replace(/^\/+/, '');
    const query: QueryObject = { ...(params.params || {}) };
    if (params.retries !== undefined) query.retries = params.retries;
    if (params.baseUrlOverride) query.base_url_override = params.baseUrlOverride;

    return this.request(`/proxy/${endpoint}`, {
      method: params.method || 'GET',
      headers: {
        'Connection-Id': params.connectionId,
        'Provider-Config-Key': params.integrationId,
        ...(params.headers || {}),
      },
      query,
      body: params.data,
      includeResponseEnvelope: true,
    });
  }

  private mergeTags(params: ConnectSessionParams): Record<string, string> {
    return {
      ...(params.tags || {}),
      ...(params.endUserId ? { end_user_id: params.endUserId } : {}),
      ...(params.endUserEmail ? { end_user_email: params.endUserEmail } : {}),
      ...(params.organizationId ? { organization_id: params.organizationId } : {}),
    };
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      query?: QueryObject;
      body?: JsonValue | JsonObject;
      includeResponseEnvelope?: boolean;
    } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const hasBody = options.body !== undefined && options.method !== 'GET';
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });

    const data = await this.parseResponseBody(response);
    const envelope: NangoResponse = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data,
    };

    if (!response.ok) {
      throw new Error(
        `Nango API request failed (${response.status} ${response.statusText}): ${this.formatErrorBody(data)}`
      );
    }

    return (options.includeResponseEnvelope ? envelope : data) as T;
  }

  private buildUrl(path: string, query?: QueryObject): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.apiBaseUrl);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') {
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (nestedValue !== undefined && nestedValue !== null) {
            url.searchParams.set(`${key}[${nestedKey}]`, String(nestedValue));
          }
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async parseResponseBody(response: Response): Promise<any> {
    if (response.status === 204) return null;

    const text = await response.text();
    if (!text) return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return text;
  }

  private formatErrorBody(data: unknown): string {
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }
}
