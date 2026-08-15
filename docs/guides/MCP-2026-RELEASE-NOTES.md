# MCP 2026 compatibility release notes

The current Photon release adds release-candidate support for MCP `2026-07-28`
over Streamable HTTP while retaining the existing MCP 2025 HTTP and stdio
paths.

## What changed

- Strict per-request 2026 metadata and mirrored routing-header validation.
- Stateless `server/discover`, deterministic lists, cache metadata, and
  request-scoped subscription streams.
- JSON Schema 2020-12 input and structured-output validation.
- Durable, replay-safe multi-round input for tools and prompts.
- The pinned `io.modelcontextprotocol/tasks` extension, including partial
  input fulfillment and MRTR-to-Task composition.
- Exact MCP Apps and Photon extension negotiation.
- OAuth resource/JWT authorization hardening, bounded trace propagation, and
  request-scoped logging.
- Shared-state restart, idempotency, load, and slow-consumer resilience gates.
- An isolated MCP 2025 SDK adapter and pinned official conformance runner.

MCP 2025 clients keep their initialization, transport session, live
sampling/elicitation, resource subscription, logging, and legacy Tasks
behavior. No client is upgraded based on its brand or a previous request.

## Verification checkpoint

The release checkpoint passes:

- 42/42 official MCP 2025 HTTP checks;
- 23/23 official MCP 2026 core HTTP checks;
- 80/80 official MCP 2026 draft checks;
- 35/35 official Tasks extension checks;
- 57/57 generated stdio/HTTP parity checks;
- Photon’s full MCP Apps contract suite.

Run `photon doctor mcp` to inspect the declarations shipped by the installed
runtime.

## Migration

Existing clients do not need to migrate. To adopt 2026:

1. Send `Mcp-Protocol-Version: 2026-07-28` on every request.
2. Add the same version and a client-capabilities object to `params._meta`.
3. Stop sending or retaining `Mcp-Session-Id`.
4. Call `server/discover` instead of relying on initialized session state.
5. Treat request state, application handles, cursors, subscription IDs, and
   task IDs as distinct opaque values.
6. Opt into Tasks, MCP Apps, or Photon metadata by exact extension ID on every
   request that needs it.
7. Replace live server-to-client input requests with the `input_required`
   retry loop.

Task users should replace the legacy list/separate-result workflow with
`tools/call`, `tasks/get`, `tasks/update`, and `tasks/cancel` when using 2026.
Roots, sampling, and logging users should follow
[the deprecated-feature guide](MCP-DEPRECATED-FEATURES.md).

## Known limitations

- MCP 2026 is supported over Streamable HTTP. Photon stdio remains on the
  stable MCP 2025 SDK adapter.
- The Tasks extension is experimental and pinned to
  `modelcontextprotocol/ext-tasks@2c1425d9`.
- The official conformance runner containing 2026 and Tasks coverage is a
  pinned prerelease. The stable upstream runner does not contain those suites.
- The upstream runner has no stdio target and no MCP Apps server scenarios.
  Photon uses generated cross-transport parity and its complete Apps contract
  suite for those surfaces.
- Subscription connections do not survive process or network loss. Clients
  reconnect and resubscribe; the subscription ID is not durable state.
- A running task interrupted with no resumable execution continuation becomes
  an explicit restart failure rather than being silently rerun.
- MCP Apps requires a host that implements the extension and the advertised
  `text/html;profile=mcp-app` resource type.

## Rollback

If a rollout exposes an incompatible client or proxy:

1. Stop sending `2026-07-28` and reconnect using MCP `2025-11-25`; Photon keeps
   the 2025 adapter active in the same release.
2. Remove per-request Tasks or MCP Apps extension declarations to disable those
   optional paths.
3. Pin the prior Photon package version if the runtime itself must be rolled
   back:

   ```bash
   bun add -g @portel/photon@1.36.1
   ```

4. Restart the Photon HTTP process. Do not delete the Photon state directory;
   request-state, task, handle, and idempotency records are versioned and
   bounded, and deleting them would turn a code rollback into data loss.

For a multi-instance deployment, drain 2026 subscription connections before
replacing instances and keep every instance pointed at the same documented
Photon state directory during the rollback window.
