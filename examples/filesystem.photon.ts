/**
 * Filesystem Photon MCP - File and directory operations
 *
 * Provides essential file system utilities: read, write, list, search, delete files and directories.
 * All paths are resolved relative to the current working directory for security.
 *
 * Example: read({ path: "README.md" }) → file contents
 *
 * Run with: npx photon filesystem.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import { readFile, writeFile, readdir, mkdir, rm, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { existsSync } from 'fs';

export default class Filesystem {
  private cwd: string = process.cwd();

  async onInitialize() {
    console.error(`[filesystem] Initialized with CWD: ${this.cwd}`);
  }

  /**
   * Read file contents
   * @param path Path to file (relative to CWD)
   * @param encoding File encoding (default: utf-8)
   */
  async read(params: { path: string; encoding?: 'utf-8' | 'base64' }) {
    try {
      const fullPath = this._resolvePath(params.path);
      const encoding = params.encoding || 'utf-8';
      const content = await readFile(fullPath, encoding as BufferEncoding);
      return { success: true, content, path: fullPath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Write content to file
   * @param path Path to file (relative to CWD)
   * @param content Content to write
   * @param encoding File encoding (default: utf-8)
   */
  async write(params: { path: string; content: string; encoding?: 'utf-8' | 'base64' }) {
    try {
      const fullPath = this._resolvePath(params.path);
      const encoding = params.encoding || 'utf-8';
      await writeFile(fullPath, params.content, encoding as BufferEncoding);
      return { success: true, message: `File written: ${fullPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List files and directories
   * @param path Directory path (relative to CWD, default: current directory)
   * @param recursive List recursively (default: false)
   */
  async list(params: { path?: string; recursive?: boolean }) {
    try {
      const dirPath = this._resolvePath(params.path || '.');
      const entries = await this._listRecursive(dirPath, params.recursive || false);
      return { success: true, path: dirPath, entries };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if file or directory exists
   * @param path Path to check (relative to CWD)
   */
  async exists(params: { path: string }) {
    try {
      const fullPath = this._resolvePath(params.path);
      const exists = existsSync(fullPath);

      if (exists) {
        const stats = await stat(fullPath);
        return {
          success: true,
          exists: true,
          type: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size,
        };
      }

      return { success: true, exists: false };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Search for text in files (grep-like)
   * @param pattern Text pattern to search for
   * @param path Directory to search in (relative to CWD, default: current directory)
   * @param filePattern File pattern to match (e.g., "*.ts", default: all files)
   */
  async search(params: { pattern: string; path?: string; filePattern?: string }) {
    try {
      const dirPath = this._resolvePath(params.path || '.');
      const files = await this._listRecursive(dirPath, true);
      const matches: { file: string; line: number; content: string }[] = [];

      for (const file of files) {
        if (params.filePattern && !this._matchesPattern(file, params.filePattern)) {
          continue;
        }

        try {
          const fullPath = join(dirPath, file);
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            if (line.includes(params.pattern)) {
              matches.push({
                file,
                line: index + 1,
                content: line.trim(),
              });
            }
          });
        } catch {
          // Skip files that can't be read as text
        }
      }

      return { success: true, pattern: params.pattern, matches };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete file or directory
   * @param path Path to delete (relative to CWD)
   * @param recursive Delete directory recursively (default: false)
   */
  async delete(params: { path: string; recursive?: boolean }) {
    try {
      const fullPath = this._resolvePath(params.path);
      await rm(fullPath, { recursive: params.recursive || false, force: true });
      return { success: true, message: `Deleted: ${fullPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create directory
   * @param path Directory path (relative to CWD)
   * @param recursive Create parent directories if needed (default: true)
   */
  async mkdir(params: { path: string; recursive?: boolean }) {
    try {
      const fullPath = this._resolvePath(params.path);
      await mkdir(fullPath, { recursive: params.recursive !== false });
      return { success: true, message: `Directory created: ${fullPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Private helper methods

  private _resolvePath(path: string): string {
    const resolved = resolve(this.cwd, path);

    // Security: ensure path is within CWD
    const rel = relative(this.cwd, resolved);
    if (rel.startsWith('..') || resolve(rel) === rel) {
      throw new Error(`Access denied: path outside working directory`);
    }

    return resolved;
  }

  private async _listRecursive(dir: string, recursive: boolean): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(this.cwd, fullPath);

      if (entry.isDirectory()) {
        if (recursive) {
          const subFiles = await this._listRecursive(fullPath, true);
          files.push(...subFiles);
        } else {
          files.push(relativePath + '/');
        }
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }

  private _matchesPattern(filename: string, pattern: string): boolean {
    // Simple glob matching: "*.ts" -> ends with .ts
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      return filename.endsWith(ext);
    }
    return filename.includes(pattern);
  }
}
