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
  /**
   * Originating CLI invocation directory, propagated end-to-end across
   * worker thread and cross-photon-call boundaries. Lets photons resolve
   * defaults relative to where the user ran the command, not the daemon's
   * cwd. `process.cwd()` inside a worker is the daemon process's cwd, which
   * is rarely what the photon author wants. Photons read this back via
   * `this.callerCwd`.
   */
  cwd?: string;
  /** Wall-clock start of the tool call. */
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
