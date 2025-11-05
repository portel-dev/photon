/**
 * RemoteOps Photon MCP - SSH and Rsync Wrapper for Remote Operations
 *
 * Exposes a unified API for remote code backup, deployment, SQL dump, and other SSH/rsync-based workflows.
 * Uses system ssh/rsync via child_process for reliability and flexibility.
 *
 * Example: await remoteOps.backup({
 *   localPath: './src',
 *   remoteUser: 'user',
 *   remoteHost: 'host.com',
 *   remotePath: '/backup/src'
 * })
 *
 * Dependencies: none (uses built-in child_process)
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export default class RemoteOps {
  /**
   * Backup local files to remote using rsync over SSH.
   */
  async backup(params: {
    localPath: string;
    remoteUser: string;
    remoteHost: string;
    remotePath: string;
    options?: string;
  }) {
    const { localPath, remoteUser, remoteHost, remotePath, options = '-az' } = params;
    const cmd = `rsync ${options} ${localPath} ${remoteUser}@${remoteHost}:${remotePath}`;
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) throw new Error(stderr);
    return { result: stdout, operation: 'backup', command: cmd };
  }

  /**
   * Deploy files from local to remote (rsync, can be customized).
   */
  async deploy(params: {
    localPath: string;
    remoteUser: string;
    remoteHost: string;
    remotePath: string;
    options?: string;
  }) {
    // For now, same as backup; can add pre/post hooks
    return this.backup(params);
  }

  /**
   * Run a remote shell command over SSH.
   */
  async ssh(params: {
    remoteUser: string;
    remoteHost: string;
    command: string;
  }) {
    const { remoteUser, remoteHost, command } = params;
    const cmd = `ssh ${remoteUser}@${remoteHost} '${command.replace(/'/g, "'\\''")}'`;
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) throw new Error(stderr);
    return { result: stdout, operation: 'ssh', command: cmd };
  }

  /**
   * Dump a remote SQL database to a local file using SSH.
   */
  async sqlDump(params: {
    remoteUser: string;
    remoteHost: string;
    dbUser: string;
    dbName: string;
    outFile: string;
    dbPassword?: string;
    options?: string;
  }) {
    const { remoteUser, remoteHost, dbUser, dbName, outFile, dbPassword, options = '' } = params;
    let dumpCmd = `mysqldump ${options} -u${dbUser}`;
    if (dbPassword) dumpCmd += ` -p${dbPassword}`;
    dumpCmd += ` ${dbName}`;
    const cmd = `ssh ${remoteUser}@${remoteHost} '${dumpCmd.replace(/'/g, "'\\''")}' > ${outFile}`;
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) throw new Error(stderr);
    return { result: stdout, operation: 'sqlDump', command: cmd };
  }
}
