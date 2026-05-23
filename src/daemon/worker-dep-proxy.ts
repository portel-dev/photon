import type {
  ChannelBroker,
  ChannelHandler,
  ChannelMessage,
  Subscription,
} from '@portel/photon-core';
import type { WorkerToMainMessage } from './worker-protocol.js';

export type PendingDepCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface WorkerDepProxyOptions {
  depName: string;
  remoteToolNames: string[];
  broker: Pick<ChannelBroker, 'publish' | 'subscribe'>;
  send: (msg: WorkerToMainMessage) => void;
  genId: () => string;
  pendingDepCalls: Map<string, PendingDepCall>;
  timeoutMs?: number;
}

function depEventChannel(depName: string, event: string): string {
  return `${depName}:${event}`;
}

function eventNameFromOnProperty(prop: string): string | null {
  if (!prop.startsWith('on') || prop.length <= 2) return null;
  return prop.charAt(2).toLowerCase() + prop.slice(3);
}

function eventPayload(message: unknown): unknown {
  if (message && typeof message === 'object' && 'data' in message) {
    return (message as ChannelMessage).data;
  }
  return message;
}

export function createWorkerDepProxy({
  depName,
  remoteToolNames,
  broker,
  send,
  genId,
  pendingDepCalls,
  timeoutMs = 120_000,
}: WorkerDepProxyOptions): any {
  const toolSet = new Set(remoteToolNames);
  const subscriptions = new Map<ChannelHandler, Promise<Subscription>>();

  const subscribe = (event: string, handler: (data: unknown) => void): (() => void) => {
    const channel = depEventChannel(depName, event);
    const wrapped: ChannelHandler = (message) => handler(eventPayload(message));
    const subscription = broker.subscribe(channel, wrapped);
    subscriptions.set(handler as ChannelHandler, subscription);

    return () => {
      subscriptions.delete(handler as ChannelHandler);
      void subscription.then((sub) => sub.unsubscribe());
    };
  };

  const unsubscribe = (handler: (data: unknown) => void): void => {
    const subscription = subscriptions.get(handler as ChannelHandler);
    if (!subscription) return;
    subscriptions.delete(handler as ChannelHandler);
    void subscription.then((sub) => sub.unsubscribe());
  };

  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;

      if (prop === 'on') {
        return subscribe;
      }

      if (prop === 'off') {
        return (_event: string, handler: (data: unknown) => void) => unsubscribe(handler);
      }

      if (prop === 'emit') {
        return (event: string, data?: unknown) =>
          broker.publish({
            channel: depEventChannel(depName, event),
            event,
            data,
            timestamp: Date.now(),
            source: depName,
          });
      }

      const eventName = eventNameFromOnProperty(prop);
      if (eventName) {
        return (handler: (data: unknown) => void) => subscribe(eventName, handler);
      }

      if (toolSet.has(prop)) {
        return async (args: Record<string, unknown> = {}) => {
          const id = genId();
          return new Promise((resolve, reject) => {
            pendingDepCalls.set(id, { resolve, reject });
            send({ type: 'dep_call', id, depName, method: prop, args });
            setTimeout(() => {
              if (pendingDepCalls.has(id)) {
                pendingDepCalls.delete(id);
                reject(new Error(`Dependency call ${depName}.${prop} timed out`));
              }
            }, timeoutMs);
          });
        };
      }

      return undefined;
    },
  });
}
