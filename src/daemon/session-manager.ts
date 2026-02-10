/**
 * Session Manager
 *
 * Manages isolated photon instances per client session.
 * Supports named instances: each session maps to an instanceName,
 * and multiple sessions can share the same instance.
 *
 * Instance naming is transparent to the photon developer —
 * the runtime handles everything via _use/_instances tools.
 */

import { PhotonLoader } from '../loader.js';
import { PhotonSession } from './protocol.js';
import { Logger, createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';

const DEFAULT_INSTANCE = '';

export class SessionManager {
  private sessions = new Map<string, PhotonSession>();
  /** Maps instanceName → loaded photon instance (shared across sessions) */
  private instances = new Map<string, any>();
  private photonPath: string;
  private photonName: string;
  public loader: PhotonLoader;
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

    this.startCleanup();
  }

  /**
   * Get or create a session. New sessions start on the default instance.
   */
  async getOrCreateSession(
    sessionId: string | undefined,
    clientType?: string
  ): Promise<PhotonSession> {
    const id = sessionId || 'default';

    if (this.sessions.has(id)) {
      const session = this.sessions.get(id)!;
      session.lastActivity = Date.now();
      return session;
    }

    // New session → default instance
    this.logger.info(`Creating new session: ${id}`, { clientType: clientType || 'unknown' });

    try {
      const instance = await this.getOrLoadInstance(DEFAULT_INSTANCE);

      const session: PhotonSession = {
        id,
        instance,
        instanceName: DEFAULT_INSTANCE,
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
   * Switch a session to a different named instance.
   * Loads the instance if not already loaded.
   */
  async switchInstance(sessionId: string, instanceName: string): Promise<PhotonSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const instance = await this.getOrLoadInstance(instanceName);
    session.instance = instance;
    session.instanceName = instanceName;
    session.lastActivity = Date.now();

    this.logger.info('Session switched instance', {
      sessionId,
      instanceName: instanceName || 'default',
    });

    return session;
  }

  /**
   * Get or load a photon instance for a given instanceName.
   * Instances are shared: multiple sessions on the same instanceName share state.
   */
  private async getOrLoadInstance(instanceName: string): Promise<any> {
    const key = instanceName || 'default';

    if (this.instances.has(key)) {
      return this.instances.get(key)!;
    }

    this.logger.info('Loading instance', {
      instanceName: key,
      photon: this.photonName,
    });

    const instance = await this.loader.loadFile(this.photonPath, { instanceName });
    this.instances.set(key, instance);
    return instance;
  }

  /**
   * List all loaded instance names.
   */
  getLoadedInstances(): string[] {
    return Array.from(this.instances.keys());
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
    // Also update the instances map
    const key = session.instanceName || 'default';
    this.instances.set(key, newInstance);
    return true;
  }

  /**
   * Clean up idle sessions (instances stay loaded until daemon shutdown)
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
    this.instances.clear();
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
