/**
 * Tunnel - Expose local servers to the internet
 * @description Multi-provider tunneling for remote access to Beam and local services
 * @internal
 */

import { spawn, execSync, ChildProcess } from 'child_process';

interface TunnelInfo {
  provider: string;
  port: number;
  url: string;
  pid: number;
  startedAt: Date;
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
      note?: string;
    }>;
    activeTunnels: TunnelInfo[];
  }> {
    const providers = [
      {
        name: 'localtunnel',
        available: true, // Always available via npx
        note: 'Ready (uses npx, no install needed)',
      },
      {
        name: 'ngrok',
        available: this._checkCommand('ngrok'),
        install: 'brew install ngrok  OR  https://ngrok.com/download',
      },
      {
        name: 'cloudflared',
        available: this._checkCommand('cloudflared'),
        install:
          'brew install cloudflared  OR  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation',
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
   * @param provider Tunnel provider to use
   */
  async *start({
    provider = 'localtunnel',
  }: {
    /** Provider: localtunnel, ngrok, or cloudflared */
    provider?: 'localtunnel' | 'ngrok' | 'cloudflared';
  } = {}): AsyncGenerator<
    { step: string; message: string },
    {
      message: string;
      url: string;
      link: string;
      provider: string;
      port: number;
      password?: string;
    }
  > {
    // Auto-detect Beam port from environment
    const port = parseInt(process.env.BEAM_PORT || '3117', 10);

    // Check if tunnel already exists for this port
    if (activeTunnels.has(port)) {
      const existing = activeTunnels.get(port)!;
      const publicIp = await this._getPublicIp();
      return {
        message: `Tunnel already active on port ${port}`,
        url: existing.info.url,
        link: existing.info.url,
        password: existing.info.provider === 'localtunnel' ? publicIp : undefined,
        provider: existing.info.provider,
        port,
      };
    }

    yield { step: 'starting', message: `Starting ${provider} tunnel for Beam (port ${port})...` };

    try {
      let url: string;
      let process: ChildProcess;

      switch (provider) {
        case 'ngrok':
          if (!this._checkCommand('ngrok')) {
            throw new Error('ngrok not installed. Run: brew install ngrok');
          }
          ({ url, process } = await this._startNgrok(port));
          break;

        case 'cloudflared':
          if (!this._checkCommand('cloudflared')) {
            throw new Error('cloudflared not installed. Run: brew install cloudflared');
          }
          ({ url, process } = await this._startCloudflared(port));
          break;

        case 'localtunnel':
        default:
          ({ url, process } = await this._startLocaltunnel(port));
          break;
      }

      // Fetch public IP (needed for localtunnel password)
      const publicIp = await this._getPublicIp();

      const info: TunnelInfo = {
        provider,
        port,
        url,
        pid: process.pid!,
        startedAt: new Date(),
      };

      activeTunnels.set(port, { process, info });

      return {
        message: `Tunnel started successfully`,
        url,
        link: url,
        password: provider === 'localtunnel' ? publicIp : undefined,
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
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private async _getPublicIp(): Promise<string> {
    // Try multiple services in order
    const services = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com'];

    for (const service of services) {
      try {
        const result = execSync(`curl -s --max-time 3 ${service}`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const ip = result.trim();
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          return ip;
        }
      } catch {
        continue;
      }
    }
    return 'unknown';
  }

  private async _startLocaltunnel(port: number): Promise<{ url: string; process: ChildProcess }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('npx', ['localtunnel', '--port', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for localtunnel URL'));
      }, 30000);

      proc.stdout?.on('data', (data) => {
        output += data.toString();
        // localtunnel outputs: "your url is: https://xxx.loca.lt"
        const match = output.match(/your url is: (https?:\/\/[^\s]+)/i);
        if (match) {
          clearTimeout(timeout);
          resolve({ url: match[1], process: proc });
        }
      });

      proc.stderr?.on('data', (data) => {
        const err = data.toString();
        if (err.includes('error')) {
          clearTimeout(timeout);
          reject(new Error(err));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.on('close', (code) => {
        if (code !== 0 && !output.includes('your url is')) {
          clearTimeout(timeout);
          reject(new Error(`localtunnel exited with code ${code}`));
        }
      });
    });
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
