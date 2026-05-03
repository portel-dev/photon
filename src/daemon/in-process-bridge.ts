/**
 * In-process bridge for daemon-internal callers.
 *
 * The photon loader runs in two contexts:
 *   1. CLI subprocess — must talk to the daemon over the Unix socket.
 *   2. Inside the daemon itself — can call daemon functions directly.
 *
 * Without this bridge the loader uses `daemon/client.ts:unscheduleJob`
 * unconditionally, which means context 2 round-trips through its own
 * socket. Daily symptoms: "[photon-loader:X] [schedule] failed to evict
 * in-memory cron registration … connect ENOENT /…/daemon.sock" entries
 * during shutdown/recovery windows when the socket is briefly missing.
 *
 * Daemon boot calls `registerInProcessAdapters(...)` once. Code that
 * could be called from either context (the loader, anything imported
 * by the loader) checks `getInProcessAdapters()` and prefers the direct
 * call when present.
 */

export interface InProcessAdapters {
  /**
   * Evict a scheduled job by (photonName, jobId). Returns whether the
   * job was actually unscheduled. Mirrors `client.unscheduleJob` so
   * callers can swap implementations transparently.
   */
  unscheduleJob(photonName: string, jobId: string): Promise<boolean>;
}

let adapters: InProcessAdapters | null = null;

export function registerInProcessAdapters(impl: InProcessAdapters): void {
  adapters = impl;
}

export function getInProcessAdapters(): InProcessAdapters | null {
  return adapters;
}
