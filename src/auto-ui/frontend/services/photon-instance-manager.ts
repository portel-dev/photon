/**
 * Global Photon Session Manager
 *
 * Manages photon sessions available in window scope (e.g., window.boards).
 * Sessions are kept in sync with server state via state-changed events,
 * allowing UI to bind directly to global sessions and receive automatic updates.
 */

export interface PaginationState {
  pageSize: number;
  currentPage: number;
  totalItems?: number;
  hasMore?: boolean;
  isLoading?: boolean;
}

export interface PhotonSessionProxyOptions {
  name: string;
  initialState: Record<string, any>;
  emitStateChanged?: boolean;
}

/**
 * Simple event emitter for browser
 */
class SimpleEventEmitter {
  private _listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  on(event: string, callback: (...args: any[]) => void): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: any[]) => void): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        callback(...args);
      }
    }
  }
}

/**
 * Creates a reactive proxy of a photon session that:
 * - Applies JSON Patch updates from server
 * - Emits events when state changes
 * - Maintains pagination tracking
 * - Allows UI to bind directly to the session
 */
export class PhotonSessionProxy extends SimpleEventEmitter {
  private _name: string;
  private _state: Record<string, any>;
  private _paginationState: Map<string, PaginationState> = new Map();
  private _pendingPatches: any[] = [];
  private _isApplyingPatches: boolean = false;

  constructor(options: PhotonSessionProxyOptions) {
    super();
    this._name = options.name;
    this._state = { ...options.initialState };
  }

  /**
   * Get the photon name
   */
  get name(): string {
    return this._name;
  }

  /**
   * Get current state
   */
  get state(): Record<string, any> {
    return this._state;
  }

  /**
   * Apply JSON Patch array to instance state
   * Patches from: https://tools.ietf.org/html/rfc6902
   */
  applyPatches(patches: any[]): void {
    if (!Array.isArray(patches) || patches.length === 0) {
      return;
    }

    this._pendingPatches.push(...patches);

    // Process patches in a microtask to batch updates
    if (!this._isApplyingPatches) {
      this._isApplyingPatches = true;
      queueMicrotask(() => this._processPendingPatches());
    }
  }

  /**
   * Update pagination state for a property (e.g., 'items')
   */
  setPaginationState(property: string, state: Partial<PaginationState>): void {
    const current = this._paginationState.get(property) || {
      pageSize: 20,
      currentPage: 0,
      hasMore: true,
      isLoading: false,
    };
    this._paginationState.set(property, { ...current, ...state });
  }

  /**
   * Get pagination state for a property
   */
  getPaginationState(property: string): PaginationState {
    return (
      this._paginationState.get(property) || {
        pageSize: 20,
        currentPage: 0,
        hasMore: true,
        isLoading: false,
      }
    );
  }

  /**
   * Direct property access for UI binding (e.g., boards.items)
   */
  [key: string]: any;

  /**
   * Create a getter/setter for property access
   */
  private _createPropertyDescriptor(key: string): PropertyDescriptor {
    return {
      configurable: true,
      enumerable: true,
      get: () => this._state[key],
      set: (value: any) => {
        this._state[key] = value;
        this.emit('propertyChanged', { property: key, value });
      },
    };
  }

  /**
   * Make a property accessible on the proxy
   */
  makeProperty(key: string): void {
    Object.defineProperty(this, key, this._createPropertyDescriptor(key));
  }

  /**
   * Get all top-level properties (useful for initialization)
   */
  getProperties(): string[] {
    return Object.keys(this._state);
  }

  /**
   * Process pending patches
   */
  private _processPendingPatches(): void {
    const patches = this._pendingPatches.splice(0);

    try {
      for (const patch of patches) {
        this._applyPatch(patch);
      }

      // Emit state-changed event with all processed patches
      this.emit('state-changed', patches);
    } finally {
      this._isApplyingPatches = false;

      // Process any patches added during processing
      if (this._pendingPatches.length > 0) {
        queueMicrotask(() => this._processPendingPatches());
      }
    }
  }

  /**
   * Apply a single JSON Patch operation
   */
  private _applyPatch(patch: any): void {
    const { op, path, value } = patch;

    if (!path || typeof path !== 'string') {
      console.warn('Invalid patch: missing or invalid path', patch);
      return;
    }

    const parts = path.split('/').filter((p) => p !== '');
    let current = this._state;

    try {
      // Navigate to parent object
      for (let i = 0; i < parts.length - 1; i++) {
        const part = this._unescapePath(parts[i]);
        if (!(part in current)) {
          current[part] = {};
        }
        current = current[part];
      }

      const lastPart = this._unescapePath(parts[parts.length - 1]);

      switch (op) {
        case 'add':
          if (Array.isArray(current) && !isNaN(Number(lastPart))) {
            // Array add
            const index = Number(lastPart);
            current.splice(index, 0, value);
          } else {
            // Object add
            current[lastPart] = value;
          }
          break;

        case 'remove':
          if (Array.isArray(current) && !isNaN(Number(lastPart))) {
            // Array remove
            const index = Number(lastPart);
            current.splice(index, 1);
          } else {
            // Object remove
            delete current[lastPart];
          }
          break;

        case 'replace':
          current[lastPart] = value;
          break;

        case 'move':
          const fromParts = patch.from.split('/').filter((p: string) => p !== '');
          let fromCurrent = this._state;
          for (let i = 0; i < fromParts.length - 1; i++) {
            fromCurrent = fromCurrent[this._unescapePath(fromParts[i])];
          }
          const fromLast = this._unescapePath(fromParts[fromParts.length - 1]);
          const movedValue = fromCurrent[fromLast];

          if (Array.isArray(fromCurrent)) {
            fromCurrent.splice(Number(fromLast), 1);
          } else {
            delete fromCurrent[fromLast];
          }

          if (Array.isArray(current)) {
            current.splice(Number(lastPart), 0, movedValue);
          } else {
            current[lastPart] = movedValue;
          }
          break;

        case 'copy':
          const copyFromParts = patch.from.split('/').filter((p: string) => p !== '');
          let copyCurrent = this._state;
          for (let i = 0; i < copyFromParts.length - 1; i++) {
            copyCurrent = copyCurrent[this._unescapePath(copyFromParts[i])];
          }
          const copyFromLast = this._unescapePath(copyFromParts[copyFromParts.length - 1]);
          const copiedValue = JSON.parse(JSON.stringify(copyCurrent[copyFromLast]));
          current[lastPart] = copiedValue;
          break;

        case 'test':
          // For test op, we don't modify, just validate
          if (current[lastPart] !== value) {
            throw new Error(`Test failed at ${path}: expected ${value}, got ${current[lastPart]}`);
          }
          break;

        default:
          console.warn(`Unknown patch operation: ${op}`);
      }
    } catch (error) {
      console.error('Failed to apply patch', { patch, error });
      throw error;
    }
  }

  /**
   * Unescape JSON Pointer path component
   * See: https://tools.ietf.org/html/rfc6901
   */
  private _unescapePath(part: string): string {
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  /**
   * Clear all state
   */
  reset(newState: Record<string, any>): void {
    this._state = { ...newState };
    this._paginationState.clear();
    this.emit('reset');
  }
}

/**
 * Global session manager - maintains all active photon sessions
 */
export class GlobalSessionManager {
  private _sessions: Map<string, PhotonSessionProxy> = new Map();

  /**
   * Create or get a photon session
   */
  createOrGetSession(name: string, initialState: Record<string, any>): PhotonSessionProxy {
    if (this._sessions.has(name)) {
      return this._sessions.get(name)!;
    }

    const session = new PhotonSessionProxy({
      name,
      initialState,
    });

    // Make all initial properties accessible
    Object.keys(initialState).forEach((key) => {
      session.makeProperty(key);
    });

    this._sessions.set(name, session);
    return session;
  }

  /**
   * Get existing session
   */
  getSession(name: string): PhotonSessionProxy | undefined {
    return this._sessions.get(name);
  }

  /**
   * Apply patches to a session
   */
  applyPatches(name: string, patches: any[]): boolean {
    const session = this._sessions.get(name);
    if (!session) {
      console.warn(`No session found for: ${name}`);
      return false;
    }
    session.applyPatches(patches);
    return true;
  }

  /**
   * Remove session
   */
  removeSession(name: string): void {
    this._sessions.delete(name);
  }

  /**
   * Get all session names
   */
  getSessionNames(): string[] {
    return Array.from(this._sessions.keys());
  }
}

// Global singleton
let globalSessionManager: GlobalSessionManager | null = null;

/**
 * Get or create the global session manager
 */
export function getGlobalSessionManager(): GlobalSessionManager {
  if (!globalSessionManager) {
    globalSessionManager = new GlobalSessionManager();
    // Expose on window for debugging
    if (typeof window !== 'undefined') {
      (window as any).__photonSessionManager = globalSessionManager;
    }
  }
  return globalSessionManager;
}

/**
 * Initialize global photon session with given initial state
 * Typically called from beam-app.ts on startup
 */
export function initializeGlobalPhotonSession(
  photonName: string,
  initialState: Record<string, any>
): PhotonSessionProxy {
  const manager = getGlobalSessionManager();
  const session = manager.createOrGetSession(photonName, initialState);

  // Inject into window with camelCase name
  // e.g., 'boards' → window.boards
  if (typeof window !== 'undefined') {
    const varName = photonName.charAt(0).toLocaleLowerCase() + photonName.slice(1);
    (window as any)[varName] = session;

    // Also expose via common aliases
    if (photonName === 'Boards') {
      (window as any).boards = session;
      (window as any).boardsSession = session;
    }
  }

  return session;
}

/**
 * DEPRECATED: Use PhotonSessionProxy instead
 * Kept for backward compatibility
 */
export type PhotonInstanceProxy = PhotonSessionProxy;
export type PhotonInstanceProxyOptions = PhotonSessionProxyOptions;
export type GlobalInstanceManager = GlobalSessionManager;
export const getGlobalInstanceManager = getGlobalSessionManager;
export const initializeGlobalPhotonInstance = initializeGlobalPhotonSession;
