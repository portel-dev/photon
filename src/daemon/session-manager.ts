/**
 * Session Manager
 *
 * Manages isolated photon instances per client session
 * Handles session lifecycle, cleanup, and resource management
 */

import { PhotonLoader } from '../loader.js';
import { PhotonSession } from './protocol.js';

const DEFAULT_SESSION_ID = 'default';

export class SessionManager {
  private sessions = new Map<string, PhotonSession>();
  private photonPath: string;
  private photonName: string;
  public loader: PhotonLoader; // Public to allow executeTool access
  private sessionTimeout: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(photonPath: string, photonName: string, sessionTimeout: number = 600000) {
    this.photonPath = photonPath;
    this.photonName = photonName;
    this.sessionTimeout = sessionTimeout;
    this.loader = new PhotonLoader(false); // verbose = false

    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Get or create a session
   */
  async getOrCreateSession(sessionId: string | undefined, clientType?: string): Promise<PhotonSession> {
    const id = sessionId || DEFAULT_SESSION_ID;

    if (this.sessions.has(id)) {
      const session = this.sessions.get(id)!;
      session.lastActivity = Date.now();
      return session;
    }

    // Create new session
    console.error(`[session-manager] Creating new session: ${id} (${clientType || 'unknown'})`);

    try {
      const instance = await this.loader.loadFile(this.photonPath);

      const session: PhotonSession = {
        id,
        instance,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        clientType
      };

      this.sessions.set(id, session);
      console.error(`[session-manager] Session created. Active sessions: ${this.sessions.size}`);

      return session;
    } catch (error: any) {
      console.error(`[session-manager] Failed to create session: ${error.message}`);
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
   * Clean up idle sessions
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [id, session] of this.sessions) {
      const idleTime = now - session.lastActivity;

      if (idleTime > this.sessionTimeout) {
        console.error(`[session-manager] Session ${id} expired (idle ${idleTime}ms)`);
        expiredSessions.push(id);
      }
    }

    // Remove expired sessions
    for (const id of expiredSessions) {
      this.sessions.delete(id);
    }

    if (expiredSessions.length > 0) {
      console.error(`[session-manager] Cleaned up ${expiredSessions.length} sessions. Active: ${this.sessions.size}`);
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

    console.error(`[session-manager] Destroying ${this.sessions.size} active sessions`);
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
