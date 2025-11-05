/**
 * Slack - Send messages and manage Slack workspace
 *
 * Provides tools to send messages, list channels, and interact with Slack workspace.
 * Requires a Slack Bot Token with appropriate scopes.
 *
 * Common use cases:
 * - Notifications: "Send a deployment notification to #engineering"
 * - Team updates: "Post the daily standup summary to #team"
 * - Channel management: "List all public channels"
 *
 * Example: postMessage({ channel: "#general", text: "Hello team!" })
 *
 * Configuration:
 * - token: Slack Bot Token (required, starts with xoxb-)
 *
 * Dependencies are auto-installed on first run.
 *
 * @dependencies @slack/web-api@^7.0.0
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import { WebClient } from '@slack/web-api';

export default class Slack {
  private client: WebClient;

  constructor(private token: string) {
    if (!token || token.trim() === '') {
      throw new Error('Slack token is required');
    }

    if (!token.startsWith('xoxb-') && !token.startsWith('xoxp-')) {
      throw new Error('Invalid Slack token format (should start with xoxb- or xoxp-)');
    }

    this.client = new WebClient(token);
  }

  async onInitialize() {
    try {
      const auth = await this.client.auth.test();
      console.error('[slack] ✅ Initialized');
      console.error(`[slack] Workspace: ${auth.team}`);
      console.error(`[slack] Bot: ${auth.user}`);
    } catch (error: any) {
      console.error(`[slack] ⚠️  Auth test failed: ${error.message}`);
    }
  }

  /**
   * Post a message to a channel or user
   * @param channel Channel name (e.g., "#general") or channel ID
   * @param text Message text
   * @param thread_ts Thread timestamp to reply to (optional)
   * @param blocks Rich message blocks (optional, JSON string)
   */
  async postMessage(params: {
    channel: string;
    text: string;
    thread_ts?: string;
    blocks?: string;
  }) {
    try {
      // Parse channel name if it starts with #
      const channel = params.channel.startsWith('#')
        ? await this._resolveChannelName(params.channel.slice(1))
        : params.channel;

      const blocks = params.blocks ? JSON.parse(params.blocks) : undefined;

      const response = await this.client.chat.postMessage({
        channel,
        text: params.text,
        thread_ts: params.thread_ts,
        blocks,
      });

      return {
        success: true,
        message: {
          ts: response.ts,
          channel: response.channel,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all channels in the workspace
   * @param types Channel types: public_channel, private_channel, mpim, im (default: public_channel)
   * @param limit Maximum number of channels to return (default: 100)
   */
  async listChannels(params?: {
    types?: string;
    limit?: number;
  }) {
    try {
      const response = await this.client.conversations.list({
        types: params?.types || 'public_channel',
        limit: params?.limit || 100,
      });

      const channels = response.channels?.map(channel => ({
        id: channel.id,
        name: channel.name,
        is_private: channel.is_private,
        is_archived: channel.is_archived,
        num_members: channel.num_members,
        topic: channel.topic?.value,
        purpose: channel.purpose?.value,
      }));

      return {
        success: true,
        count: channels?.length || 0,
        channels,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get channel information
   * @param channel Channel name (e.g., "#general") or channel ID
   */
  async getChannelInfo(params: { channel: string }) {
    try {
      const channel = params.channel.startsWith('#')
        ? await this._resolveChannelName(params.channel.slice(1))
        : params.channel;

      const response = await this.client.conversations.info({
        channel,
      });

      const ch = response.channel;

      return {
        success: true,
        channel: {
          id: ch?.id,
          name: ch?.name,
          is_private: ch?.is_private,
          is_archived: ch?.is_archived,
          num_members: ch?.num_members,
          topic: ch?.topic?.value,
          purpose: ch?.purpose?.value,
          created: ch?.created,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get conversation history from a channel
   * @param channel Channel name (e.g., "#general") or channel ID
   * @param limit Number of messages to retrieve (default: 10, max: 100)
   * @param oldest Start of time range (Unix timestamp)
   * @param latest End of time range (Unix timestamp)
   */
  async getHistory(params: {
    channel: string;
    limit?: number;
    oldest?: string;
    latest?: string;
  }) {
    try {
      const channel = params.channel.startsWith('#')
        ? await this._resolveChannelName(params.channel.slice(1))
        : params.channel;

      const response = await this.client.conversations.history({
        channel,
        limit: params.limit || 10,
        oldest: params.oldest,
        latest: params.latest,
      });

      const messages = response.messages?.map(msg => ({
        ts: msg.ts,
        user: msg.user,
        text: msg.text,
        type: msg.type,
        thread_ts: msg.thread_ts,
      }));

      return {
        success: true,
        count: messages?.length || 0,
        messages,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Add a reaction to a message
   * @param channel Channel name (e.g., "#general") or channel ID
   * @param timestamp Message timestamp
   * @param name Reaction emoji name (without colons, e.g., "thumbsup")
   */
  async addReaction(params: { channel: string; timestamp: string; name: string }) {
    try {
      const channel = params.channel.startsWith('#')
        ? await this._resolveChannelName(params.channel.slice(1))
        : params.channel;

      await this.client.reactions.add({
        channel,
        timestamp: params.timestamp,
        name: params.name,
      });

      return {
        success: true,
        message: `Added reaction :${params.name}:`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Upload a file to a channel
   * @param channel Channel name (e.g., "#general") or channel ID
   * @param content File content (text)
   * @param filename Filename
   * @param title File title (optional)
   * @param initial_comment Comment to add with the file (optional)
   */
  async uploadFile(params: {
    channel: string;
    content: string;
    filename: string;
    title?: string;
    initial_comment?: string;
  }) {
    try {
      const channel = params.channel.startsWith('#')
        ? await this._resolveChannelName(params.channel.slice(1))
        : params.channel;

      const response = await this.client.files.uploadV2({
        channel_id: channel,
        content: params.content,
        filename: params.filename,
        title: params.title || params.filename,
        initial_comment: params.initial_comment,
      });

      return {
        success: true,
        file: {
          id: response.file?.id,
          name: response.file?.name,
          url: response.file?.permalink,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Search for messages in the workspace
   * @param query Search query
   * @param count Number of results to return (default: 20)
   * @param sort Sort order: score or timestamp (default: score)
   */
  async searchMessages(params: { query: string; count?: number; sort?: string }) {
    try {
      const response = await this.client.search.messages({
        query: params.query,
        count: params.count || 20,
        sort: params.sort || 'score',
      });

      const messages = response.messages?.matches?.map(msg => ({
        ts: msg.ts,
        user: msg.user,
        username: msg.username,
        text: msg.text,
        channel: msg.channel?.name,
        permalink: msg.permalink,
      }));

      return {
        success: true,
        total: response.messages?.total,
        count: messages?.length || 0,
        messages,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Private helper: Resolve channel name to channel ID
  private async _resolveChannelName(name: string): Promise<string> {
    const response = await this.client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000,
    });

    const channel = response.channels?.find(ch => ch.name === name);

    if (!channel) {
      throw new Error(`Channel #${name} not found`);
    }

    return channel.id!;
  }
}
