/**
 * Subscription Management — Ref-counted channel subscriptions + event buffer replay.
 *
 * Manages daemon pub/sub subscriptions with reference counting so channels
 * are subscribed only when at least one client is viewing them.
 * Buffers recent events for delta-sync on reconnect.
 */

import { subscribeChannel, pingDaemon } from '../../daemon/client.js';
import { broadcastToBeam, sendToSession } from '../streamable-http-transport.js';
import { logger } from '../../shared/logger.js';
import type { AnyPhotonInfo } from '../types.js';

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

interface ChannelSubscription {
  refCount: number;
  unsubscribe: (() => void) | null;
}

interface BufferedEvent {
  id: number;
  method: string;
  params: Record<string, unknown>;
  timestamp: number;
}

interface ChannelBuffer {
  events: BufferedEvent[];
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGER
// ══════════════════════════════════════════════════════════════════════════════

/** Buffer retention window — events older than this are purged */
const EVENT_BUFFER_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export interface SubscriptionManagerDeps {
  photons: AnyPhotonInfo[];
  workingDir: string;
}

export class SubscriptionManager {
  private channelSubscriptions = new Map<string, ChannelSubscription>();
  private channelEventBuffers = new Map<string, ChannelBuffer>();
  private sessionViewState = new Map<string, { photonId?: string; itemId?: string }>();
  private deps: SubscriptionManagerDeps;

  constructor(deps: SubscriptionManagerDeps) {
    this.deps = deps;
  }

  /** Store an event in the channel buffer */
  bufferEvent(channel: string, method: string, params: Record<string, unknown>): number {
    let buffer = this.channelEventBuffers.get(channel);
    if (!buffer) {
      buffer = { events: [] };
      this.channelEventBuffers.set(channel, buffer);
    }

    const now = Date.now();
    const event: BufferedEvent = { id: now, method, params, timestamp: now };
    buffer.events.push(event);

    // Purge events older than retention window
    const cutoff = now - EVENT_BUFFER_DURATION_MS;
    while (buffer.events.length > 0 && buffer.events[0].timestamp < cutoff) {
      buffer.events.shift();
    }

    return now;
  }

  /** Replay missed events to a session, or signal full sync needed */
  replayEventsToSession(
    sessionId: string,
    channel: string,
    lastTimestamp?: number
  ): { replayed: number; refreshNeeded: boolean } {
    const buffer = this.channelEventBuffers.get(channel);

    if (!buffer || buffer.events.length === 0) {
      return { replayed: 0, refreshNeeded: false };
    }

    if (lastTimestamp === undefined) {
      return { replayed: 0, refreshNeeded: false };
    }

    const oldestEvent = buffer.events[0];

    // Stale: client's timestamp is older than buffer window → full sync needed
    if (lastTimestamp < oldestEvent.timestamp) {
      sendToSession(sessionId, 'photon/refresh-needed', { channel });
      logger.info(
        `📡 Stale client on ${channel} - last seen ${new Date(lastTimestamp).toISOString()}, oldest buffered ${new Date(oldestEvent.timestamp).toISOString()}, full sync needed`
      );
      return { replayed: 0, refreshNeeded: true };
    }

    // Delta sync: replay events after client's last timestamp
    const eventsToReplay = buffer.events.filter((e) => e.timestamp > lastTimestamp);

    if (eventsToReplay.length === 0) {
      return { replayed: 0, refreshNeeded: false };
    }

    for (const event of eventsToReplay) {
      sendToSession(sessionId, event.method, { ...event.params, _eventId: event.timestamp });
    }

    logger.info(`📡 Delta sync: ${channel} - replayed ${eventsToReplay.length} events`);
    return { replayed: eventsToReplay.length, refreshNeeded: false };
  }

  /** Subscribe to a channel (increment ref count, actually subscribe if first) */
  async subscribeToChannel(channel: string): Promise<void> {
    const existing = this.channelSubscriptions.get(channel);

    if (existing) {
      existing.refCount++;
      logger.debug(`Channel ${channel} ref count: ${existing.refCount}`);
      return;
    }

    // First subscriber — actually subscribe to daemon
    const subscription: ChannelSubscription = { refCount: 1, unsubscribe: null };
    this.channelSubscriptions.set(channel, subscription);

    try {
      const [photonId, itemId] = channel.split(':');

      const photon = this.deps.photons.find((p) => p.id === photonId);
      if (!photon) {
        logger.warn(`Cannot subscribe to ${channel}: unknown photon ID ${photonId}`);
        return;
      }
      const photonName = photon.name;

      const daemonChannel = `${photonName}:${itemId}`;
      const isRunning = await pingDaemon(photonName);

      if (isRunning) {
        const unsubscribe = await subscribeChannel(
          photonName,
          daemonChannel,
          (message: any) => {
            const params = {
              photonId,
              photon: photonName,
              channel: daemonChannel,
              event: message?.event,
              data: message?.data || message,
            };
            const eventId = this.bufferEvent(channel, 'photon/channel-event', params);
            broadcastToBeam('photon/channel-event', { ...params, _eventId: eventId });
          },
          { workingDir: this.deps.workingDir }
        );
        subscription.unsubscribe = unsubscribe;
        logger.info(`📡 Subscribed to ${daemonChannel} (id: ${photonId}, ref: 1)`);
      }
    } catch {
      // Daemon not running — in-process events still work
    }
  }

  /** Unsubscribe from a channel (decrement ref count, actually unsubscribe if last) */
  unsubscribeFromChannel(channel: string): void {
    const subscription = this.channelSubscriptions.get(channel);
    if (!subscription) return;

    subscription.refCount--;
    logger.debug(`Channel ${channel} ref count: ${subscription.refCount}`);

    if (subscription.refCount <= 0) {
      if (subscription.unsubscribe) {
        subscription.unsubscribe();
        logger.info(`📡 Unsubscribed from ${channel}`);
      }
      this.channelSubscriptions.delete(channel);
    }
  }

  /** Called when a client starts viewing a board */
  onClientViewingBoard(
    sessionId: string,
    photonId: string,
    itemId: string,
    lastTimestamp?: number
  ): void {
    const prevState = this.sessionViewState.get(sessionId);

    // Unsubscribe from previous item if different
    if (prevState?.itemId && (prevState.photonId !== photonId || prevState.itemId !== itemId)) {
      const prevChannel = `${prevState.photonId}:${prevState.itemId}`;
      this.unsubscribeFromChannel(prevChannel);
    }

    // Subscribe to new item
    const channel = `${photonId}:${itemId}`;
    this.sessionViewState.set(sessionId, { photonId, itemId });
    void this.subscribeToChannel(channel);

    // Delta sync missed events if lastTimestamp is provided
    if (lastTimestamp !== undefined) {
      void this.replayEventsToSession(sessionId, channel, lastTimestamp);
    }
  }

  /** Called when a client disconnects */
  onClientDisconnect(sessionId: string): void {
    const state = this.sessionViewState.get(sessionId);
    if (state?.photonId && state?.itemId) {
      const channel = `${state.photonId}:${state.itemId}`;
      this.unsubscribeFromChannel(channel);
    }
    this.sessionViewState.delete(sessionId);
  }
}
