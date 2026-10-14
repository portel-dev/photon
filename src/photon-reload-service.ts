import type { PhotonClassExtended } from '@portel/photon-core';

export class HotReloadDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotReloadDisabledError';
  }
}

export interface PhotonReloadServiceOptions {
  filePath: () => string;
  loader: {
    reloadFile(path: string, options: { skipInitialize: true }): Promise<PhotonClassExtended>;
  };
  photon: {
    get(): PhotonClassExtended | null;
    set(next: PhotonClassExtended): void;
  };
  notifications: {
    notifyListsChanged(): Promise<void>;
    broadcastStatus(type: 'info' | 'error', message: string): Promise<void>;
  };
  log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void;
  now?: () => number;
}

export class PhotonReloadService {
  private failureCount = 0;
  private disabled = false;
  private lastError?: { message: string; stack?: string; timestamp: number; attempts: number };
  private retryTimeout?: NodeJS.Timeout;
  private readonly now: () => number;
  private readonly maxFailures = 3;

  constructor(private readonly options: PhotonReloadServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getState() {
    return { hotReloadDisabled: this.disabled, lastReloadError: this.lastError };
  }

  setDisabledForTests(disabled: boolean): void {
    this.disabled = disabled;
  }

  async reload(): Promise<void> {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
    }
    if (this.disabled) {
      throw new HotReloadDisabledError(
        'Hot reload temporarily disabled after repeated failures. Restart Photon or fix the errors to re-enable.'
      );
    }

    try {
      this.options.log('info', 'Reloading Photon');
      const oldPhoton = this.options.photon.get();
      if (oldPhoton?.instance?.onShutdown) {
        try {
          await oldPhoton.instance.onShutdown({ reason: 'hot-reload' });
        } catch (error) {
          this.options.log('warn', 'Shutdown hook failed during reload', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const next = await this.options.loader.reloadFile(this.options.filePath(), {
        skipInitialize: true,
      });
      if (oldPhoton?.instance && next.instance && typeof oldPhoton.instance === 'object') {
        const oldRecord = oldPhoton.instance as Record<string, unknown>;
        const nextRecord = next.instance as Record<string, unknown>;
        for (const key of Object.keys(oldRecord)) {
          if (key === 'constructor' || typeof oldRecord[key] === 'function') continue;
          try {
            nextRecord[key] = oldRecord[key];
          } catch {
            // Some runtime properties are read-only.
          }
        }
      }

      if (next.instance?.onInitialize) {
        await next.instance.onInitialize({
          reason: 'hot-reload',
          oldInstance: oldPhoton?.instance,
        });
      }

      this.options.photon.set(next);
      this.failureCount = 0;
      this.disabled = false;
      this.lastError = undefined;
      await this.options.notifications.notifyListsChanged();
      await this.options.notifications.broadcastStatus('info', 'Hot reload complete');
      this.options.log('info', 'Reload complete');
    } catch (error) {
      this.failureCount++;
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = {
        message,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: this.now(),
        attempts: this.failureCount,
      };
      this.options.log('error', 'Reload failed', {
        attempt: this.failureCount,
        maxAttempts: this.maxFailures,
        error: message,
      });
      await this.options.notifications.broadcastStatus('error', `Hot reload failed: ${message}`);

      if (this.failureCount >= this.maxFailures) {
        this.options.log('error', 'Maximum reload failures reached', {
          maxAttempts: this.maxFailures,
          action: 'keeping previous version active',
        });
        this.options.log('info', 'Server still running with previous version');
        this.disabled = true;
        this.failureCount = 0;
        throw new HotReloadDisabledError(
          'Hot reload disabled after repeated failures. Restart Photon dev server once the errors are resolved.'
        );
      }

      const retryDelay = Math.min(5000 * this.failureCount, 15000);
      this.options.log('warn', 'Reload failed - waiting for next change', {
        retrySeconds: retryDelay / 1000,
      });
      this.options.log('info', 'Server still running with previous version');
      throw error;
    }
  }
}
