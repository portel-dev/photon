/**
 * Session Manager
 *
 * Manages isolated photon instances per client session
 * Handles session lifecycle, cleanup, and resource management
 */

import { PhotonLoader } from '../loader.js';
import { PhotonSession } from './protocol.js';
import { Logger, createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';

const DEFAULT_SESSION_ID = 'default';

export class SessionManager {
  private sessions = new Map<string, PhotonSession>();
  private photonPath: string;
  private photonName: string;
  public loader: PhotonLoader; // Public to allow executeTool access
  private sessionTimeout: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(
    photonPath: string,
    photonName: string,
    sessionTimeout: number = 600000,
    logger?: Logger
  ) {
    this.photonPath = photonPath;
    this.photonName = photonName;
    this.sessionTimeout = sessionTimeout;
    this.logger =
      logger ?? createLogger({ component: 'session-manager', scope: photonName, minimal: true });
    this.loader = new PhotonLoader(
      false,
      this.logger.child({ component: 'photon-loader', scope: photonName })
    );

    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Get or create a session
   */
  async getOrCreateSession(
    sessionId: string | undefined,
    clientType?: string
  ): Promise<PhotonSession> {
    const id = sessionId || DEFAULT_SESSION_ID;

    if (this.sessions.has(id)) {
      const session = this.sessions.get(id)!;
      session.lastActivity = Date.now();
      return session;
    }

    // Create new session
    this.logger.info(`Creating new session: ${id}`, { clientType: clientType || 'unknown' });

    try {
      const instance = await this.loader.loadFile(this.photonPath);

      const session: PhotonSession = {
        id,
        instance,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        clientType,
      };

      this.sessions.set(id, session);
      this.logger.info('Session created', { sessionId: id, activeSessions: this.sessions.size });

      return session;
    } catch (error) {
      this.logger.error('Failed to create session', {
        sessionId: id,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all sessions (for debugging)
   */
  getSessions(): PhotonSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Update a session's instance (used during hot-reload)
   * Returns true if session was found and updated
   */
  updateSessionInstance(sessionId: string, newInstance: any): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.instance = newInstance;
    return true;
  }

  /**
   * Clean up idle sessions
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [id, session] of this.sessions) {
      const idleTime = now - session.lastActivity;

      if (idleTime > this.sessionTimeout) {
        this.logger.warn('Session expired due to inactivity', { sessionId: id, idleTime });
        expiredSessions.push(id);
      }
    }

    // Remove expired sessions
    for (const id of expiredSessions) {
      this.sessions.delete(id);
    }

    if (expiredSessions.length > 0) {
      this.logger.info('Cleaned up expired sessions', {
        removed: expiredSessions.length,
        activeSessions: this.sessions.size,
      });
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Stop cleanup and destroy all sessions
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.logger.warn('Destroying active sessions', { activeSessions: this.sessions.size });
    this.sessions.clear();
  }

  /**
   * Get last activity time across all sessions
   */
  getLastActivity(): number {
    let latest = 0;
    for (const session of this.sessions.values()) {
      if (session.lastActivity > latest) {
        latest = session.lastActivity;
      }
    }
    return latest;
  }
}
