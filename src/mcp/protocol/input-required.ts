import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  futimesSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type MCPInputRequestMethod = 'elicitation/create' | 'sampling/createMessage' | 'roots/list';

export interface MCPInputRequest {
  method: MCPInputRequestMethod;
  params?: Record<string, unknown>;
}

export type MCPInputRequests = Record<string, MCPInputRequest>;
export type MCPInputResponses = Record<string, unknown>;

export interface MCPInputRequiredResult {
  resultType: 'input_required';
  inputRequests?: MCPInputRequests;
  requestState?: string;
}

export interface StatelessInputBinding {
  protocolVersion: string;
  principal: string;
  scope: string;
  appSession: string;
  method: string;
  target: string;
  argumentsHash: string;
}

export interface StatelessInputRuntime {
  readonly signal: AbortSignal;
  request(inputRequest: MCPInputRequest, preferredKey?: string): Promise<unknown>;
  requestMany(inputRequests: MCPInputRequests): Promise<MCPInputResponses>;
}

export type StatelessInputTurn<T> =
  | { kind: 'complete'; value: T }
  | { kind: 'input-required'; result: MCPInputRequiredResult };

export type StatelessInputStateErrorKind =
  | 'invalid'
  | 'expired'
  | 'mismatch'
  | 'replay'
  | 'capacity'
  | 'limit'
  | 'unavailable'
  | 'cancelled';

export class StatelessInputStateError extends Error {
  constructor(
    readonly kind: StatelessInputStateErrorKind,
    message = 'Invalid or expired request state'
  ) {
    super(message);
    this.name = 'StatelessInputStateError';
  }
}

export interface StatelessInputStateStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxEntriesPerPrincipal?: number;
  maxRounds?: number;
  maxRequestsPerRound?: number;
  maxValueBytes?: number;
  now?: () => number;
  randomState?: () => string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface PendingInput {
  requests: MCPInputRequests;
  responses: MCPInputResponses;
  deferred: Deferred<MCPInputResponses>;
}

type FlowEvent<T> =
  | { kind: 'input' }
  | { kind: 'complete'; value: T }
  | { kind: 'error'; error: unknown };

interface InputFlow<T> {
  token: string;
  binding: StatelessInputBinding;
  createdAt: number;
  expiresAt: number;
  phase: 'running' | 'waiting' | 'terminal';
  round: number;
  requestIndex: number;
  seenRequestIds: Set<string>;
  controller: AbortController;
  pending?: PendingInput;
  events: FlowEvent<T>[];
  eventWaiters: Array<Deferred<FlowEvent<T>>>;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_ENTRIES_PER_PRINCIPAL = 8;
const DEFAULT_MAX_ROUNDS = 16;
const DEFAULT_MAX_REQUESTS_PER_ROUND = 8;
const DEFAULT_MAX_VALUE_BYTES = 256 * 1024;
const STATE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const INPUT_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requestIdKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

/**
 * RFC 8785-style deterministic JSON ordering for the finite JSON subset MCP
 * permits. This deliberately rejects values JSON.stringify would silently
 * discard or coerce.
 */
export function canonicalizeInputStateValue(
  value: unknown,
  limits: { maxDepth?: number; maxNodes?: number; maxBytes?: number } = {}
): string {
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 10_000;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_VALUE_BYTES;
  let nodes = 0;

  const visit = (candidate: unknown, depth: number): string => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) {
      throw new StatelessInputStateError('limit', 'Input state value exceeds structural limits');
    }
    if (candidate === null) return 'null';
    if (typeof candidate === 'string' || typeof candidate === 'boolean') {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        throw new StatelessInputStateError('invalid', 'Input state value must be finite JSON');
      }
      return Object.is(candidate, -0) ? '0' : JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      return `[${candidate.map((item) => visit(item, depth + 1)).join(',')}]`;
    }
    if (!isRecord(candidate) || Object.getPrototypeOf(candidate) !== Object.prototype) {
      throw new StatelessInputStateError('invalid', 'Input state value must be plain JSON');
    }
    const pairs = Object.keys(candidate)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${visit(candidate[key], depth + 1)}`);
    return `{${pairs.join(',')}}`;
  };

  const encoded = visit(value, 0);
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new StatelessInputStateError('limit', 'Input state value exceeds the byte limit');
  }
  return encoded;
}

export function hashInputStateValue(value: unknown): string {
  return createHash('sha256').update(canonicalizeInputStateValue(value)).digest('base64url');
}

export function sameStatelessInputBinding(
  left: StatelessInputBinding,
  right: StatelessInputBinding
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.principal === right.principal &&
    left.scope === right.scope &&
    left.appSession === right.appSession &&
    left.method === right.method &&
    left.target === right.target &&
    left.argumentsHash === right.argumentsHash
  );
}

function validateInputRequest(value: unknown): asserts value is MCPInputRequest {
  if (!isRecord(value)) {
    throw new StatelessInputStateError('invalid', 'Input request must be an object');
  }
  if (
    value.method !== 'elicitation/create' &&
    value.method !== 'sampling/createMessage' &&
    value.method !== 'roots/list'
  ) {
    throw new StatelessInputStateError('invalid', 'Unsupported MCP input request method');
  }
  if (value.params !== undefined && !isRecord(value.params)) {
    throw new StatelessInputStateError('invalid', 'Input request params must be an object');
  }
}

function validateInputResponse(request: MCPInputRequest, response: unknown): void {
  if (!isRecord(response)) {
    throw new StatelessInputStateError('invalid', 'Input response must be an object');
  }
  switch (request.method) {
    case 'elicitation/create':
      if (
        response.action !== 'accept' &&
        response.action !== 'decline' &&
        response.action !== 'cancel'
      ) {
        throw new StatelessInputStateError(
          'invalid',
          'Elicitation response requires a valid action'
        );
      }
      if (response.content !== undefined && !isRecord(response.content)) {
        throw new StatelessInputStateError(
          'invalid',
          'Elicitation response content must be an object'
        );
      }
      if (
        isRecord(response.content) &&
        Object.values(response.content).some(
          (value) =>
            !(
              typeof value === 'string' ||
              typeof value === 'boolean' ||
              (typeof value === 'number' && Number.isFinite(value)) ||
              (Array.isArray(value) && value.every((item) => typeof item === 'string'))
            )
        )
      ) {
        throw new StatelessInputStateError(
          'invalid',
          'Elicitation response content contains an unsupported value'
        );
      }
      return;
    case 'sampling/createMessage':
      if (response.role !== 'assistant' || response.content === undefined) {
        throw new StatelessInputStateError(
          'invalid',
          'Sampling response requires assistant role and content'
        );
      }
      return;
    case 'roots/list':
      if (!Array.isArray(response.roots)) {
        throw new StatelessInputStateError('invalid', 'Roots response requires a roots array');
      }
      return;
  }
}

export class StatelessInputStateStore {
  private readonly flows = new Map<string, InputFlow<unknown>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntriesPerPrincipal: number;
  private readonly maxRounds: number;
  private readonly maxRequestsPerRound: number;
  private readonly maxValueBytes: number;
  private readonly now: () => number;
  private readonly randomState: () => string;

  constructor(options: StatelessInputStateStoreOptions = {}) {
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxEntriesPerPrincipal = Math.max(
      1,
      options.maxEntriesPerPrincipal ?? DEFAULT_MAX_ENTRIES_PER_PRINCIPAL
    );
    this.maxRounds = Math.max(1, options.maxRounds ?? DEFAULT_MAX_ROUNDS);
    this.maxRequestsPerRound = Math.max(
      1,
      options.maxRequestsPerRound ?? DEFAULT_MAX_REQUESTS_PER_ROUND
    );
    this.maxValueBytes = Math.max(1_024, options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES);
    this.now = options.now ?? Date.now;
    this.randomState = options.randomState ?? (() => randomBytes(32).toString('base64url'));
  }

  get size(): number {
    return this.flows.size;
  }

  async begin<T>(
    binding: StatelessInputBinding,
    requestId: string | number,
    execute: (runtime: StatelessInputRuntime) => Promise<T>
  ): Promise<StatelessInputTurn<T>> {
    this.sweep();
    if (this.flows.size >= this.maxEntries) {
      throw new StatelessInputStateError('capacity', 'Too many pending input flows');
    }
    const perPrincipal = [...this.flows.values()].filter(
      (flow) => flow.binding.principal === binding.principal
    ).length;
    if (perPrincipal >= this.maxEntriesPerPrincipal) {
      throw new StatelessInputStateError('capacity', 'Too many pending input flows for caller');
    }

    const token = this.newToken();
    const createdAt = this.now();
    const flow: InputFlow<T> = {
      token,
      binding: { ...binding },
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      phase: 'running',
      round: 0,
      requestIndex: 0,
      seenRequestIds: new Set([requestIdKey(requestId)]),
      controller: new AbortController(),
      events: [],
      eventWaiters: [],
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    flow.timer = setTimeout(() => this.expireFlow(flow), this.ttlMs);
    flow.timer.unref?.();
    this.flows.set(token, flow as InputFlow<unknown>);

    const runtime: StatelessInputRuntime = {
      signal: flow.controller.signal,
      request: async (inputRequest, preferredKey) => {
        const responses = await this.pause(flow, {
          [this.inputKey(flow, preferredKey)]: inputRequest,
        });
        return responses[Object.keys(responses)[0]];
      },
      requestMany: (inputRequests) => this.pause(flow, inputRequests),
    };

    void Promise.resolve()
      .then(() => execute(runtime))
      .then(
        (value) => this.publish(flow, { kind: 'complete', value }),
        (error) => this.publish(flow, { kind: 'error', error })
      );

    return this.nextTurn(flow);
  }

  async resume<T>(input: {
    requestState: string;
    binding: StatelessInputBinding;
    requestId: string | number;
    inputResponses: MCPInputResponses;
  }): Promise<StatelessInputTurn<T>> {
    this.sweep();
    const flow = this.lookup<T>(input.requestState);
    if (!sameStatelessInputBinding(flow.binding, input.binding)) {
      throw new StatelessInputStateError('mismatch');
    }
    const idKey = requestIdKey(input.requestId);
    if (flow.seenRequestIds.has(idKey)) {
      throw new StatelessInputStateError('replay', 'A retry requires a new JSON-RPC id');
    }
    if (flow.phase !== 'waiting' || !flow.pending) {
      throw new StatelessInputStateError('replay');
    }

    canonicalizeInputStateValue(input.inputResponses, { maxBytes: this.maxValueBytes });
    const entries = Object.entries(input.inputResponses);
    if (entries.length === 0) {
      throw new StatelessInputStateError('invalid', 'Input responses cannot be empty');
    }
    for (const [key, response] of entries) {
      const request = flow.pending.requests[key];
      if (!request || Object.prototype.hasOwnProperty.call(flow.pending.responses, key)) {
        throw new StatelessInputStateError('replay');
      }
      validateInputResponse(request, response);
    }

    flow.seenRequestIds.add(idKey);
    for (const [key, response] of entries) flow.pending.responses[key] = response;
    this.rotate(flow);

    const outstanding = Object.fromEntries(
      Object.entries(flow.pending.requests).filter(
        ([key]) => !Object.prototype.hasOwnProperty.call(flow.pending!.responses, key)
      )
    );
    if (Object.keys(outstanding).length > 0) {
      return {
        kind: 'input-required',
        result: {
          resultType: 'input_required',
          inputRequests: outstanding,
          requestState: flow.token,
        },
      };
    }

    const pending = flow.pending;
    flow.pending = undefined;
    flow.phase = 'running';
    pending.deferred.resolve({ ...pending.responses });
    return this.nextTurn(flow);
  }

  cancel(requestState: string, binding?: StatelessInputBinding): boolean {
    const flow = this.flows.get(requestState);
    if (!flow || (binding && !sameStatelessInputBinding(flow.binding, binding))) return false;
    this.terminate(flow, new StatelessInputStateError('cancelled', 'Input flow cancelled'));
    return true;
  }

  owns(requestState: string): boolean {
    this.sweep();
    return STATE_TOKEN_RE.test(requestState) && this.flows.has(requestState);
  }

  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const flow of [...this.flows.values()]) {
      if (flow.expiresAt > now) continue;
      this.terminate(flow, new StatelessInputStateError('expired'));
      removed += 1;
    }
    return removed;
  }

  close(): void {
    for (const flow of [...this.flows.values()]) {
      this.terminate(flow, new StatelessInputStateError('cancelled', 'Input state store closed'));
    }
  }

  private async pause<T>(
    flow: InputFlow<T>,
    inputRequests: MCPInputRequests
  ): Promise<MCPInputResponses> {
    if (flow.controller.signal.aborted || flow.phase === 'terminal') {
      throw new StatelessInputStateError('cancelled');
    }
    if (flow.pending || flow.phase !== 'running') {
      throw new StatelessInputStateError('invalid', 'Input flow already has a pending round');
    }
    const entries = Object.entries(inputRequests);
    if (entries.length === 0 || entries.length > this.maxRequestsPerRound) {
      throw new StatelessInputStateError('limit', 'Invalid number of input requests');
    }
    if (flow.round >= this.maxRounds) {
      throw new StatelessInputStateError('limit', 'Input flow exceeded its round limit');
    }
    for (const [key, request] of entries) {
      if (!INPUT_KEY_RE.test(key)) {
        throw new StatelessInputStateError('invalid', 'Invalid input request key');
      }
      validateInputRequest(request);
    }
    canonicalizeInputStateValue(inputRequests, { maxBytes: this.maxValueBytes });

    const pending: PendingInput = {
      requests: { ...inputRequests },
      responses: {},
      deferred: deferred<MCPInputResponses>(),
    };
    flow.pending = pending;
    flow.phase = 'waiting';
    flow.round += 1;
    this.publish(flow, { kind: 'input' });
    return pending.deferred.promise;
  }

  private async nextTurn<T>(flow: InputFlow<T>): Promise<StatelessInputTurn<T>> {
    const event = await this.nextEvent(flow);
    if (event.kind === 'input') {
      if (!flow.pending) {
        throw new StatelessInputStateError('invalid', 'Input flow lost its pending round');
      }
      return {
        kind: 'input-required',
        result: {
          resultType: 'input_required',
          inputRequests: { ...flow.pending.requests },
          requestState: flow.token,
        },
      };
    }
    if (event.kind === 'error') {
      this.terminate(flow, event.error, false);
      throw event.error;
    }
    this.terminate(flow, undefined, false);
    return { kind: 'complete', value: event.value };
  }

  private nextEvent<T>(flow: InputFlow<T>): Promise<FlowEvent<T>> {
    const queued = flow.events.shift();
    if (queued) return Promise.resolve(queued);
    const waiter = deferred<FlowEvent<T>>();
    flow.eventWaiters.push(waiter);
    return waiter.promise;
  }

  private publish<T>(flow: InputFlow<T>, event: FlowEvent<T>): void {
    if (flow.phase === 'terminal') return;
    const waiter = flow.eventWaiters.shift();
    if (waiter) waiter.resolve(event);
    else flow.events.push(event);
  }

  private lookup<T>(requestState: string): InputFlow<T> {
    if (!STATE_TOKEN_RE.test(requestState)) throw new StatelessInputStateError('invalid');
    const flow = this.flows.get(requestState);
    if (!flow) throw new StatelessInputStateError('invalid');
    if (flow.expiresAt <= this.now()) {
      this.terminate(flow, new StatelessInputStateError('expired'));
      throw new StatelessInputStateError('expired');
    }
    return flow as InputFlow<T>;
  }

  private rotate<T>(flow: InputFlow<T>): void {
    const previous = flow.token;
    this.flows.delete(previous);
    flow.token = this.newToken(previous);
    this.flows.set(flow.token, flow as InputFlow<unknown>);
  }

  private newToken(excluded?: string): string {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const token = this.randomState();
      if (STATE_TOKEN_RE.test(token) && token !== excluded && !this.flows.has(token)) return token;
    }
    throw new StatelessInputStateError('capacity', 'Unable to allocate request state');
  }

  private inputKey<T>(flow: InputFlow<T>, preferredKey?: string): string {
    if (preferredKey && INPUT_KEY_RE.test(preferredKey)) return preferredKey;
    flow.requestIndex += 1;
    return `input_${flow.requestIndex}`;
  }

  private expireFlow<T>(flow: InputFlow<T>): void {
    if (flow.phase !== 'terminal') {
      this.terminate(flow, new StatelessInputStateError('expired'));
    }
  }

  private terminate<T>(flow: InputFlow<T>, reason?: unknown, rejectPending = true): void {
    if (flow.phase === 'terminal') return;
    flow.phase = 'terminal';
    clearTimeout(flow.timer);
    this.flows.delete(flow.token);
    flow.controller.abort(reason);
    if (rejectPending && flow.pending) flow.pending.deferred.reject(reason);
    for (const waiter of flow.eventWaiters.splice(0)) waiter.reject(reason);
    flow.events.length = 0;
    flow.pending = undefined;
  }
}

/**
 * Process-independent multi-round state.
 *
 * JavaScript continuations cannot cross a process boundary. This store
 * therefore persists validated answers and deterministically replays the tool
 * from the start on each answered round. Photon authors should perform
 * irreversible work after collecting input, or mark the tool idempotent.
 */
export interface DurableStatelessInputStateStoreOptions extends Omit<
  StatelessInputStateStoreOptions,
  'now' | 'randomState'
> {
  directory: string;
  namespace: string;
  now?: () => number;
  randomState?: () => string;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

interface DurableAnsweredInput {
  request: MCPInputRequest;
  response: unknown;
}

interface DurableInputFlow {
  version: 1;
  namespace: string;
  token: string;
  binding: StatelessInputBinding;
  createdAt: number;
  expiresAt: number;
  round: number;
  seenRequestIds: string[];
  answered: Record<string, DurableAnsweredInput>;
  pending: MCPInputRequests;
}

class DurableInputPause extends Error {
  constructor(readonly requests: MCPInputRequests) {
    super('Durable input required');
    this.name = 'DurableInputPause';
  }
}

export class DurableStatelessInputStateStore {
  private readonly directory: string;
  private readonly namespace: string;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntriesPerPrincipal: number;
  private readonly maxRounds: number;
  private readonly maxRequestsPerRound: number;
  private readonly maxValueBytes: number;
  private readonly now: () => number;
  private readonly randomState: () => string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(options: DurableStatelessInputStateStoreOptions) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace)) {
      throw new TypeError('Durable input-state namespace is invalid');
    }
    this.directory = join(options.directory, options.namespace);
    this.namespace = options.namespace;
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxEntriesPerPrincipal = Math.max(
      1,
      options.maxEntriesPerPrincipal ?? DEFAULT_MAX_ENTRIES_PER_PRINCIPAL
    );
    this.maxRounds = Math.max(1, options.maxRounds ?? DEFAULT_MAX_ROUNDS);
    this.maxRequestsPerRound = Math.max(
      1,
      options.maxRequestsPerRound ?? DEFAULT_MAX_REQUESTS_PER_ROUND
    );
    this.maxValueBytes = Math.max(1_024, options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES);
    this.now = options.now ?? Date.now;
    this.randomState = options.randomState ?? (() => randomBytes(32).toString('base64url'));
    this.lockTimeoutMs = Math.max(100, options.lockTimeoutMs ?? 5_000);
    this.staleLockMs = Math.max(this.lockTimeoutMs, options.staleLockMs ?? 30_000);
    this.ensureDirectory();
  }

  get size(): number {
    this.sweep();
    return this.listStateTokens().length;
  }

  async begin<T>(
    binding: StatelessInputBinding,
    requestId: string | number,
    execute: (runtime: StatelessInputRuntime) => Promise<T>
  ): Promise<StatelessInputTurn<T>> {
    this.sweep();
    this.assertCapacity(binding.principal);
    const now = this.now();
    const flow: DurableInputFlow = {
      version: 1,
      namespace: this.namespace,
      token: this.newToken(),
      binding: { ...binding },
      createdAt: now,
      expiresAt: now + this.ttlMs,
      round: 0,
      seenRequestIds: [requestIdKey(requestId)],
      answered: {},
      pending: {},
    };
    return this.execute(flow, execute);
  }

  async resume<T>(
    input: {
      requestState: string;
      binding: StatelessInputBinding;
      requestId: string | number;
      inputResponses: MCPInputResponses;
    },
    execute?: (runtime: StatelessInputRuntime) => Promise<T>
  ): Promise<StatelessInputTurn<T>> {
    if (!STATE_TOKEN_RE.test(input.requestState)) {
      throw new StatelessInputStateError('invalid');
    }
    return this.withLock(input.requestState, async () => {
      const flow = this.readFlow(input.requestState);
      if (flow.expiresAt <= this.now()) {
        this.deleteFlow(flow.token);
        throw new StatelessInputStateError('expired');
      }
      if (!sameStatelessInputBinding(flow.binding, input.binding)) {
        throw new StatelessInputStateError('mismatch');
      }
      const idKey = requestIdKey(input.requestId);
      if (flow.seenRequestIds.includes(idKey)) {
        throw new StatelessInputStateError('replay', 'A retry requires a new JSON-RPC id');
      }
      const responseEntries = Object.entries(input.inputResponses);
      if (responseEntries.length === 0) {
        throw new StatelessInputStateError('invalid', 'Input responses cannot be empty');
      }
      canonicalizeInputStateValue(input.inputResponses, { maxBytes: this.maxValueBytes });
      for (const [key, response] of responseEntries) {
        const request = flow.pending[key];
        if (!request || flow.answered[key]) throw new StatelessInputStateError('replay');
        validateInputResponse(request, response);
      }

      flow.seenRequestIds.push(idKey);
      for (const [key, response] of responseEntries) {
        flow.answered[key] = { request: flow.pending[key], response };
        delete flow.pending[key];
      }

      if (Object.keys(flow.pending).length > 0) {
        const previousToken = flow.token;
        flow.token = this.newToken(previousToken);
        this.writeFlow(flow);
        this.deleteFlow(previousToken);
        return {
          kind: 'input-required',
          result: {
            resultType: 'input_required',
            inputRequests: { ...flow.pending },
            requestState: flow.token,
          },
        };
      }
      if (!execute) {
        throw new StatelessInputStateError(
          'invalid',
          'Durable request state requires an execution replay callback'
        );
      }

      const previousToken = flow.token;
      try {
        const turn = await this.execute(flow, execute, previousToken);
        this.deleteFlow(previousToken);
        return turn;
      } catch (error) {
        this.deleteFlow(previousToken);
        throw error;
      }
    });
  }

  cancel(requestState: string, binding?: StatelessInputBinding): boolean {
    if (!STATE_TOKEN_RE.test(requestState)) return false;
    try {
      const flow = this.readFlow(requestState);
      if (binding && !sameStatelessInputBinding(flow.binding, binding)) return false;
      this.deleteFlow(requestState);
      return true;
    } catch {
      return false;
    }
  }

  owns(requestState: string): boolean {
    if (!STATE_TOKEN_RE.test(requestState)) return false;
    this.sweep();
    return existsSync(this.flowPath(requestState));
  }

  sweep(): number {
    this.ensureDirectory();
    let removed = 0;
    for (const token of this.listStateTokens()) {
      try {
        const flow = this.readFlow(token);
        if (flow.expiresAt > this.now()) continue;
      } catch {
        // Invalid records fail closed and are removed like expired state.
      }
      this.deleteFlow(token);
      removed += 1;
    }
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.lock')) continue;
      const lockPath = join(this.directory, name);
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > this.staleLockMs) unlinkSync(lockPath);
      } catch {
        // Concurrent cleanup won the race.
      }
    }
    return removed;
  }

  /** Closing one process must not delete state required by another process. */
  close(): void {}

  private async execute<T>(
    flow: DurableInputFlow,
    execute: (runtime: StatelessInputRuntime) => Promise<T>,
    excludedToken?: string
  ): Promise<StatelessInputTurn<T>> {
    let requestIndex = 0;
    const controller = new AbortController();
    const replayOne = async (
      inputRequest: MCPInputRequest,
      preferredKey?: string
    ): Promise<unknown> => {
      validateInputRequest(inputRequest);
      canonicalizeInputStateValue(inputRequest, { maxBytes: this.maxValueBytes });
      const key =
        preferredKey && INPUT_KEY_RE.test(preferredKey)
          ? preferredKey
          : `input_${(requestIndex += 1)}`;
      const answered = flow.answered[key];
      if (answered) {
        if (
          canonicalizeInputStateValue(answered.request) !==
          canonicalizeInputStateValue(inputRequest)
        ) {
          throw new StatelessInputStateError('mismatch', 'Input workflow changed during replay');
        }
        return answered.response;
      }
      throw new DurableInputPause({ [key]: inputRequest });
    };
    const runtime: StatelessInputRuntime = {
      signal: controller.signal,
      request: replayOne,
      requestMany: async (inputRequests) => {
        const entries = Object.entries(inputRequests);
        if (entries.length === 0 || entries.length > this.maxRequestsPerRound) {
          throw new StatelessInputStateError('limit', 'Invalid number of input requests');
        }
        const responses: MCPInputResponses = {};
        const outstanding: MCPInputRequests = {};
        for (const [key, inputRequest] of entries) {
          if (!INPUT_KEY_RE.test(key)) {
            throw new StatelessInputStateError('invalid', 'Invalid input request key');
          }
          validateInputRequest(inputRequest);
          const answered = flow.answered[key];
          if (answered) {
            if (
              canonicalizeInputStateValue(answered.request) !==
              canonicalizeInputStateValue(inputRequest)
            ) {
              throw new StatelessInputStateError(
                'mismatch',
                'Input workflow changed during replay'
              );
            }
            responses[key] = answered.response;
          } else {
            outstanding[key] = inputRequest;
          }
        }
        if (Object.keys(outstanding).length > 0) throw new DurableInputPause(outstanding);
        return responses;
      },
    };

    try {
      const value = await execute(runtime);
      return { kind: 'complete', value };
    } catch (error) {
      if (!(error instanceof DurableInputPause)) throw error;
      if (flow.round >= this.maxRounds) {
        throw new StatelessInputStateError('limit', 'Input flow exceeded its round limit');
      }
      const entries = Object.entries(error.requests);
      if (entries.length === 0 || entries.length > this.maxRequestsPerRound) {
        throw new StatelessInputStateError('limit', 'Invalid number of input requests');
      }
      canonicalizeInputStateValue(error.requests, { maxBytes: this.maxValueBytes });
      flow.round += 1;
      flow.pending = { ...error.requests };
      flow.token = this.newToken(excludedToken ?? flow.token);
      this.writeFlow(flow);
      return {
        kind: 'input-required',
        result: {
          resultType: 'input_required',
          inputRequests: { ...flow.pending },
          requestState: flow.token,
        },
      };
    }
  }

  private assertCapacity(principal: string): void {
    const tokens = this.listStateTokens();
    if (tokens.length >= this.maxEntries) {
      throw new StatelessInputStateError('capacity', 'Too many pending input flows');
    }
    let principalEntries = 0;
    for (const token of tokens) {
      try {
        if (this.readFlow(token).binding.principal === principal) principalEntries += 1;
      } catch {
        // sweep() removes invalid records before capacity checks.
      }
    }
    if (principalEntries >= this.maxEntriesPerPrincipal) {
      throw new StatelessInputStateError('capacity', 'Too many pending input flows for caller');
    }
  }

  private readFlow(token: string): DurableInputFlow {
    try {
      const parsed = JSON.parse(readFileSync(this.flowPath(token), 'utf8')) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1 || parsed.namespace !== this.namespace) {
        throw new Error('invalid durable input state');
      }
      const flow = parsed as unknown as DurableInputFlow;
      if (
        flow.token !== token ||
        !isRecord(flow.binding) ||
        !Array.isArray(flow.seenRequestIds) ||
        !isRecord(flow.answered) ||
        !isRecord(flow.pending) ||
        typeof flow.expiresAt !== 'number'
      ) {
        throw new Error('invalid durable input state');
      }
      return flow;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StatelessInputStateError('invalid');
      }
      if (
        error instanceof Error &&
        'code' in error &&
        typeof (error as NodeJS.ErrnoException).code === 'string'
      ) {
        throw new StatelessInputStateError('unavailable', 'Request-state storage is unavailable');
      }
      if (error instanceof StatelessInputStateError) throw error;
      throw new StatelessInputStateError('invalid', 'Stored request state is invalid');
    }
  }

  private writeFlow(flow: DurableInputFlow): void {
    this.ensureDirectory();
    const destination = this.flowPath(flow.token);
    const temporary = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(flow), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, destination);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best-effort temporary cleanup.
      }
      throw new StatelessInputStateError(
        'unavailable',
        `Unable to persist request state: ${(error as Error).message}`
      );
    }
  }

  private async withLock<T>(token: string, action: () => Promise<T>): Promise<T> {
    const lockPath = this.lockPath(token);
    const deadline = Date.now() + this.lockTimeoutMs;
    let descriptor: number | undefined;
    while (descriptor === undefined) {
      try {
        descriptor = openSync(lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new StatelessInputStateError('unavailable', 'Request-state storage is unavailable');
        }
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > this.staleLockMs) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() >= deadline) {
          throw new StatelessInputStateError('replay', 'Request state is already being resumed');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const heartbeat = setInterval(
      () => {
        try {
          const updatedAt = new Date();
          futimesSync(descriptor, updatedAt, updatedAt);
        } catch {
          // The action or finally block reports an unusable lock.
        }
      },
      Math.max(50, Math.floor(this.staleLockMs / 3))
    );
    heartbeat.unref?.();
    try {
      return await action();
    } finally {
      clearInterval(heartbeat);
      closeSync(descriptor);
      try {
        unlinkSync(lockPath);
      } catch {
        // Concurrent stale-lock cleanup won the race.
      }
    }
  }

  private newToken(excluded?: string): string {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const token = this.randomState();
      if (
        STATE_TOKEN_RE.test(token) &&
        token !== excluded &&
        !existsSync(this.flowPath(token)) &&
        !existsSync(this.lockPath(token))
      ) {
        return token;
      }
    }
    throw new StatelessInputStateError('capacity', 'Unable to allocate request state');
  }

  private listStateTokens(): string[] {
    this.ensureDirectory();
    return readdirSync(this.directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
      .filter((token) => STATE_TOKEN_RE.test(token));
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private flowPath(token: string): string {
    return join(this.directory, `${token}.json`);
  }

  private lockPath(token: string): string {
    return join(this.directory, `${token}.lock`);
  }

  private deleteFlow(token: string): void {
    try {
      unlinkSync(this.flowPath(token));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new StatelessInputStateError('unavailable', 'Request-state storage is unavailable');
      }
    }
  }
}
