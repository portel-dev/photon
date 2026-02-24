/**
 * Daemon State Machine
 *
 * Guards daemon lifecycle transitions to prevent illegal states.
 *
 * States: stopped → starting → running → stopping → stopped
 *                                  ↓
 *                                stale → stopping
 */

export type DaemonState = 'stopped' | 'starting' | 'running' | 'stopping' | 'stale';

/** Legal transitions from each state. */
const TRANSITIONS: Record<DaemonState, DaemonState[]> = {
  stopped: ['starting'],
  starting: ['running', 'stopped'], // stopped on start failure
  running: ['stopping', 'stale'],
  stale: ['stopping'],
  stopping: ['stopped'],
};

export class DaemonStateMachine {
  private _state: DaemonState = 'stopped';
  private _listeners: Array<(from: DaemonState, to: DaemonState) => void> = [];

  get state(): DaemonState {
    return this._state;
  }

  /** Transition to a new state. Throws if the transition is illegal. */
  transition(to: DaemonState): void {
    const from = this._state;
    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `Illegal daemon transition: ${from} → ${to} (allowed: ${allowed.join(', ')})`
      );
    }
    this._state = to;
    for (const listener of this._listeners) {
      listener(from, to);
    }
  }

  /** Register a listener for state transitions. Returns unsubscribe function. */
  onTransition(listener: (from: DaemonState, to: DaemonState) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  /** Check if a transition is legal without performing it. */
  canTransition(to: DaemonState): boolean {
    return TRANSITIONS[this._state].includes(to);
  }
}
