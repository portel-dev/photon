/**
 * Daemon Protocol Types
 *
 * Defines message types for IPC communication between CLI client and daemon server
 */

/**
 * Message from CLI client to daemon server
 */
export interface DaemonRequest {
  type: 'command' | 'ping' | 'shutdown';
  id: string;
  sessionId?: string; // Client session identifier for isolation
  clientType?: 'cli' | 'mcp' | 'code-mode'; // Client type for debugging
  method?: string;
  args?: Record<string, any>;
}

/**
 * Response from daemon server to CLI client
 */
export interface DaemonResponse {
  type: 'result' | 'error' | 'pong';
  id: string;
  success?: boolean;
  data?: any;
  error?: string;
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
