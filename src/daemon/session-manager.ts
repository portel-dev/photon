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
  /** Inflight instance loads — prevents concurrent duplicate loadFile calls */
  private inflightLoads = new Map<string, Promise<any>>();
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
    logger?: Logger,
    workingDir?: string
  ) {
    this.photonPath = photonPath;
    this.photonName = photonName;
    this.sessionTimeout = sessionTimeout;
    this.logger =
      logger ?? createLogger({ component: 'session-manager', scope: photonName, minimal: true });
    this.loader = new PhotonLoader(
      false,
      this.logger.child({ component: 'photon-loader', scope: photonName }),
      workingDir
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
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const instance = await this.getOrLoadInstance(instanceName);

    // Re-check: session may have been cleaned up during the await above
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session expired during instance switch: ${sessionId}`);
    }

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

    // Dedup: concurrent callers join the same inflight promise
    const inflight = this.inflightLoads.get(key);
    if (inflight) return inflight;

    this.logger.info('Loading instance', {
      instanceName: key,
      photon: this.photonName,
    });

    const promise = this.loader.loadFile(this.photonPath, { instanceName }).then(
      (instance) => {
        this.inflightLoads.delete(key);
        this.instances.set(key, instance);
        return instance;
      },
      (error) => {
        this.inflightLoads.delete(key);
        throw error;
      }
    );

    this.inflightLoads.set(key, promise);
    return promise;
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
   * Migrate this session manager to a new workingDir (e.g. after a rename).
   * Updates the loader's baseDir so all subsequent loadFile calls set
   * PHOTON_DIR to the new path — photon module-level constants like STATE_DIR
   * pick up the new location on the next fresh import.
   */
  async migrateBaseDir(newBaseDir: string): Promise<void> {
    this.loader.baseDir = newBaseDir;
    await this.clearInstances();
    this.logger.info('Migrated baseDir', { photon: this.photonName, newBaseDir });
  }

  /**
   * Clear all cached instances and reload active sessions from disk.
   * Called when the workingDir is freshly created to avoid stale in-memory state.
   */
  async clearInstances(): Promise<void> {
    this.instances.clear();
    this.inflightLoads.clear();
    // Snapshot sessions before async iteration — Map may be modified during awaits
    const sessionSnapshot = Array.from(this.sessions.values());
    for (const session of sessionSnapshot) {
      try {
        const newInstance = await this.loader.loadFile(this.photonPath, {
          instanceName: session.instanceName || 'default',
        });
        // Re-check session still exists after await
        if (this.sessions.has(session.id)) {
          session.instance = newInstance;
          this.instances.set(session.instanceName || 'default', newInstance);
        }
      } catch (err) {
        this.logger.error('Failed to reload instance after clear', {
          sessionId: session.id,
          error: getErrorMessage(err),
        });
      }
    }
    this.logger.info('Cleared instance cache', { photon: this.photonName });
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
    this.inflightLoads.clear();
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
