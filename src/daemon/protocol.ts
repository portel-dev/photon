/**
 * Daemon Protocol Types
 *
 * Defines message types for IPC communication between CLI client and daemon server
 */

import type { PhotonMCPClass } from '@portel/photon-core';

/**
 * Message from CLI client to daemon server
 */
export interface DaemonRequest {
  type: 'command' | 'ping' | 'shutdown' | 'prompt_response' | 'subscribe' | 'unsubscribe' | 'publish';
  id: string;
  sessionId?: string; // Client session identifier for isolation
  clientType?: 'cli' | 'mcp' | 'code-mode' | 'beam'; // Client type for debugging
  method?: string;
  args?: Record<string, unknown>;
  /** Response to a prompt request */
  promptValue?: string | boolean | null;
  /** Channel name for pub/sub operations */
  channel?: string;
  /** Message payload for publish operations */
  message?: unknown;
}

/**
 * Response from daemon server to CLI client
 */
export interface DaemonResponse {
  type: 'result' | 'error' | 'pong' | 'prompt' | 'channel_message';
  id: string;
  success?: boolean;
  data?: unknown;
  error?: string;
  /** Prompt request details (when type === 'prompt') */
  prompt?: {
    type: 'text' | 'password' | 'confirm' | 'select';
    message: string;
    default?: string;
    options?: Array<string | { value: string; label: string }>;
  };
  /** Channel name for channel_message type */
  channel?: string;
  /** Message payload for channel_message type */
  message?: unknown;
}

/**
 * Daemon status information
 */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  startTime?: number;
  lastActivity?: number;
  photonName: string;
  activeSessions?: number;
}

/**
 * Session information
 */
export interface PhotonSession {
  id: string;
  instance: PhotonMCPClass;
  createdAt: number;
  lastActivity: number;
  clientType?: string;
}

/**
 * Runtime validation for DaemonRequest
 */
export function isValidDaemonRequest(obj: unknown): obj is DaemonRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const req = obj as Partial<DaemonRequest>;

  if (typeof req.id !== 'string') return false;
  if (!['command', 'ping', 'shutdown', 'prompt_response', 'subscribe', 'unsubscribe', 'publish'].includes(req.type as string))
    return false;

  if (req.type === 'command') {
    if (typeof req.method !== 'string') return false;
  }

  // Channel operations require a channel name
  if (['subscribe', 'unsubscribe', 'publish'].includes(req.type as string)) {
    if (typeof req.channel !== 'string') return false;
  }

  return true;
}

/**
 * Runtime validation for DaemonResponse
 */
export function isValidDaemonResponse(obj: unknown): obj is DaemonResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const res = obj as Partial<DaemonResponse>;

  if (typeof res.id !== 'string') return false;
  if (!['result', 'error', 'pong', 'prompt', 'channel_message'].includes(res.type as string)) return false;

  return true;
}
