/**
 * Daemon Protocol Types
 *
 * Defines message types for IPC communication between CLI client and daemon server
 */

/**
 * Message from CLI client to daemon server
 */
export interface DaemonRequest {
  type: 'command' | 'ping' | 'shutdown' | 'prompt_response';
  id: string;
  sessionId?: string; // Client session identifier for isolation
  clientType?: 'cli' | 'mcp' | 'code-mode'; // Client type for debugging
  method?: string;
  args?: Record<string, any>;
  /** Response to a prompt request */
  promptValue?: string | boolean | null;
}

/**
 * Response from daemon server to CLI client
 */
export interface DaemonResponse {
  type: 'result' | 'error' | 'pong' | 'prompt';
  id: string;
  success?: boolean;
  data?: any;
  error?: string;
  /** Prompt request details (when type === 'prompt') */
  prompt?: {
    type: 'text' | 'password' | 'confirm' | 'select';
    message: string;
    default?: string;
    options?: Array<string | { value: string; label: string }>;
  };
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
  instance: any;
  createdAt: number;
  lastActivity: number;
  clientType?: string;
}
