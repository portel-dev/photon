/**
 * Tunnel - Expose local servers to the internet
 * @description Multi-provider tunneling for remote access to Beam and local services
 * @icon 🌐
 */

import { spawn, spawnSync, ChildProcess } from 'child_process';

interface TunnelInfo {
  provider: string;
  port: number;
  url: string;
  pid: number;
  startedAt: Date;
  active: boolean;
}

// Track active tunnels
const activeTunnels: Map<number, { process: ChildProcess; info: TunnelInfo }> = new Map();

export default class Tunnel {
  /**
   * Check available tunnel providers
   * @icon 🔍
   */
  async status(): Promise<{
    providers: Array<{
      name: string;
      available: boolean;
      install?: string;
    }>;
    activeTunnels: TunnelInfo[];
  }> {
    // Check which tunnels are still alive
    for (const [port, tunnel] of activeTunnels) {
      if (tunnel.process.killed || tunnel.process.exitCode !== null) {
        tunnel.info.active = false;
        activeTunnels.delete(port);
      }
    }

    const providers = [
      {
        name: 'cloudflared',
        available: this._checkCommand('cloudflared'),
        install: 'brew install cloudflared',
      },
      {
        name: 'ngrok',
        available: this._checkCommand('ngrok'),
        install: 'brew install ngrok',
      },
    ];

    return {
      providers,
      activeTunnels: Array.from(activeTunnels.values()).map((t) => t.info),
    };
  }

  /**
   * Start a tunnel to expose Beam to the internet
   * @icon 🚀
   * @format qr
   * @param provider Tunnel provider to use
   */
  async *start({
    provider = 'cloudflared',
  }: {
    /** Provider: cloudflared or ngrok */
    provider?: 'cloudflared' | 'ngrok';
  } = {}): AsyncGenerator<
    { emit: string; value?: any; message: string },
    {
      message: string;
      url: string;
      link: string;
      provider: string;
      port: number;
    }
  > {
    // Auto-detect Beam port from environment
    const port = parseInt(process.env.BEAM_PORT || '3117', 10);

    // Check if tunnel already exists for this port
    const existing = activeTunnels.get(port);
    if (existing) {
      // Verify the process is still alive
      if (!existing.process.killed && existing.process.exitCode === null) {
        return {
          message: `Tunnel already running`,
          url: existing.info.url,
          link: existing.info.url,
          provider: existing.info.provider,
          port,
        };
      }
      // Process died — clean up and start fresh
      activeTunnels.delete(port);
    }

    yield {
      emit: 'status',
      value: { step: 'starting' },
      message: `Starting ${provider} tunnel on port ${port}...`,
    };

    try {
      let url: string;
      let tunnelProcess: ChildProcess;

      switch (provider) {
        case 'ngrok':
          if (!this._checkCommand('ngrok')) {
            throw new Error('ngrok not installed. Run: brew install ngrok');
          }
          ({ url, process: tunnelProcess } = await this._startNgrok(port));
          break;

        case 'cloudflared':
        default:
          if (!this._checkCommand('cloudflared')) {
            throw new Error('cloudflared not installed. Run: brew install cloudflared');
          }
          ({ url, process: tunnelProcess } = await this._startCloudflared(port));
          break;
      }

      const info: TunnelInfo = {
        provider,
        port,
        url,
        pid: tunnelProcess.pid!,
        startedAt: new Date(),
        active: true,
      };

      activeTunnels.set(port, { process: tunnelProcess, info });

      return {
        message: `Tunnel started successfully`,
        url,
        link: url,
        provider,
        port,
      };
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  /**
   * Stop a tunnel
   * @icon ⏹️
   * @param port Port of the tunnel to stop
   */
  async stop({
    port,
  }: {
    /** Port of the tunnel to stop */
    port: number;
  }): Promise<{ stopped: boolean; message: string }> {
    const tunnel = activeTunnels.get(port);

    if (!tunnel) {
      return { stopped: false, message: `No active tunnel on port ${port}` };
    }

    tunnel.process.kill();
    activeTunnels.delete(port);

    return {
      stopped: true,
      message: `Stopped ${tunnel.info.provider} tunnel on port ${port}`,
    };
  }

  /**
   * Stop all active tunnels
   * @icon ⏹️
   */
  async stopAll(): Promise<{ stopped: number; message: string }> {
    const count = activeTunnels.size;

    for (const [port, tunnel] of activeTunnels) {
      tunnel.process.kill();
      activeTunnels.delete(port);
    }

    return {
      stopped: count,
      message: count > 0 ? `Stopped ${count} tunnel(s)` : 'No active tunnels',
    };
  }

  /**
   * List active tunnels
   * @icon 📋
   */
  async list(): Promise<{ tunnels: TunnelInfo[] }> {
    return {
      tunnels: Array.from(activeTunnels.values()).map((t) => t.info),
    };
  }

  // ============================================
  // Provider Implementations
  // ============================================

  private _checkCommand(cmd: string): boolean {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(which, [cmd], { stdio: 'ignore' });
    return result.status === 0;
  }

  private async _startNgrok(port: number): Promise<{ url: string; process: ChildProcess }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ngrok', ['http', String(port), '--log', 'stdout'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for ngrok URL'));
      }, 15000);

      proc.stdout?.on('data', (data) => {
        output += data.toString();
        // ngrok outputs JSON logs, look for the URL
        const match = output.match(/url=(https?:\/\/[^\s"]+\.ngrok[^\s"]*)/i);
        if (match) {
          clearTimeout(timeout);
          resolve({ url: match[1], process: proc });
        }
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private async _startCloudflared(port: number): Promise<{ url: string; process: ChildProcess }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for cloudflared URL'));
      }, 30000);

      // cloudflared outputs to stderr
      proc.stderr?.on('data', (data) => {
        output += data.toString();
        // Look for the trycloudflare.com URL
        const match = output.match(/(https?:\/\/[^\s]+\.trycloudflare\.com)/i);
        if (match) {
          clearTimeout(timeout);
          resolve({ url: match[1], process: proc });
        }
      });

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
