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
  type:
    | 'command'
    | 'ping'
    | 'shutdown'
    | 'reload'
    | 'prompt_response'
    | 'subscribe'
    | 'unsubscribe'
    | 'publish'
    | 'lock'
    | 'unlock'
    | 'schedule'
    | 'unschedule'
    | 'list_jobs'
    | 'list_locks'
    | 'get_events_since';
  id: string;
  /** Photon name for routing to correct SessionManager (required for multi-photon daemon) */
  photonName?: string;
  /** Path to photon file for reload command or initial photon setup */
  photonPath?: string;
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
  /** Lock name for lock/unlock operations */
  lockName?: string;
  /** Lock timeout in ms (default: 30000) */
  lockTimeout?: number;
  /** Job ID for schedule operations */
  jobId?: string;
  /** Cron expression for scheduled jobs */
  cron?: string;
  /** Last event timestamp received by client (for delta sync on reconnect) */
  lastEventId?: string;
}

/**
 * Response from daemon server to CLI client
 */
export interface DaemonResponse {
  type: 'result' | 'error' | 'pong' | 'prompt' | 'channel_message' | 'refresh_needed';
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
  /** Event timestamp for tracking (for delta sync support) */
  eventId?: string;
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
 * Scheduled job information
 */
export interface ScheduledJob {
  id: string;
  method: string;
  args?: Record<string, unknown>;
  cron: string;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  createdAt: number;
  createdBy?: string;
}

/**
 * Lock information
 */
export interface LockInfo {
  name: string;
  holder: string; // Session ID or client identifier
  acquiredAt: number;
  expiresAt: number;
}

/**
 * Runtime validation for DaemonRequest
 */
export function isValidDaemonRequest(obj: unknown): obj is DaemonRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const req = obj as Partial<DaemonRequest>;

  if (typeof req.id !== 'string') return false;

  const validTypes = [
    'command',
    'ping',
    'shutdown',
    'reload',
    'prompt_response',
    'subscribe',
    'unsubscribe',
    'publish',
    'lock',
    'unlock',
    'schedule',
    'unschedule',
    'list_jobs',
    'list_locks',
    'get_events_since',
  ];
  if (!validTypes.includes(req.type as string)) return false;

  if (req.type === 'command') {
    if (typeof req.method !== 'string') return false;
  }

  // Channel operations require a channel name
  if (['subscribe', 'unsubscribe', 'publish'].includes(req.type as string)) {
    if (typeof req.channel !== 'string') return false;
  }

  // Lock operations require a lock name
  if (['lock', 'unlock'].includes(req.type as string)) {
    if (typeof req.lockName !== 'string') return false;
  }

  // Schedule operations require jobId, method, and cron
  if (req.type === 'schedule') {
    if (typeof req.jobId !== 'string') return false;
    if (typeof req.method !== 'string') return false;
    if (typeof req.cron !== 'string') return false;
  }

  // Unschedule requires jobId
  if (req.type === 'unschedule') {
    if (typeof req.jobId !== 'string') return false;
  }

  // Reload requires photonPath
  if (req.type === 'reload') {
    if (typeof req.photonPath !== 'string') return false;
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
  if (
    !['result', 'error', 'pong', 'prompt', 'channel_message', 'refresh_needed'].includes(
      res.type as string
    )
  )
    return false;

  return true;
}
