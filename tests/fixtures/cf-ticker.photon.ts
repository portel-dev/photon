/**
 * CF DO bridge schedule smoke fixture: per-minute cron tick.
 *
 * Companion to cf-counter for verifying `this.schedule` runs on the CF
 * Durable Object alarm multiplexer. Same source runs locally on the
 * daemon and deploys to Cloudflare Workers via
 * `photon host deploy cf cf-ticker`.
 *
 * @version 0.0.1
 * @icon ⏱️
 */
export default class CfTicker {
  /**
   * Install a schedule that calls `tick` every minute.
   */
  async install(): Promise<{ id: string }> {
    const task = await (this as any).schedule.create({
      name: 'every-minute',
      schedule: '* * * * *',
      method: 'tick',
      params: {},
    });
    return { id: task.id };
  }

  /**
   * Schedule callback. Bumps a tick counter so we can confirm it fires.
   */
  async tick(): Promise<{ ticks: number }> {
    const ticks = await (this as any).memory.update(
      'ticks',
      (cur: number | null) => (cur ?? 0) + 1
    );
    (this as any).emit({ channel: 'tick', ticks });
    return { ticks };
  }

  /**
   * Read the current tick count.
   */
  async ticks(): Promise<{ ticks: number }> {
    return { ticks: (await (this as any).memory.get('ticks')) ?? 0 };
  }

  /**
   * List all installed schedules.
   */
  async schedules(): Promise<unknown[]> {
    return (this as any).schedule.list();
  }
}
