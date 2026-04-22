/**
 * MCP Client Service (transport-only SDK variant).
 *
 * Drop-in replacement for mcp-client.ts's protocol layer, built on
 * `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport` — the
 * SDK's wire-level transport only, without its `Client` class (which
 * pulls Zod and ~60 KB extra gzipped).
 *
 * What this file owns:
 *   - JSON-RPC request/response correlation (pending-request map)
 *   - Progress event routing by progressToken
 *   - Idle-reset timeout per in-flight request (resets on any
 *     notifications/progress whose token matches a pending request)
 *   - Cancellation: abort signal → notifications/cancelled emission
 *   - EventEmitter fan-out for beam/* and other custom notifications
 *
 * What the SDK transport handles:
 *   - HTTP POST sends + SSE stream receives (Streamable HTTP spec)
 *   - Mcp-Session-Id header threading
 *   - SSE reconnection with exponential backoff + resumption tokens
 *   - DELETE on close for server-side session cleanup
 *   - 401 handling via optional authProvider
 *
 * Not yet migrated from mcp-client.ts (intentional scope limit):
 *   - Auth popup / localStorage / window message glue
 *   - ConfigurationSchema introspection (beam-specific, non-MCP)
 *   - Queue-for-retry on connection drop
 *   - ResourceServer plumbing
 * Those live in the outer MCPClientService wrapper; this file is the
 * protocol engine they'd sit on top of.
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };

interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type Listener = (data?: unknown) => void;

/**
 * Default idle timeout for any tool call: if no progress notification
 * arrives for this long, the request is aborted. Each matching progress
 * event resets the clock. 2 minutes is long enough for any reasonable
 * network/LLM pause, short enough to kill a truly hung method.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/**
 * Hard ceiling for a single request regardless of progress activity.
 * A method that somehow emits progress forever still gets killed here.
 */
const DEFAULT_MAX_TIMEOUT_MS = 30 * 60_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  progressToken?: string | number;
  onProgress?: (params: Record<string, unknown>) => void;
  /** Idle timer — resets on matching progress. Kills the request on fire. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Absolute ceiling — fires regardless of progress activity. */
  maxTimer?: ReturnType<typeof setTimeout>;
  idleTimeoutMs: number;
  /** AbortSignal listener to clean up on request completion. */
  abortCleanup?: () => void;
}

export interface CallOptions {
  progressToken?: string | number;
  onProgress?: (params: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** Idle timeout; reset on each progress notification. Default 2 min. */
  idleTimeoutMs?: number;
  /** Hard ceiling regardless of progress. Default 30 min. */
  maxTimeoutMs?: number;
}

export interface MCPClientSDKOptions {
  authToken?: string;
  /**
   * Optional fetch override. The outer MCPClientService wraps window.fetch
   * here to intercept 401s and harvest WWW-Authenticate → resource_metadata_url
   * before the SDK throws, without needing the SDK's built-in OAuth provider.
   */
  fetch?: typeof fetch;
}

export class MCPClientSDK {
  private transport: StreamableHTTPClientTransport;
  private listeners = new Map<string, Set<Listener>>();
  private pending = new Map<string | number, PendingRequest>();
  private nextId = 1;
  private connected = false;

  constructor(baseUrl: string, opts: MCPClientSDKOptions = {}) {
    this.transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: opts.authToken
        ? { headers: { Authorization: `Bearer ${opts.authToken}` } }
        : undefined,
      fetch: opts.fetch,
      // SDK's default maxRetries is 2. We match the old client's
      // never-give-up behavior so the user doesn't need to refresh
      // after a daemon restart or transient network blip.
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: Number.MAX_SAFE_INTEGER,
      },
    });

    this.transport.onmessage = (msg) => this.handleMessage(msg as JSONRPCMessage);
    this.transport.onclose = () => {
      this.connected = false;
      this.emit('disconnected');
    };
    this.transport.onerror = (err) => this.emit('error', err);
  }

  async connect(): Promise<void> {
    await this.transport.start();
    this.connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    try {
      await this.transport.terminateSession();
    } catch {
      // Server may not support DELETE; fall through to close.
    }
    await this.transport.close();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  // ── Request/response correlation ─────────────────────────────────

  /**
   * Send a JSON-RPC request and await the response. Per-request timeout
   * is idle-reset: each `notifications/progress` whose progressToken
   * matches this request's resets the clock.
   */
  async request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {}
  ): Promise<T> {
    const id = this.nextId++;
    const {
      progressToken,
      onProgress,
      signal,
      idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
      maxTimeoutMs = DEFAULT_MAX_TIMEOUT_MS,
    } = options;

    const messageParams: Record<string, unknown> = { ...params };
    if (progressToken != null) {
      messageParams._meta = {
        ...(messageParams._meta as Record<string, unknown> | undefined),
        progressToken,
      };
    }

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: (v) => resolve(v as T),
        reject,
        progressToken,
        onProgress,
        idleTimeoutMs,
      };

      const clearAndFail = (err: Error) => {
        this.finalize(id);
        reject(err);
      };

      // Idle timer (reset on matching progress).
      pending.idleTimer = setTimeout(() => {
        this.sendCancel(id, 'idle-timeout');
        clearAndFail(
          new Error(`Request ${method} timed out after ${idleTimeoutMs}ms of no progress`)
        );
      }, idleTimeoutMs);

      // Hard ceiling regardless of progress.
      pending.maxTimer = setTimeout(() => {
        this.sendCancel(id, 'max-timeout');
        clearAndFail(new Error(`Request ${method} exceeded max total timeout ${maxTimeoutMs}ms`));
      }, maxTimeoutMs);

      // AbortSignal → cancel notification + reject.
      if (signal) {
        if (signal.aborted) {
          clearAndFail(new Error('Request aborted before send'));
          return;
        }
        const onAbort = () => {
          this.sendCancel(id, 'client-abort');
          clearAndFail(new Error(signal.reason?.toString() || 'Request aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }

      this.pending.set(id, pending);

      this.transport
        .send({ jsonrpc: '2.0', id, method, params: messageParams })
        .catch((err) => clearAndFail(err instanceof Error ? err : new Error(String(err))));
    });
  }

  /**
   * Send a JSON-RPC notification (fire-and-forget, no id). Used for
   * `notifications/initialized`, `beam/viewing`, etc.
   */
  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.transport.send({ jsonrpc: '2.0', method, params });
  }

  private finalize(id: string | number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    pending.abortCleanup?.();
    this.pending.delete(id);
  }

  private sendCancel(id: string | number, reason: string): void {
    void this.transport
      .send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: id, reason },
      })
      .catch(() => {
        // Cancellation is best-effort. If it fails, we've already rejected
        // the caller's promise; further retries add nothing.
      });
  }

  /**
   * Convenience for callTool that wires progressToken + idle-reset +
   * optional cancellation in one call.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: CallOptions = {}
  ): Promise<unknown> {
    // If the caller hands us a progressToken and onProgress callback, use
    // them. If only progressToken, emit 'progress' events on our bus so
    // existing BeamUI listeners keep working unchanged.
    const effectiveOnProgress =
      options.onProgress ??
      (options.progressToken != null
        ? (p: Record<string, unknown>) =>
            this.emit('progress', { progressToken: options.progressToken, ...p })
        : undefined);
    return this.request(
      'tools/call',
      { name, arguments: args },
      {
        ...options,
        onProgress: effectiveOnProgress,
      }
    );
  }

  async listTools(): Promise<unknown[]> {
    const res = await this.request<{ tools?: unknown[] }>('tools/list', {});
    return res?.tools ?? [];
  }

  async listResources(): Promise<unknown[]> {
    const res = await this.request<{ resources?: unknown[] }>('resources/list', {});
    return res?.resources ?? [];
  }

  async readResource(uri: string): Promise<unknown> {
    return this.request('resources/read', { uri });
  }

  // ── Incoming message routing ─────────────────────────────────────

  private handleMessage(msg: JSONRPCMessage): void {
    // Detect recovery. If messages start flowing again after the
    // transport fired `onclose` (which flipped `connected` to false),
    // the SDK's internal reconnection logic has re-established the
    // SSE stream. Surface that as a `reconnected` event so callers
    // (beam-app restores the active stateful instance, refreshes the
    // tool list, etc.) can recover their own state — silently flipping
    // the flag would leave them frozen with stale data.
    if (!this.connected) {
      this.connected = true;
      this.emit('reconnected');
    }

    // Response (has id, no method).
    if (msg.id != null && !msg.method) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.finalize(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Notification — progress first (idle-timer reset + per-request
    // callback), then fan out to listeners.
    if (msg.method === 'notifications/progress' && msg.params) {
      const { progressToken } = msg.params as { progressToken?: string | number };
      if (progressToken != null) {
        for (const [requestId, pending] of this.pending) {
          if (pending.progressToken === progressToken) {
            // Reset idle timer — progress proves the server is alive.
            if (pending.idleTimer) clearTimeout(pending.idleTimer);
            pending.idleTimer = setTimeout(() => {
              // MCP `notifications/cancelled` matches the original
              // JSON-RPC request id, NOT the progressToken. Passing
              // progressToken here lets the browser reject the local
              // promise but leaves the server-side tool running
              // orphaned — the idle-timeout fired, the client gave up,
              // and the photon keeps consuming resources. Cancel by
              // requestId so the server actually tears down the call.
              this.sendCancel(requestId, 'idle-timeout');
              pending.reject(
                new Error(`Request timed out after ${pending.idleTimeoutMs}ms of no progress`)
              );
              this.finalize(requestId);
            }, pending.idleTimeoutMs);
            pending.onProgress?.(msg.params);
            break;
          }
        }
      }
    }

    if (msg.method) {
      this.emit(msg.method, msg.params);
    }
  }

  // ── EventEmitter shim (same shape as mcp-client.ts) ──────────────

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(data);
      } catch {
        // Listener errors are contained — a buggy consumer never takes
        // down the transport.
      }
    });
  }
}
