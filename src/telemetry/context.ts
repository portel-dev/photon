/**
 * Per-request ambient context for Photon tool execution.
 *
 * Uses Node's AsyncLocalStorage to make trace/caller context available
 * anywhere in the async call tree without parameter threading. Populated
 * by PhotonLoader.executeTool; consumed by the structured Logger, metrics
 * recorders, and any user code via getRequestContext().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallerInfo } from '@portel/photon-core';

export interface RequestContext {
  photon: string;
  tool: string;
  /** W3C 32-hex trace ID when the execution is async or correlated. */
  traceId?: string;
  /** Inbound W3C traceparent (`00-{traceId}-{spanId}-{flags}`) when present. */
  parentTraceparent?: string;
  /** Authenticated caller when available. */
  caller?: CallerInfo;
  /** Normalized transport/client/app-session details for the current invocation. */
  request?: PhotonExecutionRequestContext;
  /**
   * Originating CLI invocation directory, propagated end-to-end across
   * worker thread and cross-photon-call boundaries. Lets photons resolve
   * defaults relative to where the user ran the command, not the daemon's
   * cwd. `process.cwd()` inside a worker is the daemon process's cwd, which
   * is rarely what the photon author wants. Photons read this back via
   * `this.callerCwd`.
   */
  cwd?: string;
  /**
   * Resolved PHOTON_DIR for the currently loading/executing photon.
   * In the single in-process daemon, several PHOTON_DIRs can execute
   * concurrently, so this must be async-local rather than process-global.
   */
  photonDir?: string;
  /** Wall-clock start of the tool call. */
  startedAt: number;
}

export interface PhotonExecutionClientContext {
  protocolVersion: string;
  clientName?: string;
  clientVersion?: string;
  mode: 'legacy-sessionful' | 'stateless' | 'unknown';
  capabilities?: Record<string, unknown>;
  quirks?: Record<string, unknown>;
}

export interface PhotonExecutionRequestContext {
  requestId?: string | number;
  transport: string;
  protocolVersion: string;
  client: PhotonExecutionClientContext;
  traceparent?: string;
  legacyTransportSessionId?: string;
  appSessionId?: string;
  appSessionSource?: string;
  scopeDir?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();
let envProxyInstalled = false;

/**
 * Expose PHOTON_DIR through AsyncLocalStorage for legacy/user code that reads
 * `process.env.PHOTON_DIR` directly. Node's process.env object cannot define
 * accessor properties, but process.env itself can be replaced with a Proxy.
 *
 * This is intentionally narrow: every other env key keeps native semantics.
 * Writes to PHOTON_DIR still update the backing env for CLI/test code; daemon
 * load/execution reads prefer the async-local photonDir when present.
 */
function installPhotonDirEnvProxy(): void {
  if (envProxyInstalled) return;
  envProxyInstalled = true;
  const backing = process.env;
  process.env = new Proxy(backing, {
    get(target, prop, receiver) {
      if (prop === 'PHOTON_DIR') {
        return storage.getStore()?.photonDir ?? Reflect.get(target, prop, receiver);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (prop === 'PHOTON_DIR' && storage.getStore()?.photonDir) return true;
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return storage.getStore()?.photonDir && !keys.includes('PHOTON_DIR')
        ? [...keys, 'PHOTON_DIR']
        : keys;
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop === 'PHOTON_DIR' && storage.getStore()?.photonDir) {
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: storage.getStore()?.photonDir,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    set(target, prop, value, receiver) {
      return Reflect.set(target, prop, value, receiver);
    },
    deleteProperty(target, prop) {
      return Reflect.deleteProperty(target, prop);
    },
  });
}

installPhotonDirEnvProxy();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithPhotonDir<T>(photonDir: string, fn: () => T): T {
  const existing = storage.getStore();
  const ctx: RequestContext = {
    photon: existing?.photon ?? '__load__',
    tool: existing?.tool ?? '__load__',
    photonDir,
    startedAt: existing?.startedAt ?? Date.now(),
  };

  if (existing?.traceId !== undefined) ctx.traceId = existing.traceId;
  if (existing?.parentTraceparent !== undefined) ctx.parentTraceparent = existing.parentTraceparent;
  if (existing?.caller !== undefined) ctx.caller = existing.caller;
  if (existing?.request !== undefined) ctx.request = existing.request;
  if (existing?.cwd !== undefined) ctx.cwd = existing.cwd;

  return storage.run(ctx, fn);
}
