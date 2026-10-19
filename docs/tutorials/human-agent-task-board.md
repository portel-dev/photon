# A task board shared by a human and an agent

This walkthrough uses the existing `examples/todo.photon.ts`. Its methods are the
business capabilities: `add`, `check`, `reorder`, `remove`, and `list`. Beam renders
`list` as an interactive checklist; an MCP client calls the same methods and
operates on the same runtime state.

## Run the example

From the Photon repository, copy only the Todo example into a workspace:

```bash
mkdir -p /tmp/photon-task-board
cp examples/todo.photon.ts /tmp/photon-task-board/
cp -R examples/todo /tmp/photon-task-board/
cd /tmp/photon-task-board
photon beam --port 3479 --no-open
```

Use the local build of Photon when evaluating unreleased changes. Existing
commands and method names are unchanged.

Open `http://localhost:3479/todo/add`, enter a task, and submit. Then open
`http://localhost:3479/todo/list` to see the generated checklist. Checking an item
invokes `check`; it changes the shared state rather than a browser-only copy.
The companion custom dashboard is optional and manages its own refresh bindings.

## Connect an agent

Connect an MCP client to `http://localhost:3479/mcp`. Discover tools, then invoke
`todo.add` with `{ "text": "Review the release" }`. Keep Beam's `list` view open:
the new task should appear without reloading the page. Complete it through the
checkbox and read `todo.list` through MCP; the client should see `done: true`.

CLI execution is another way to exercise this same capability:

```bash
photon cli todo add --text "Prepare release notes"
photon cli todo list
```

Address the same workspace and named instance in every client. Independent
embedded library objects are a separate execution context; they do not become
the live Beam instance merely by loading the same source file.

The simple local walkthrough uses the local server's configured authentication
policy. For protected hosting, configure inbound authentication as described in
[MCP inbound OAuth](../guides/MCP-INBOUND-OAUTH.md). The automated milestone uses
an isolated test bearer token and verifies that unauthenticated mutations fail.

## Try an interruption

Disconnect the browser's network, add another task through the agent, then
reconnect the browser. The checklist should converge to current state. Restart
Beam and its workspace runtime, reopen the list, and verify persisted tasks and
completion state. Do not assume every notification was replayed.

`list` explicitly declares `@readOnly`. Beam revalidates its visible stateful
result every three seconds while online, and on returning online or to the tab.
Destructive or undeclared methods are never replayed as background refreshes.
Cancelling `remove` at the confirmation leaves the task intact. This is a
pre-dispatch cancellation; cancellation of a running asynchronous task has a
separate cooperative contract.

## Verify the milestone

```bash
bun run build
bunx playwright install chromium
bunx playwright test tests/beam/e2e/human-agent-collaboration.e2e.test.ts --reporter=line
```

The test uses the shipped example, real Chromium, and an independent deterministic
MCP client. It verifies browser-to-agent and agent-to-browser state, offline
recovery, concurrent additions, destructive-confirmation cancellation, rejected
unauthenticated and invalid mutations, and exact state preservation after both
Beam and its isolated daemon restart. It needs no model account or remote service.

`bun run test` also runs this milestone. The test covers this generated-checklist
workflow; it does not establish arbitrary custom UI behavior, general conflict
resolution, or exactly-once event delivery.

For application-code reuse of the same Photon source, see
[Photon as a library](../internals/PHOTON-AS-LIBRARY.md).
