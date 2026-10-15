import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../src/daemon/client.js';

test('coalesces duplicate reconnect requests from one socket failure', () => {
  let scheduled = 0;
  const gate = __test__.createReconnectGate(() => {
    scheduled += 1;
  });

  gate.request();
  gate.request();

  assert.equal(scheduled, 1);
});

test('allows another reconnect after the current attempt completes', () => {
  let scheduled = 0;
  const gate = __test__.createReconnectGate(() => {
    scheduled += 1;
  });

  gate.request();
  gate.reset();
  gate.request();

  assert.equal(scheduled, 2);
});
