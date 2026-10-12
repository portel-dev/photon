export interface BufferedEvent {
  id: number;
  channel: string;
  message: unknown;
  timestamp: number;
}

export interface EventReplay {
  events: BufferedEvent[];
  refreshNeeded: boolean;
}

export interface EventBufferOptions {
  retentionMs: number;
  maxEventsPerChannel: number;
}

/** Bounded replay buffer for daemon channel events. */
export class ChannelEventBuffer {
  private readonly buffers = new Map<string, BufferedEvent[]>();

  constructor(private readonly options: EventBufferOptions) {}

  append(channel: string, message: unknown, now = Date.now()): number {
    const events = this.buffers.get(channel) ?? [];
    events.push({ id: now, channel, message, timestamp: now });
    const cutoff = now - this.options.retentionMs;
    while (events.length > 0 && events[0].timestamp < cutoff) events.shift();
    if (events.length > this.options.maxEventsPerChannel) {
      events.splice(0, events.length - this.options.maxEventsPerChannel);
    }
    this.buffers.set(channel, events);
    return now;
  }

  since(channel: string, lastTimestamp: number): EventReplay {
    const events = this.buffers.get(channel);
    if (!events || events.length === 0) {
      return { events: [], refreshNeeded: lastTimestamp > 0 };
    }
    if (lastTimestamp < events[0].timestamp) {
      return { events: [], refreshNeeded: true };
    }
    return {
      events: events.filter((event) => event.timestamp > lastTimestamp),
      refreshNeeded: false,
    };
  }

  cleanup(now = Date.now()): void {
    const cutoff = now - this.options.retentionMs;
    for (const [channel, events] of this.buffers) {
      if (events.length === 0 || events[events.length - 1].timestamp < cutoff) {
        this.buffers.delete(channel);
      }
    }
  }

  size(): number {
    return this.buffers.size;
  }

  clear(): void {
    this.buffers.clear();
  }
}
