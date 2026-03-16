/**
 * Worker Thread IPC Protocol
 *
 * Defines message types for communication between the main daemon thread
 * and per-photon worker threads. Workers run photon instances in isolation
 * so a crash or bad reload in one photon can't bring down the whole daemon.
 */

/** Messages from main thread → worker */
export type MainToWorkerMessage =
  | {
      type: 'call';
      id: string;
      method: string;
      args: Record<string, unknown>;
      sessionId: string;
      instanceName: string;
    }
  | { type: 'reload'; photonPath: string }
  | { type: 'shutdown'; reason?: string }
  | { type: 'dep_resolved'; id: string; depName: string; toolNames: string[] }
  | { type: 'dep_call_result'; id: string; success: boolean; data?: unknown; error?: string }
  | { type: 'channel_message'; channel: string; message: unknown };

/** Messages from worker → main thread */
export type WorkerToMainMessage =
  | { type: 'ready'; tools: Array<{ name: string; description?: string }> }
  | {
      type: 'result';
      id: string;
      success: boolean;
      data?: unknown;
      error?: string;
      durationMs?: number;
    }
  | { type: 'emit'; id: string; emitData: Record<string, unknown> }
  | {
      type: 'reload_result';
      success: boolean;
      error?: string;
      tools?: Array<{ name: string; description?: string }>;
    }
  | { type: 'crashed'; error: string; stack?: string }
  | { type: 'resolve_dep'; id: string; depName: string; depPath: string }
  | { type: 'dep_call'; id: string; depName: string; method: string; args: Record<string, unknown> }
  | { type: 'publish'; channel: string; message: unknown }
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
      meta?: Record<string, unknown>;
    };

/** Worker initialization data passed via workerData */
export interface WorkerInit {
  photonName: string;
  photonPath: string;
  workingDir?: string;
  instanceName?: string;
}
