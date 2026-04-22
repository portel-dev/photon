# Long-Running Methods: The Heartbeat Contract

Photons are invoked by both humans at a terminal and by autonomous agents
(Claude, CI pipelines, orchestrators). A method that takes minutes to run
is normal. Both kinds of consumers need to know:

1. Is the method still making progress, or is it stuck?
2. When is it safe to give up?

The photon runtime refuses to answer those questions by imposing a
timeout — because a timeout that's right for a human is wrong for an
agent, and vice versa. Instead, responsibility is split across three
actors with a clear contract.

---

## Runtime contract (what the runtime guarantees)

The CLI and daemon **never impose a timeout** on method execution.

- `photon <photon> <method>` stays connected until the method returns,
  the daemon dies, or the consumer sends SIGINT.
- `this.status()` / `this.progress()` / `this.render()` emissions are
  forwarded in order, immediately, as `notifications/progress` over the
  MCP wire (Beam / external MCP clients) or as inline CLI output.
- SIGINT / Ctrl+C ends the CLI cleanly. Socket closes, the consumer
  returns to a shell prompt.

The runtime does not second-guess silence. If your method runs for 90
seconds without emitting anything, it runs for 90 seconds.

---

## Photon-developer contract (what you MUST do)

If your method can take more than a couple of seconds, **emit
`this.status()` periodically** so the consumer can judge liveness.
Silence is the consumer's cue to give up, and that cue must be
meaningful.

**Rule of thumb**: emit at least once every 5 seconds during any busy
period.

### Heartbeat pattern for subprocess calls

When you shell out to something that doesn't stream its own progress
(LLM model load, heavy compute, long network wait), wrap it:

```ts
private async runWithHeartbeat<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    (this as any).status?.(`${label} — ${elapsed}s`);
  }, 5_000);
  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
  }
}

// Usage
async transcribe({ audio }: { audio: string }) {
  (this as any).status?.('Loading Whisper model');
  const text = await this.runWithHeartbeat(
    () => this.exec('whisper', [audio], 600_000),
    'Whisper running'
  );
  return text;
}
```

### Generator methods

If the method is an `async *` generator, every `yield { emit: 'status',
message: '...' }` counts as a heartbeat.

```ts
async *pipeline() {
  yield { emit: 'status', message: 'Fetching data' };
  const rows = await fetchRows();
  yield { emit: 'status', message: `Processing ${rows.length} rows` };
  for (const row of rows) {
    yield { emit: 'status', message: `Row ${row.id}` };
    await processOne(row);
  }
  return 'done';
}
```

### When you can't emit for a while

If you're genuinely in an uninterruptible blocking call (single Python
subprocess, opaque native binding), warn the consumer up front:

```ts
(this as any).status?.('Loading model into RAM — this may take 30-60s');
```

That single status message gives the consumer the context to wait
patiently instead of assuming the call is hung.

### Anti-patterns

- ❌ A method that runs for 30 seconds and emits nothing.
- ❌ Emitting the same message 100 times in a tight loop — consumers
  may dedupe or throttle, so vary the message (include counters, row
  ids, elapsed time).
- ❌ Relying on toast / log for heartbeats — those are for events, not
  progress. Use `status()`.

---

## Consumer contract (what you decide)

You — human or agent — decide when to stop waiting. The runtime will
not decide for you.

### For humans

- Ctrl+C any time. The CLI exits with code 130.
- No status update for N seconds feels like "stuck"? Trust your gut.
  The photon developer is supposed to heartbeat; if they don't, that's
  a bug on their side.

### For agents

Pick a silence window appropriate to your job:

| Agent role                    | Reasonable silence window |
|-------------------------------|---------------------------|
| Interactive assistant         | 60 s                      |
| Background job orchestrator   | 5 min                     |
| Long-running pipeline step    | 30 min                    |
| Scheduled automation          | 1 h                       |

After the window elapses with no `status()` emission, close the
connection / send SIGTERM. The daemon will clean up and (in a future
release) accept explicit cancellation messages.

If you receive `status()` updates, the clock resets. A 45-minute method
that heartbeats every 10 seconds is fine; a 2-second method that
emits nothing is suspicious.

### Detached mode (planned)

For fire-and-forget flows, a future release will add:

- `photon <photon> <method> --detach` — returns a task ID, exits.
- `photon task wait <id>` — re-attach to the stream.
- `photon task status <id>` — snapshot.
- `photon task cancel <id>` — ask the daemon to abort.

Until then, a long `photon cli <photon> <method>` call is the only
shape; the consumer manages its own wait policy.

---

## Why not just enforce a timeout?

We tried. The previous CLI imposed an idle-reset 2-minute timeout. It
broke two categories of users:

- **Photon developers building slow workloads** (ML inference,
  large-file processing). A single silent 3-minute step would kill
  their method and they'd chase phantom bugs.
- **Agents driving photons at their own pace**. A research agent
  deliberately waiting 10 minutes would see the CLI die with a
  misleading "Request timeout" that was really just the CLI
  second-guessing the agent's own judgment.

The fix that survives both groups is the contract above: the runtime
never times out, the photon developer heartbeats, the consumer
decides. Every actor knows what they're responsible for.
