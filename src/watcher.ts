/**
 * File Watcher for Dev Mode
 *
 * Watches .photon.ts file for changes and triggers hot reload
 */

import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'path';
import { PhotonServer } from './server.js';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private server: PhotonServer;
  private filePath: string;
  private reloadTimeout: NodeJS.Timeout | null = null;

  constructor(server: PhotonServer, filePath: string) {
    this.server = server;
    this.filePath = path.resolve(filePath);
  }

  /**
   * Start watching the file
   */
  start() {
    console.error(`Watching ${path.basename(this.filePath)} for changes...`);

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
      console.error(`Watcher error: ${message}`);
    });
  }

  /**
   * Handle file change event
   */
  private handleFileChange(changedPath: string) {
    console.error(`♻️  File changed: ${path.basename(changedPath)}`);

    // Debounce rapid changes
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }

    this.reloadTimeout = setTimeout(async () => {
      try {
        await this.server.reload();
        console.error('✅ Hot reload complete');
      } catch (error: any) {
        console.error(`❌ Hot reload failed: ${error.message}`);
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

    console.error('File watcher stopped');
  }
}
