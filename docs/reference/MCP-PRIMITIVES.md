# MCP Primitives on `this`

Photon exposes the MCP protocol's user-facing primitives as methods on
every photon instance. You don't have to touch the MCP SDK — just call
a method and the runtime does the wire work.

| Primitive | MCP method | Photon API | When to use |
|-----------|-----------|-----------|-------------|
| Sampling | `sampling/createMessage` | `await this.sample({ prompt })` | Delegate an LLM call to the driving agent |
| Elicitation (confirm) | `elicitation/create` | `await this.confirm(question)` | Yes/no question — returns `boolean` |
| Elicitation (form) | `elicitation/create` | `await this.elicit({ ask: '...' })` | Arbitrary input (text, select, form, etc.) |
| Progress | `notifications/progress` | `this.status(msg)` / `this.progress(value)` | Show live activity during long work |

Every primitive reads its runtime hook from the per-invocation
execution context. You call `this.<method>` from inside any photon
method — plain async, generator, static — and the runtime resolves it
for whichever surface the request arrived through (Beam, Claude
Desktop, Cursor, the CLI).

> Works on plain classes without `extends Photon`. The loader
> always-injects these methods on every instance — no decorators, no
> capability flags, no detection regex. If the method is unavailable
> (e.g. the connected client didn't declare `sampling`), you get a
> clear error, never a silent default.

---

## `this.sample` — delegate LLM calls to the caller's agent

Sampling lets your photon ask the *driving agent's* LLM to generate
text for you. The agent's model runs the inference, the agent's budget
pays for it, and your photon never needs an API key.

### The basic shape

```ts
async summarize(params: { text: string }) {
  const summary = await this.sample({
    prompt: `Summarize this in one sentence:\n\n${params.text}`,
    maxTokens: 128,
  });
  return { summary };
}
```

`this.sample` returns the generated text as a string. For the common
single-text-block response shape, that's all you need.

### Full parameters

```ts
interface SampleParams {
  prompt?: string;              // shortcut — wrapped as one user message
  messages?: SamplingMessage[]; // or provide the full conversation
  systemPrompt?: string;
  maxTokens?: number;           // defaults to 1024
  temperature?: number;
  modelPreferences?: {
    hints?: Array<{ name: string }>;     // e.g. [{ name: 'claude-3-5-sonnet' }]
    costPriority?: number;               // 0-1
    speedPriority?: number;              // 0-1
    intelligencePriority?: number;       // 0-1
  };
  stopSequences?: string[];
  includeContext?: 'none' | 'thisServer' | 'allServers';
}
```

Use `messages` when you need multi-turn conversation or image content:

```ts
async critique(params: { draft: string; previous: string }) {
  return await this.sample({
    systemPrompt: 'You are a sharp editor. One paragraph max.',
    messages: [
      { role: 'user', content: { type: 'text', text: params.previous } },
      { role: 'assistant', content: { type: 'text', text: 'Got it.' } },
      { role: 'user', content: { type: 'text', text: `Critique this:\n\n${params.draft}` } },
    ],
    maxTokens: 300,
  });
}
```

### When sampling isn't available

If the connected MCP client didn't declare the `sampling` capability
during initialize, `this.sample()` throws a clear error. Claude
Desktop, Claude Code, Cursor, and Codex all support sampling. Smaller
MCP clients may not — guard the call:

```ts
try {
  return await this.sample({ prompt });
} catch (err) {
  // fall back to a deterministic path
  return fallbackSummary(text);
}
```

---

## `this.confirm` — yes/no in one line

```ts
if (await this.confirm('Delete all records?')) {
  await purge();
}
```

That's it. The runtime routes the question through the client's
elicitation UI (Beam dialog, Claude confirm prompt, etc.) and returns
`true` / `false`. Coerces any truthy / falsy response.

## `this.elicit` — arbitrary input

`this.confirm` is sugar over the broader elicitation surface. For
anything other than yes/no, use `this.elicit`:

```ts
const name = await this.elicit<string>({
  ask: 'text',
  message: 'What should I call this photon?',
});

const env = await this.elicit<string>({
  ask: 'select',
  message: 'Deploy to which environment?',
  options: ['dev', 'staging', 'prod'],
});

const details = await this.elicit<{ name: string; email: string }>({
  ask: 'form',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
    },
    required: ['name', 'email'],
  },
});
```

The available `ask` kinds: `text`, `password`, `confirm`, `select`,
`number`, `file`, `date`, `form`, `url`. All of them are also usable
as `yield { ask: ... }` inside generator methods for checkpointable
workflows — see `docs/internals/MCP-ELICITATION-IMPLEMENTATION.md`.

---

## `this.status` / `this.progress` — live feedback

For long-running work, emit status lines so the consumer (human at a
CLI or agent deciding whether to wait) can judge liveness.

```ts
async backfill(params: { count: number }) {
  this.status('Loading data');
  const rows = await fetchRows(params.count);

  for (const [i, row] of rows.entries()) {
    this.progress((i + 1) / rows.length, `Row ${i + 1}/${rows.length}`);
    await writeRow(row);
  }

  return { done: rows.length };
}
```

These are non-blocking emissions (no return value). See
[`LONG-RUNNING-METHODS.md`](./LONG-RUNNING-METHODS.md) for the full
heartbeat contract between runtime, photon developer, and consumer.

`this.toast(message, { type })`, `this.log(message, { level })`, and
`this.render(format, value)` are additional emit helpers — see the
class-level docs in `photon-core/src/base.ts`.

---

## Imperative vs. yield

For generator methods, you can keep using the yield form:

```ts
async *setup() {
  const env = yield this.ask('select', 'Environment?', { options: ['dev', 'prod'] });
  const confirmed = yield this.ask('confirm', `Deploy to ${env}?`);
  if (!confirmed) return;
  // ...
}
```

For plain async methods that need one input in the middle, reach for
the imperative form:

```ts
async deploy() {
  if (!(await this.confirm('Deploy to prod?'))) return;
  await runDeploy();
}
```

Use whichever matches the method's control flow. Generators are
natural for multi-step workflows with checkpoints; imperative calls
are natural for one-shot prompts.
