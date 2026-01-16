/**
 * File Watcher for Dev Mode
 *
 * Watches .photon.ts file for changes and triggers hot reload
 */

import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'path';
import { PhotonServer, HotReloadDisabledError } from './server.js';
import { Logger, createLogger } from './shared/logger.js';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private server: PhotonServer;
  private filePath: string;
  private reloadTimeout: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(server: PhotonServer, filePath: string, logger?: Logger) {
    this.server = server;
    this.filePath = path.resolve(filePath);
    this.logger =
      logger ?? createLogger({ component: 'file-watcher', scope: path.basename(filePath) });
  }

  /**
   * Start watching the file
   */
  start() {
    this.logger.info(`Watching ${path.basename(this.filePath)} for changes...`);

    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('change', (changedPath: string) => {
      this.handleFileChange(changedPath);
    });

    this.watcher.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Watcher error: ${message}`);
    });
  }

  /**
   * Handle file change event
   */
  private handleFileChange(changedPath: string) {
    this.logger.info(`File changed: ${path.basename(changedPath)}`);

    // Debounce rapid changes
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }

    this.reloadTimeout = setTimeout(async () => {
      try {
        await this.server.reload();
        this.logger.info('Hot reload complete');
      } catch (error: any) {
        if (error instanceof HotReloadDisabledError) {
          this.logger.error(error.message);
          await this.stop();
        } else {
          this.logger.error(`Hot reload failed: ${error.message}`);
        }
      }
    }, 200);
  }

  /**
   * Stop watching
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }

    this.logger.info('File watcher stopped');
  }
}
