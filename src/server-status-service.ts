import type { IncomingMessage, ServerResponse } from 'node:http';
import { getCorsOrigin } from './shared/security.js';
import type { PhotonClassExtended } from '@portel/photon-core';

export type StatusType = 'info' | 'success' | 'error' | 'warn';
export interface StatusUpdate {
  type: StatusType;
  message: string;
  timestamp: number;
}
export interface StatusNotificationPort {
  broadcast(status: StatusUpdate): Promise<void>;
}
export interface PhotonStatusServiceOptions {
  getPhoton: () => PhotonClassExtended | null;
  getDevMode: () => boolean;
  getHotReloadDisabled: () => boolean;
  getLastReloadError: () => unknown;
  notificationPort?: StatusNotificationPort;
  now?: () => number;
}

export class PhotonStatusService {
  private readonly clients = new Set<ServerResponse>();
  private readonly now: () => number;
  private currentStatus: StatusUpdate = { type: 'info', message: 'Ready', timestamp: Date.now() };

  constructor(private readonly options: PhotonStatusServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  snapshot(): Record<string, unknown> {
    const photon = this.options.getPhoton();
    const instance = photon?.instance as Record<string, unknown> | undefined;
    const assets = photon?.assets || { ui: [], prompts: [], resources: [] };
    const tools = photon?.tools || [];
    return {
      photon: photon?.name || null,
      devMode: this.options.getDevMode(),
      hotReloadDisabled: this.options.getHotReloadDisabled(),
      lastReloadError: this.options.getLastReloadError() || null,
      status: this.currentStatus,
      warnings:
        instance && '_photonConfigError' in instance && instance._photonConfigError
          ? ['Photon configuration incomplete. Check env vars and MCP credentials.']
          : [],
      summary: {
        toolCount: tools.length,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          hasUI: Boolean(assets.ui?.some((ui) => ui.linkedTool === tool.name)),
        })),
        uiAssets: (assets.ui || []).map((ui) => ({ id: ui.id, linkedTool: ui.linkedTool })),
        promptCount: assets.prompts?.length || 0,
        resourceCount: assets.resources?.length || 0,
      },
    };
  }

  handleStream(req: IncomingMessage, res: ServerResponse): void {
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };
    const origin = getCorsOrigin(req);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    res.writeHead(200, headers);
    res.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
    this.clients.add(res);
    const cleanup = () => this.clients.delete(res);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  async broadcast(type: StatusType, message: string): Promise<void> {
    this.currentStatus = { type, message, timestamp: this.now() };
    const frame = `data: ${JSON.stringify(this.currentStatus)}\n\n`;
    for (const client of [...this.clients]) {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
    try {
      await this.options.notificationPort?.broadcast(this.currentStatus);
    } catch {
      // Status notifications are best effort and must not fail reloads.
    }
  }

  setStatus(type: StatusType, message: string): void {
    void this.broadcast(type, message);
  }

  close(): void {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
