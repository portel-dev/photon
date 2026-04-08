/**
 * Runtime-injected properties on photon instances.
 *
 * The loader dynamically attaches channel infrastructure, event dispatch,
 * and reactive-collection wiring onto plain class instances. This interface
 * captures those shapes so call-sites can avoid `as any`.
 */

// ---------------------------------------------------------------------------
// Channel event listener entry
// ---------------------------------------------------------------------------
export interface EventListenerEntry {
  event: string;
  fn: (data: unknown) => void;
  filter?: EventFilter;
}

export interface EventFilter {
  group?: string;
  chatId?: string;
  trigger?: string;
  fromMe?: boolean;
}

export interface ChannelMessage {
  content?: string;
  fromMe?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Channel function shape (assigned to instance.channel)
// ---------------------------------------------------------------------------
export interface ChannelFunction {
  (content: string, meta?: Record<string, string>): void;
  respond: (requestId: string, behavior: 'allow' | 'deny') => void;
  onPermission: (handler: (request: unknown) => void) => void;
  _dispatchPermission: (request: unknown) => Promise<unknown> | void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// PhotonInstance — the bag of runtime-injected properties
// ---------------------------------------------------------------------------
export interface PhotonInstance {
  channel?: ChannelFunction;
  _dispatch?: (chatId: string, message: ChannelMessage, groupName?: string) => void;
  _eventListeners?: EventListenerEntry[];
  _matchesFilter?: (
    filter: EventFilter | undefined,
    chatId: string,
    message: ChannelMessage,
    groupName?: string
  ) => boolean;
  on?: (event: string, handler: (data: unknown) => void, filter?: EventFilter) => void;
  off?: (event: string, handler: (data: unknown) => void) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Reactive collection wiring — duck-typed internal properties
// ---------------------------------------------------------------------------
export interface ReactiveCollectionLike {
  _propertyName?: string;
  _emitter?: (event: string, data: unknown) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Daemon pub/sub event envelope (passed to outputHandler for @stateful events)
// ---------------------------------------------------------------------------
export interface DaemonEventEnvelope {
  channel: string;
  event: string;
  data: Record<string, unknown>;
}
