export interface NotificationSink<T> {
  send(notification: T): Promise<void>;
}

/** Serializes notification writes so concurrent generators cannot interleave frames. */
export class NotificationQueue<T> {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: NotificationSink<T>,
    private readonly onError?: (error: unknown) => void
  ) {}

  enqueue(notification: T): void {
    this.tail = this.tail
      .then(() => this.sink.send(notification))
      .catch((error) => {
        this.onError?.(error);
      });
  }

  async drain(): Promise<void> {
    await this.tail;
  }
}
