/**
 * Emit helper parity test fixture
 * @version 1.0.0
 */
export default class EmitHelpers {
  // Declare injected helpers so TS is happy without casts that break regex detection.
  declare toast: (msg: string, opts?: { type?: string; duration?: number }) => void;
  declare status: (msg: string) => void;
  declare progress: (value: number, msg?: string) => void;
  declare log: (msg: string, opts?: { level?: string }) => void;
  declare thinking: (active?: boolean) => void;
  declare render: (format?: string, value?: any) => void;

  /** Imperative helpers on a plain class (no generator). */
  async imperative() {
    this.toast('hello', { type: 'success' });
    this.status('working');
    this.progress(0.5, 'halfway');
    this.log('ran', { level: 'info' });
    this.thinking(true);
    this.render('toast', 'via render');
    return { ok: true };
  }

  /** Generator form with equivalent yields. */
  async *generator() {
    yield { emit: 'toast', message: 'hello', type: 'success' as const };
    yield { emit: 'status', message: 'working' };
    yield { emit: 'progress', value: 0.5, message: 'halfway' };
    yield { emit: 'log', message: 'ran', level: 'info' as const };
    yield { emit: 'thinking', active: true };
    return { ok: true };
  }
}
