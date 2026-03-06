/**
 * Phase 6a: ServiceWorkerManager
 *
 * Manages service worker lifecycle including:
 * - Registration and unregistration
 * - Connection state monitoring (online/offline)
 * - Cache management strategies
 * - Lifecycle event handling (installing, activating, installed)
 *
 * Responsible for providing a stable connection layer for offline sync.
 */

export type ServiceWorkerStatus =
  | 'unregistered'
  | 'installing'
  | 'installed'
  | 'updating'
  | 'error';

export interface ServiceWorkerConfig {
  scope?: string;
  debug?: boolean;
}

/**
 * Manages service worker registration and connection state
 */
export class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private status: ServiceWorkerStatus = 'unregistered';
  private isOnline: boolean = navigator.onLine ?? true;
  private debug: boolean;
  private scope: string;

  // Event listeners
  private statusListeners: Array<(status: ServiceWorkerStatus) => void> = [];
  private onlineListeners: Array<() => void> = [];
  private offlineListeners: Array<() => void> = [];
  private updateAvailableListeners: Array<(newSW: ServiceWorker) => void> = [];

  // Cache strategy
  private cacheName: string = 'photon-cache-v1';
  private maxCacheAge: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(config: ServiceWorkerConfig = {}) {
    this.scope = config.scope ?? '/';
    this.debug = config.debug ?? false;

    // Monitor connection state
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    this.log('ServiceWorkerManager initialized', {
      scope: this.scope,
      initialOnline: this.isOnline,
    });
  }

  /**
   * Register service worker
   */
  async register(scriptUrl: string): Promise<ServiceWorkerRegistration> {
    if (!('serviceWorker' in navigator)) {
      this.log('Service Workers not supported');
      throw new Error('Service Workers not supported in this browser');
    }

    try {
      this.setStatus('installing');

      this.registration = await navigator.serviceWorker.register(scriptUrl, {
        scope: this.scope,
      });

      this.log('Service worker registered', {
        url: scriptUrl,
        scope: this.scope,
      });

      // Monitor state changes
      this.monitorLifecycle();

      // Check for updates periodically
      this.startUpdateCheck();

      return this.registration;
    } catch (error) {
      this.setStatus('error');
      this.log('Service worker registration failed', error);
      throw error;
    }
  }

  /**
   * Unregister service worker
   */
  async unregister(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }

    try {
      const success = await this.registration.unregister();
      if (success) {
        this.registration = null;
        this.setStatus('unregistered');
        this.log('Service worker unregistered');
      }
      return success;
    } catch (error) {
      this.log('Failed to unregister service worker', error);
      return false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): ServiceWorkerStatus {
    return this.status;
  }

  /**
   * Get registration
   */
  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }

  /**
   * Check if online
   */
  isOnlineNow(): boolean {
    return this.isOnline;
  }

  /**
   * Listen for status changes
   */
  onStatusChange(callback: (status: ServiceWorkerStatus) => void): void {
    this.statusListeners.push(callback);
  }

  /**
   * Listen for online event
   */
  onOnline(callback: () => void): void {
    this.onlineListeners.push(callback);
  }

  /**
   * Listen for offline event
   */
  onOffline(callback: () => void): void {
    this.offlineListeners.push(callback);
  }

  /**
   * Listen for update available
   */
  onUpdateAvailable(callback: (newSW: ServiceWorker) => void): void {
    this.updateAvailableListeners.push(callback);
  }

  /**
   * Skip waiting - activate new SW immediately
   */
  async skipWaiting(): Promise<void> {
    if (!this.registration?.waiting) {
      return;
    }

    this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    this.log('Sent SKIP_WAITING message to service worker');
  }

  /**
   * Get service worker controller
   */
  getController(): ServiceWorker | null {
    return navigator.serviceWorker.controller;
  }

  /**
   * Send message to service worker
   */
  postMessage(message: any): void {
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(message);
      this.log('Posted message to service worker', message);
    } else {
      this.log('No active service worker controller');
    }
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<boolean> {
    try {
      if (!('caches' in window)) {
        this.log('Cache API not supported');
        return false;
      }

      const cacheNames = await caches.keys();
      const deleted = await Promise.all(
        cacheNames.map((name) => {
          if (name.startsWith('photon-')) {
            return caches.delete(name);
          }
          return Promise.resolve(true);
        })
      );

      this.log('Caches cleared', { count: deleted.length });
      return true;
    } catch (error) {
      this.log('Failed to clear cache', error);
      return false;
    }
  }

  /**
   * Get cache size
   */
  async getCacheSize(): Promise<number> {
    if (!('caches' in window) || !('estimate' in navigator.storage)) {
      return 0;
    }

    try {
      const estimate = await navigator.storage.estimate();
      return estimate.usage ?? 0;
    } catch (error) {
      this.log('Failed to get cache size', error);
      return 0;
    }
  }

  /**
   * Pre-cache resources
   */
  async precache(urls: string[]): Promise<void> {
    if (!('caches' in window)) {
      return;
    }

    try {
      const cache = await caches.open(this.cacheName);
      await cache.addAll(urls);
      this.log('Precached resources', { count: urls.length });
    } catch (error) {
      this.log('Failed to precache resources', error);
    }
  }

  /**
   * Monitor service worker lifecycle
   */
  private monitorLifecycle(): void {
    if (!this.registration) {
      return;
    }

    // Monitor installing worker
    const sw =
      this.registration.installing || this.registration.waiting || this.registration.active;

    if (sw) {
      this.monitorWorkerState(sw);
    }

    // Listen for new workers
    this.registration.addEventListener('updatefound', () => {
      const newWorker = this.registration!.installing;
      if (newWorker) {
        this.monitorWorkerState(newWorker);
      }
    });
  }

  /**
   * Monitor individual worker state
   */
  private monitorWorkerState(worker: ServiceWorker): void {
    const updateStatus = () => {
      if (worker.state === 'installing') {
        this.setStatus('installing');
      } else if (worker.state === 'installed') {
        if (this.registration?.active) {
          // There's an active worker, so this is waiting
          this.setStatus('updating');
          this.notifyUpdateAvailable(worker);
        } else {
          // This is the first activation
          this.setStatus('installed');
        }
      } else if (worker.state === 'activated') {
        this.setStatus('installed');
      }
    };

    updateStatus();
    worker.addEventListener('statechange', updateStatus);
  }

  /**
   * Start periodic update check
   */
  private startUpdateCheck(): void {
    // Check for updates every hour
    setInterval(
      () => {
        if (this.registration) {
          this.registration.update().catch((error) => {
            this.log('Failed to check for updates', error);
          });
        }
      },
      60 * 60 * 1000
    );
  }

  /**
   * Set status and notify listeners
   */
  private setStatus(status: ServiceWorkerStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.notifyStatusListeners(status);
      this.log('Status changed', { status });
    }
  }

  /**
   * Notify status listeners
   */
  private notifyStatusListeners(status: ServiceWorkerStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        this.log('Error in status listener', error);
      }
    }
  }

  /**
   * Notify update available
   */
  private notifyUpdateAvailable(newSW: ServiceWorker): void {
    for (const listener of this.updateAvailableListeners) {
      try {
        listener(newSW);
      } catch (error) {
        this.log('Error in update available listener', error);
      }
    }
  }

  /**
   * Handle online event
   */
  private handleOnline(): void {
    if (!this.isOnline) {
      this.isOnline = true;
      this.log('Online');
      for (const listener of this.onlineListeners) {
        try {
          listener();
        } catch (error) {
          this.log('Error in online listener', error);
        }
      }
    }
  }

  /**
   * Handle offline event
   */
  private handleOffline(): void {
    if (this.isOnline) {
      this.isOnline = false;
      this.log('Offline');
      for (const listener of this.offlineListeners) {
        try {
          listener();
        } catch (error) {
          this.log('Error in offline listener', error);
        }
      }
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[ServiceWorkerManager] ${message}`, data);
    }
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    window.removeEventListener('online', () => this.handleOnline());
    window.removeEventListener('offline', () => this.handleOffline());
    this.statusListeners = [];
    this.onlineListeners = [];
    this.offlineListeners = [];
    this.updateAvailableListeners = [];
    this.log('ServiceWorkerManager destroyed');
  }
}
