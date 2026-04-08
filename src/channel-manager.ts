/**
 * ChannelManager — encapsulates channel/pub-sub logic extracted from PhotonServer.
 *
 * Handles:
 *  - Channel capability declaration for MCP server init
 *  - Channel notification methods (per-target)
 *  - Permission request/response flow
 *  - Publishing channel events to daemon
 *  - Subscribing to daemon channels and forwarding messages to MCP clients
 *  - Cleanup of daemon subscriptions
 */

import { subscribeChannel, publishToChannel } from './daemon/client.js';
import { getErrorMessage } from './shared/error-handler.js';

// Re-export types that were previously on server.ts — kept here for co-location
export type ChannelPermissionRequest = {
  request_id: string;
  tool_name: string;
  description: string;
  input_preview: string;
};

export type ChannelPermissionResponse = {
  request_id: string;
  behavior: 'allow' | 'deny';
};

/** Channel-specific options extracted from PhotonServerOptions */
export interface ChannelOptions {
  channelMode?: boolean;
  channelName?: string;
  channelTargets?: string[];
  channelInstructions?: string;
}

/**
 * Callback interface for sending notifications back to MCP clients.
 * PhotonServer implements this so ChannelManager stays decoupled.
 */
export interface ChannelNotificationSink {
  /** Send a notification to the primary (STDIO) server */
  sendNotification(notification: { method: string; params: any }): Promise<void>;
  /** Send a notification to all SSE sessions */
  sendNotificationToAllSessions(notification: { method: string; params: any }): Promise<void>;
  /** Get the photon instance for permission dispatch */
  getPhotonInstance(): any;
}

export class ChannelManager {
  private channelUnsubscribers: Array<() => void> = [];
  private daemonName: string | null = null;
  private options: ChannelOptions;
  private workingDir?: string;
  private sink: ChannelNotificationSink;
  private log: (level: string, message: string, data?: Record<string, unknown>) => void;

  constructor(opts: {
    channelOptions: ChannelOptions;
    workingDir?: string;
    sink: ChannelNotificationSink;
    log: (level: string, message: string, data?: Record<string, unknown>) => void;
  }) {
    this.options = opts.channelOptions;
    this.workingDir = opts.workingDir;
    this.sink = opts.sink;
    this.log = opts.log;
  }

  /** Whether channel mode is active */
  get isChannelMode(): boolean {
    return !!this.options.channelMode;
  }

  /** The current daemon name (set after daemon startup) */
  get currentDaemonName(): string | null {
    return this.daemonName;
  }

  /** Set the daemon name (called after daemon startup in PhotonServer) */
  setDaemonName(name: string | null): void {
    this.daemonName = name;
  }

  // ---------------------------------------------------------------------------
  // MCP Server Init Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the server name to use.
   * In channel mode, uses the channel name; otherwise defaults to 'photon-mcp'.
   */
  getServerName(): string {
    return this.options.channelMode && this.options.channelName
      ? this.options.channelName
      : 'photon-mcp';
  }

  /**
   * Returns extra capabilities to merge into the MCP Server capabilities object.
   * Produces the experimental channel entries for each declared target.
   */
  getExtraCapabilities(): Record<string, any> {
    if (!this.options.channelMode || !this.options.channelTargets?.length) return {};
    return {
      experimental: Object.fromEntries(
        this.options.channelTargets.flatMap((t) => [
          [`${t}/channel`, {}],
          [`${t}/channel/permission`, {}],
        ])
      ),
    };
  }

  /**
   * Returns extra server constructor options (e.g. instructions) for channel mode.
   */
  getExtraServerOptions(): Record<string, any> {
    if (!this.options.channelMode || !this.options.channelInstructions) return {};
    return { instructions: this.options.channelInstructions };
  }

  // ---------------------------------------------------------------------------
  // Notification Methods
  // ---------------------------------------------------------------------------

  /**
   * Get the notification methods for all declared channel targets.
   * Each target (e.g. 'claude') maps to `notifications/{target}/channel`.
   */
  private getChannelNotificationMethods(): string[] {
    const targets = this.options.channelTargets || [];
    return targets.map((t) => `notifications/${t}/channel`);
  }

  // ---------------------------------------------------------------------------
  // Permission Flow
  // ---------------------------------------------------------------------------

  /**
   * Handle a permission request from the client (e.g. Claude Code asking "Allow tool X?").
   * Forwards to the photon instance via channel._dispatchPermission().
   */
  handlePermissionRequest(params: any): void {
    if (!params?.request_id || !params?.tool_name) return;
    const request: ChannelPermissionRequest = {
      request_id: params.request_id,
      tool_name: params.tool_name,
      description: params.description || '',
      input_preview: params.input_preview || '',
    };
    this.log('info', `Permission request: ${request.tool_name} (${request.request_id})`);
    const instance = this.sink.getPhotonInstance();
    if (instance?.channel?._dispatchPermission) {
      instance.channel._dispatchPermission(request);
    }
  }

  /**
   * Send a permission response back to the client.
   * Called by the photon instance (via this.channel.respond) when the user approves/denies.
   */
  respondToPermission(response: ChannelPermissionResponse): void {
    const targets = this.options.channelTargets || [];
    for (const target of targets) {
      const notification = {
        method: `notifications/${target}/channel/permission`,
        params: {
          request_id: response.request_id,
          behavior: response.behavior,
        },
      };
      this.sink.sendNotification(notification).catch((e) => {
        this.log('debug', 'Permission response failed', { error: getErrorMessage(e) });
      });
      this.sink.sendNotificationToAllSessions(notification).catch((e) => {
        this.log('debug', `Failed to send permission to SSE sessions: ${getErrorMessage(e)}`);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  /**
   * Publish a channel event to the daemon for cross-process pub/sub.
   * Called from output handlers whenever an emit has a `channel` field.
   */
  publishIfChannel(emit: any): void {
    if (!this.daemonName || !emit?.channel) return;
    publishToChannel(this.daemonName, emit.channel, emit, this.workingDir).catch((e) => {
      this.log('debug', `Failed to publish channel event to daemon: ${e?.message || e}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Subscribing & Message Handling
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to daemon channels for cross-process notifications.
   * In channel mode, handleChannelMessage intercepts 'channel-push' events
   * and translates them to notifications/claude/channel for the connected client.
   */
  async subscribeToChannels(): Promise<void> {
    if (!this.daemonName) return;

    try {
      const unsubscribe = await subscribeChannel(
        this.daemonName,
        `${this.daemonName}:*`,
        (message: unknown) => {
          void this.handleChannelMessage(message);
        },
        { workingDir: this.workingDir }
      );
      this.channelUnsubscribers.push(unsubscribe);
      this.log('info', `Subscribed to daemon channel: ${this.daemonName}:*`);
    } catch (error) {
      this.log('warn', `Failed to subscribe to daemon: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Handle incoming channel messages and forward as MCP notifications.
   * Routes channel-permission-response and channel-push messages,
   * and forwards everything else as standard MCP notifications with _photon data.
   */
  private async handleChannelMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;

    const msg = message as Record<string, unknown>;

    if (process.env.PHOTON_DEBUG_EVENTS === '1') {
      console.error(
        `[PHOTON-SERVER] Received daemon message on ${String(msg.channel)}: event=${String(msg.event)}`
      );
    }

    // Channel permission responses — photon called this.channel.respond()
    if (this.options.channelMode && String(msg.channel).endsWith(':channel-permission-response')) {
      const data = msg.data as Record<string, unknown> | undefined;
      if (data?.request_id && data?.behavior) {
        this.respondToPermission({
          request_id: data.request_id as string,
          behavior: data.behavior as 'allow' | 'deny',
        });
      }
      return;
    }

    // Channel events — translate to client-specific channel notifications.
    if (this.options.channelMode && String(msg.channel).endsWith(':channel-push')) {
      const pushData = msg.data as Record<string, unknown> | undefined;
      const methods = this.getChannelNotificationMethods();
      if (methods.length === 0) return;
      const content = typeof pushData?.content === 'string' ? pushData.content : '';
      const meta = (pushData?.meta as Record<string, string>) || {};
      try {
        for (const method of methods) {
          const notification = { method, params: { content, meta } };
          await this.sink.sendNotification(notification);
          await this.sink.sendNotificationToAllSessions(notification);
        }
      } catch (e) {
        this.log('debug', 'Channel notification failed', { error: getErrorMessage(e) });
      }
      return;
    }

    // Standard notification with embedded photon data
    const payload = {
      method: 'ui/notifications/host-context-changed',
      params: {
        _photon: {
          photon: this.daemonName,
          channel: msg.channel,
          event: msg.event,
          data: msg.data,
        },
      },
    };

    try {
      if (process.env.PHOTON_DEBUG_EVENTS === '1') {
        console.error(`[PHOTON-SERVER] Sending notification to MCP clients...`);
      }
      await this.sink.sendNotification(payload);
      if (process.env.PHOTON_DEBUG_EVENTS === '1') {
        console.error(`[PHOTON-SERVER] Notification sent successfully`);
      }
    } catch (e) {
      console.error(`[PHOTON-SERVER-ERROR] Notification send failed: ${getErrorMessage(e)}`);
      this.log('debug', 'Notification send failed', { error: getErrorMessage(e) });
    }

    // Also send to SSE sessions
    await this.sink.sendNotificationToAllSessions(payload).catch((e) => {
      this.log('debug', 'Session notification failed', { error: getErrorMessage(e) });
    });
  }

  /**
   * Check if an incoming message is a channel permission request and handle it.
   * Returns true if it was handled (caller should not process further).
   */
  interceptPermissionRequest(message: any): boolean {
    if (this.options.channelMode && message?.method?.endsWith('/channel/permission_request')) {
      this.handlePermissionRequest(message.params);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Unsubscribe from all daemon channels. Called during server shutdown.
   */
  cleanup(): void {
    for (const unsubscribe of this.channelUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
    this.channelUnsubscribers = [];
  }
}
