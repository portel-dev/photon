/**
 * Global Photon Instance Manager
 *
 * Manages photon instances available in window scope (e.g., window.boards).
 * Instances are kept in sync with server state via state-changed events,
 * allowing UI to bind directly to global instances and receive automatic updates.
 */

export interface PaginationState {
  pageSize: number;
  currentPage: number;
  totalItems?: number;
  hasMore?: boolean;
  isLoading?: boolean;
}

export interface PhotonInstanceProxyOptions {
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
 * Creates a reactive proxy of a photon instance that:
 * - Applies JSON Patch updates from server
 * - Emits events when state changes
 * - Maintains pagination tracking
 * - Allows UI to bind directly to the instance
 */
export class PhotonInstanceProxy extends SimpleEventEmitter {
  private _name: string;
  private _state: Record<string, any>;
  private _paginationState: Map<string, PaginationState> = new Map();
  private _pendingPatches: any[] = [];
  private _isApplyingPatches: boolean = false;

  constructor(options: PhotonInstanceProxyOptions) {
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
 * Global instance manager - maintains all active photon instances
 */
export class GlobalInstanceManager {
  private _instances: Map<string, PhotonInstanceProxy> = new Map();

  /**
   * Create or get a photon instance
   */
  createOrGetInstance(name: string, initialState: Record<string, any>): PhotonInstanceProxy {
    if (this._instances.has(name)) {
      return this._instances.get(name)!;
    }

    const instance = new PhotonInstanceProxy({
      name,
      initialState,
    });

    // Make all initial properties accessible
    Object.keys(initialState).forEach((key) => {
      instance.makeProperty(key);
    });

    this._instances.set(name, instance);
    return instance;
  }

  /**
   * Get existing instance
   */
  getInstance(name: string): PhotonInstanceProxy | undefined {
    return this._instances.get(name);
  }

  /**
   * Apply patches to an instance
   */
  applyPatches(name: string, patches: any[]): boolean {
    const instance = this._instances.get(name);
    if (!instance) {
      console.warn(`No instance found for: ${name}`);
      return false;
    }
    instance.applyPatches(patches);
    return true;
  }

  /**
   * Remove instance
   */
  removeInstance(name: string): void {
    this._instances.delete(name);
  }

  /**
   * Get all instance names
   */
  getInstanceNames(): string[] {
    return Array.from(this._instances.keys());
  }
}

// Global singleton
let globalManagerInstance: GlobalInstanceManager | null = null;

/**
 * Get or create the global instance manager
 */
export function getGlobalInstanceManager(): GlobalInstanceManager {
  if (!globalManagerInstance) {
    globalManagerInstance = new GlobalInstanceManager();
    // Expose on window for debugging
    if (typeof window !== 'undefined') {
      (window as any).__photonInstanceManager = globalManagerInstance;
    }
  }
  return globalManagerInstance;
}

/**
 * Initialize global photon instance with given initial state
 * Typically called from beam-app.ts on startup
 */
export function initializeGlobalPhotonInstance(
  photonName: string,
  initialState: Record<string, any>
): PhotonInstanceProxy {
  const manager = getGlobalInstanceManager();
  const instance = manager.createOrGetInstance(photonName, initialState);

  // Inject into window with camelCase name
  // e.g., 'boards' → window.boards
  if (typeof window !== 'undefined') {
    const varName = photonName.charAt(0).toLocaleLowerCase() + photonName.slice(1);
    (window as any)[varName] = instance;

    // Also expose via common aliases
    if (photonName === 'Boards') {
      (window as any).boards = instance;
      (window as any).boardsInstance = instance;
    }
  }

  return instance;
}
