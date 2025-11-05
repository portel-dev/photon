/**
 * Git Photon MCP - Git version control operations
 *
 * Provides common git operations: status, log, diff, commit, branch, pull, push.
 * Executes git commands in the current working directory.
 *
 * Example: status({}) → git status output
 *
 * Run with: npx photon git.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default class Git {
  private cwd: string = process.cwd();

  async onInitialize() {
    console.error(`[git] Initialized in directory: ${this.cwd}`);
  }

  /**
   * Get git status
   */
  async status(params: {}) {
    return this._exec('git status');
  }

  /**
   * Get git log
   * @param limit Number of commits to show (default: 10)
   * @param oneline Show one line per commit (default: false)
   */
  async log(params: { limit?: number; oneline?: boolean }) {
    const limit = params.limit || 10;
    const format = params.oneline ? '--oneline' : '';
    return this._exec(`git log ${format} -n ${limit}`);
  }

  /**
   * Get git diff
   * @param cached Show staged changes (default: false)
   * @param file Optional file path to diff
   */
  async diff(params: { cached?: boolean; file?: string }) {
    const cached = params.cached ? '--cached' : '';
    const file = params.file || '';
    return this._exec(`git diff ${cached} ${file}`.trim());
  }

  /**
   * Stage files for commit
   * @param files Files to add (use "." for all files)
   */
  async add(params: { files: string }) {
    return this._exec(`git add ${params.files}`);
  }

  /**
   * Commit staged changes
   * @param message Commit message
   */
  async commit(params: { message: string }) {
    // Escape single quotes in commit message
    const escapedMessage = params.message.replace(/'/g, "'\\''");
    return this._exec(`git commit -m '${escapedMessage}'`);
  }

  /**
   * List, create, or delete branches
   * @param action Action to perform: list, create, or delete
   * @param name Branch name (required for create/delete)
   */
  async branch(params: { action: 'list' | 'create' | 'delete'; name?: string }) {
    switch (params.action) {
      case 'list':
        return this._exec('git branch -a');
      case 'create':
        if (!params.name) {
          return { success: false, error: 'Branch name required for create action' };
        }
        return this._exec(`git branch ${params.name}`);
      case 'delete':
        if (!params.name) {
          return { success: false, error: 'Branch name required for delete action' };
        }
        return this._exec(`git branch -d ${params.name}`);
      default:
        return { success: false, error: 'Invalid action. Use: list, create, or delete' };
    }
  }

  /**
   * Switch to a branch
   * @param branch Branch name to switch to
   * @param create Create branch if it doesn't exist (default: false)
   */
  async checkout(params: { branch: string; create?: boolean }) {
    const createFlag = params.create ? '-b' : '';
    return this._exec(`git checkout ${createFlag} ${params.branch}`.trim());
  }

  /**
   * Pull changes from remote
   * @param remote Remote name (default: origin)
   * @param branch Branch name (optional)
   */
  async pull(params: { remote?: string; branch?: string }) {
    const remote = params.remote || 'origin';
    const branch = params.branch || '';
    return this._exec(`git pull ${remote} ${branch}`.trim());
  }

  /**
   * Push changes to remote
   * @param remote Remote name (default: origin)
   * @param branch Branch name (optional)
   * @param setUpstream Set upstream branch (default: false)
   */
  async push(params: { remote?: string; branch?: string; setUpstream?: boolean }) {
    const remote = params.remote || 'origin';
    const branch = params.branch || '';
    const upstreamFlag = params.setUpstream ? '-u' : '';
    return this._exec(`git push ${upstreamFlag} ${remote} ${branch}`.trim());
  }

  /**
   * Clone a repository
   * @param url Repository URL
   * @param directory Target directory (optional)
   */
  async clone(params: { url: string; directory?: string }) {
    const dir = params.directory || '';
    return this._exec(`git clone ${params.url} ${dir}`.trim());
  }

  /**
   * Show commit details
   * @param hash Commit hash (default: HEAD)
   */
  async show(params: { hash?: string }) {
    const hash = params.hash || 'HEAD';
    return this._exec(`git show ${hash}`);
  }

  /**
   * Reset changes
   * @param mode Reset mode: soft, mixed, or hard
   * @param target Target commit (default: HEAD)
   */
  async reset(params: { mode: 'soft' | 'mixed' | 'hard'; target?: string }) {
    const target = params.target || 'HEAD';
    return this._exec(`git reset --${params.mode} ${target}`);
  }

  /**
   * Stash changes
   * @param action Stash action: save, list, pop, or apply
   * @param message Optional stash message (for save action)
   */
  async stash(params: { action: 'save' | 'list' | 'pop' | 'apply'; message?: string }) {
    switch (params.action) {
      case 'save':
        const msg = params.message ? ` -m "${params.message}"` : '';
        return this._exec(`git stash push${msg}`);
      case 'list':
        return this._exec('git stash list');
      case 'pop':
        return this._exec('git stash pop');
      case 'apply':
        return this._exec('git stash apply');
      default:
        return { success: false, error: 'Invalid action. Use: save, list, pop, or apply' };
    }
  }

  // Private helper methods

  private async _exec(command: string) {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: this.cwd });

      // Git often uses stderr for informational messages
      const output = stdout || stderr;

      return {
        success: true,
        output: output.trim(),
        command,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr,
        command,
      };
    }
  }
}
