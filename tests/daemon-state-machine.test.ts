/**
 * Tests for DaemonStateMachine
 */

import assert from 'node:assert/strict';
import { DaemonStateMachine } from '../src/daemon/state-machine.js';

(async () => {
  console.log('🧪 DaemonStateMachine tests...\n');

  // Initial state is stopped
  {
    const fsm = new DaemonStateMachine();
    assert.equal(fsm.state, 'stopped');
    console.log('  ✅ Initial state is stopped');
  }

  // Happy path: stopped → starting → running → stopping → stopped
  {
    const fsm = new DaemonStateMachine();
    fsm.transition('starting');
    assert.equal(fsm.state, 'starting');
    fsm.transition('running');
    assert.equal(fsm.state, 'running');
    fsm.transition('stopping');
    assert.equal(fsm.state, 'stopping');
    fsm.transition('stopped');
    assert.equal(fsm.state, 'stopped');
    console.log('  ✅ Happy path transitions');
  }

  // Start failure: starting → stopped
  {
    const fsm = new DaemonStateMachine();
    fsm.transition('starting');
    fsm.transition('stopped'); // start failed
    assert.equal(fsm.state, 'stopped');
    console.log('  ✅ Start failure (starting → stopped)');
  }

  // Stale detection: running → stale → stopping → stopped
  {
    const fsm = new DaemonStateMachine();
    fsm.transition('starting');
    fsm.transition('running');
    fsm.transition('stale');
    assert.equal(fsm.state, 'stale');
    fsm.transition('stopping');
    fsm.transition('stopped');
    assert.equal(fsm.state, 'stopped');
    console.log('  ✅ Stale path transitions');
  }

  // Illegal transitions throw
  {
    const fsm = new DaemonStateMachine();
    assert.throws(() => fsm.transition('running'), /Illegal daemon transition: stopped → running/);
    assert.throws(
      () => fsm.transition('stopping'),
      /Illegal daemon transition: stopped → stopping/
    );
    console.log('  ✅ Illegal transitions throw');
  }

  // Cannot go backwards
  {
    const fsm = new DaemonStateMachine();
    fsm.transition('starting');
    fsm.transition('running');
    assert.throws(
      () => fsm.transition('starting'),
      /Illegal daemon transition: running → starting/
    );
    console.log('  ✅ Cannot go backwards');
  }

  // canTransition check
  {
    const fsm = new DaemonStateMachine();
    assert(fsm.canTransition('starting'));
    assert(!fsm.canTransition('running'));
    assert(!fsm.canTransition('stopping'));
    console.log('  ✅ canTransition works');
  }

  // Listener notifications
  {
    const fsm = new DaemonStateMachine();
    const transitions: string[] = [];
    const unsub = fsm.onTransition((from, to) => {
      transitions.push(`${from}→${to}`);
    });

    fsm.transition('starting');
    fsm.transition('running');
    assert.deepEqual(transitions, ['stopped→starting', 'starting→running']);

    // Unsubscribe works
    unsub();
    fsm.transition('stopping');
    assert.deepEqual(transitions, ['stopped→starting', 'starting→running']);
    console.log('  ✅ Listener notifications and unsubscribe');
  }

  console.log('\n✅ All daemon state machine tests passed!\n');
})();
