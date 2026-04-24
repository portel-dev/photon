/**
 * Fixture: two methods that race on shared instance state.
 *
 * If concurrent calls interleave their await points, `increment` loses updates
 * because both reads see the same initial counter and both writes land with
 * the same +1 delta. The per-instance call queue must prevent this.
 */
export default class ConcurrentCalls {
  private counter = 0;
  private timeline: string[] = [];

  async increment(params: { label: string }): Promise<{ counter: number; label: string }> {
    const label = params?.label ?? 'x';
    this.timeline.push(`start:${label}:read=${this.counter}`);
    const was = this.counter;
    await new Promise((r) => setTimeout(r, 20));
    this.counter = was + 1;
    this.timeline.push(`end:${label}:write=${this.counter}`);
    return { counter: this.counter, label };
  }

  async getTimeline(): Promise<{ timeline: string[]; counter: number }> {
    return { timeline: this.timeline, counter: this.counter };
  }
}
