/**
 * Stateful Test Photon - exercises @stateful, this.memory, this.emit()
 *
 * @stateful
 * @version 1.0.0
 */
export default class StatefulTest {
  /**
   * Store a value in memory
   * @param key Key to store
   * @param value Value to store
   */
  async store({ key, value }: { key: string; value: string }): Promise<{ stored: boolean }> {
    await this.memory.set(key, value);
    return { stored: true };
  }

  /**
   * Retrieve a value from memory
   * @param key Key to retrieve
   * @readOnly
   */
  async recall({ key }: { key: string }): Promise<string | null> {
    return await this.memory.get<string>(key);
  }

  /**
   * Emit an event
   * @param event Event name
   * @param data Event data
   */
  async notify({ event, data }: { event: string; data: string }): Promise<{ emitted: boolean }> {
    this.emit({ channel: event, event: 'custom', data: { message: data } });
    return { emitted: true };
  }

  /**
   * Streaming method to test @stateful + generator combination
   * @param steps How many steps to stream
   */
  async *stream({ steps }: { steps: number }) {
    for (let i = 0; i < steps; i++) {
      yield { emit: 'progress', value: (i + 1) / steps, message: `Step ${i + 1}` };
    }
    return { completed: steps };
  }

  // Type declarations for injected capabilities
  declare memory: {
    get<T>(key: string, scope?: string): Promise<T | null>;
    set<T>(key: string, value: T, scope?: string): Promise<void>;
    delete(key: string, scope?: string): Promise<boolean>;
    has(key: string, scope?: string): Promise<boolean>;
    keys(scope?: string): Promise<string[]>;
  };

  declare emit: (data: any) => void;
}
