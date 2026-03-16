/**
 * Worker Host — runs inside a worker thread
 *
 * Loads a single photon in isolation and communicates with the main daemon
 * thread via postMessage. If this worker crashes, only this photon is affected.
 */

import { workerData, parentPort } from 'worker_threads';
import { PhotonLoader } from '../loader.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { setBroker } from '@portel/photon-core';
import type {
  ChannelBroker,
  ChannelMessage,
  ChannelHandler,
  Subscription,
} from '@portel/photon-core';
import type { MainToWorkerMessage, WorkerInit, WorkerToMainMessage } from './worker-protocol.js';

if (!parentPort) {
  throw new Error('worker-host must run inside a worker thread');
}

const port = parentPort;
const init = workerData as WorkerInit;

const logger = createLogger({
  component: 'worker-host',
  scope: init.photonName,
  minimal: true,
});

// ─── Worker-Side Broker ──────────────────────────────────────────────────────
// Routes pub/sub through the main thread so events cross worker boundaries.
class WorkerBroker implements ChannelBroker {
  readonly type = 'worker';
  private handlers = new Map<string, Set<ChannelHandler>>();

  async publish(message: ChannelMessage): Promise<void> {
    // Dispatch locally first
    const handlers = this.handlers.get(message.channel);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(message);
        } catch {
          /* swallow */
        }
      }
    }
    // Forward to main thread for cross-worker dispatch
    send({ type: 'publish', channel: message.channel, message });
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    let handlers = this.handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
      // Tell main thread we want messages on this channel
      send({ type: 'subscribe', channel });
    }
    handlers.add(handler);

    return {
      channel,
      active: true,
      unsubscribe: () => {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(channel);
          send({ type: 'unsubscribe', channel });
        }
      },
    };
  }

  /** Called when the main thread forwards a channel message to us */
  dispatchFromMain(channel: string, message: unknown): void {
    const handlers = this.handlers.get(channel);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(message as ChannelMessage);
      } catch {
        /* swallow */
      }
    }
  }

  isConnected(): boolean {
    return true;
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.handlers.clear();
  }
}

const broker = new WorkerBroker();
setBroker(broker);

// ─── State ───────────────────────────────────────────────────────────────────

let loader: PhotonLoader;
let loadedInstance: any = null;
let toolNames: string[] = [];

// Pending RPC calls for @photon cross-dependencies
const pendingDepCalls = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
const pendingDepResolves = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function send(msg: WorkerToMainMessage): void {
  port.postMessage(msg);
}

function genId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── @photon Dependency Resolution (cross-worker RPC) ────────────────────────

function createDepProxy(depName: string, remoteToolNames: string[]): any {
  const toolSet = new Set(remoteToolNames);

  return new Proxy({} as any, {
    get(_target: any, prop: string) {
      if (typeof prop !== 'string') return undefined;

      // .on, .off, .emit — use broker-based events (channel: dep:${depName})
      if (prop === 'on' || prop === 'off' || prop === 'emit') {
        // TODO: bridge event subscriptions for dependencies
        return () => {};
      }

      if (toolSet.has(prop)) {
        return async (args: Record<string, unknown> = {}) => {
          const id = genId();
          return new Promise((resolve, reject) => {
            pendingDepCalls.set(id, { resolve, reject });
            send({ type: 'dep_call', id, depName, method: prop, args });
            // Timeout after 120s
            setTimeout(() => {
              if (pendingDepCalls.has(id)) {
                pendingDepCalls.delete(id);
                reject(new Error(`Dependency call ${depName}.${prop} timed out`));
              }
            }, 120_000);
          });
        };
      }

      return undefined;
    },
  });
}

// ─── Initialization ──────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  try {
    loader = new PhotonLoader(false, logger.child({ component: 'photon-loader' }), init.workingDir);

    // Wire @photon dependency resolver to go through main thread
    loader.photonInstanceResolver = async (depName: string, depPath: string) => {
      const id = genId();
      return new Promise((resolve, reject) => {
        pendingDepResolves.set(id, { resolve, reject });
        send({ type: 'resolve_dep', id, depName, depPath });
        setTimeout(() => {
          if (pendingDepResolves.has(id)) {
            pendingDepResolves.delete(id);
            reject(new Error(`Dependency resolution for ${depName} timed out`));
          }
        }, 30_000);
      });
    };

    loadedInstance = await loader.loadFile(init.photonPath, {
      instanceName: init.instanceName,
    });

    toolNames = (loadedInstance?.tools || []).map((t: any) => t.name);

    send({
      type: 'ready',
      tools: (loadedInstance?.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description,
      })),
    });

    logger.info('Worker ready', { photon: init.photonName, tools: toolNames.length });
  } catch (err) {
    send({ type: 'crashed', error: getErrorMessage(err), stack: (err as Error)?.stack });
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────

port.on('message', (msg: MainToWorkerMessage) => {
  void handleMessage(msg);
});

async function handleMessage(msg: MainToWorkerMessage): Promise<void> {
  switch (msg.type) {
    case 'call': {
      if (!loadedInstance) {
        send({ type: 'result', id: msg.id, success: false, error: 'Photon not loaded' });
        return;
      }
      const start = Date.now();
      try {
        const result = await loader.executeTool(loadedInstance, msg.method, msg.args);

        // Handle generator results (yields)
        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          for await (const value of result as AsyncIterable<any>) {
            if (value && typeof value === 'object' && 'emit' in value) {
              send({ type: 'emit', id: msg.id, emitData: value });
            }
          }
          send({ type: 'result', id: msg.id, success: true, durationMs: Date.now() - start });
        } else {
          send({
            type: 'result',
            id: msg.id,
            success: true,
            data: result,
            durationMs: Date.now() - start,
          });
        }
      } catch (err) {
        send({
          type: 'result',
          id: msg.id,
          success: false,
          error: getErrorMessage(err),
          durationMs: Date.now() - start,
        });
      }
      break;
    }

    case 'reload': {
      try {
        const oldInstance = loadedInstance;
        await loader.reloadFile(msg.photonPath);
        const newLoaded = await loader.loadFile(msg.photonPath, {
          skipInitialize: true,
          instanceName: init.instanceName,
        });

        // Lifecycle hooks for state transfer
        const hasLifecycle =
          oldInstance?.instance &&
          typeof oldInstance.instance.onShutdown === 'function' &&
          typeof oldInstance.instance.onInitialize === 'function';

        if (oldInstance?.instance && typeof oldInstance.instance.onShutdown === 'function') {
          try {
            await oldInstance.instance.onShutdown({ reason: 'hot-reload' });
          } catch (err) {
            logger.warn('onShutdown failed during worker reload', { error: getErrorMessage(err) });
          }
        }

        // Non-lifecycle: copy properties
        if (!hasLifecycle && oldInstance?.instance && newLoaded?.instance) {
          for (const key of Object.keys(oldInstance.instance)) {
            const value = oldInstance.instance[key];
            if (typeof value !== 'function' && key !== 'constructor') {
              try {
                newLoaded.instance[key] = value;
              } catch {
                /* read-only */
              }
            }
          }
        }

        // Lifecycle: pass old instance
        if (newLoaded?.instance && typeof newLoaded.instance.onInitialize === 'function') {
          try {
            await newLoaded.instance.onInitialize({
              reason: 'hot-reload',
              oldInstance: hasLifecycle ? oldInstance?.instance : undefined,
            });
          } catch (err) {
            logger.warn('onInitialize failed during worker reload', {
              error: getErrorMessage(err),
            });
          }
        }

        loadedInstance = newLoaded;
        toolNames = (newLoaded?.tools || []).map((t: any) => t.name);

        send({
          type: 'reload_result',
          success: true,
          tools: (newLoaded?.tools || []).map((t: any) => ({
            name: t.name,
            description: t.description,
          })),
        });
      } catch (err) {
        send({ type: 'reload_result', success: false, error: getErrorMessage(err) });
      }
      break;
    }

    case 'shutdown': {
      if (loadedInstance?.instance && typeof loadedInstance.instance.onShutdown === 'function') {
        try {
          await loadedInstance.instance.onShutdown({ reason: msg.reason || 'shutdown' });
        } catch {
          /* best effort */
        }
      }
      process.exit(0);
      break;
    }

    case 'dep_resolved': {
      const pending = pendingDepResolves.get(msg.id);
      if (pending) {
        pendingDepResolves.delete(msg.id);
        pending.resolve(createDepProxy(msg.depName, msg.toolNames));
      }
      break;
    }

    case 'dep_call_result': {
      const pending = pendingDepCalls.get(msg.id);
      if (pending) {
        pendingDepCalls.delete(msg.id);
        if (msg.success) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || 'Dependency call failed'));
        }
      }
      break;
    }

    case 'channel_message': {
      broker.dispatchFromMain(msg.channel, msg.message);
      break;
    }
  }
}

// ─── Global Error Handlers ───────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error('Worker uncaught exception', { error: getErrorMessage(err), stack: err?.stack });
  send({ type: 'crashed', error: getErrorMessage(err), stack: err?.stack });
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? getErrorMessage(reason) : String(reason);
  logger.error('Worker unhandled rejection', { error });
  send({ type: 'crashed', error });
});

// Start
void initialize();
