# Photon UX Guidelines

These conventions keep the CLI, MCP runtime, and playground output consistent and professional. Follow them when adding new commands or runtime features.

## CLI output

- Always use the helpers exported from `cli-formatter` (`printHeader`, `printInfo`, `renderSection`, `formatOutput`, etc.) instead of raw `console.log`.
- Group related details into sections; start each command with a short header that explains what is happening.
- Prefer tables, trees, or sections over ad-hoc paragraphs so output stays machine-readable.
- When emitting counts, prefix them with a short label (e.g., `Tools: 4`) and follow with a `renderSection` list for detail.
- Exit codes should reflect success (0) vs actionable failure (>0). Surface actionable guidance right after the diagnostics section (see `photon doctor`).

## Logging & diagnostics

- Use the shared `Logger` (`src/shared/logger.ts`) inside runtime/server code. Do not call `console.error` or `console.log` directly from long‑running services.
- Respect the global `--log-level` option (error | warn | info | debug) and the `--json-logs` flag. JSON logs should be newline-delimited objects with `timestamp`, `level`, `component`, and `scope`.
- When creating helper classes (watchers, transports, etc.), accept a `Logger` instance or derive one via `PhotonServer#createScopedLogger(scope)`.
- Record structured metadata (port numbers, photon names, retry counts) so operators can trace issues from logs alone.

## Beam UI status surface

- The Beam UI (`photon beam`) reserves the top of the sidebar for runtime status. Keep status payloads lightweight JSON broadcast via SSE.
- Status objects should contain `type` (`info`, `success`, `warn`, `error`), a human sentence, and timestamps. Add warning strings when configuration is incomplete so the UI can surface them.
- Avoid blocking UI interactions during long operations—instead, stream progress via SSE events and ensure the UI updates status indicators accordingly.

## Suggested workflow additions

- Add a `photon doctor` entry to any new docs when introducing features that affect environment health so users discover it.
- When adding commands, document the purpose and sample output in [`GUIDE.md`](../GUIDE.md) and align terminology with these sections.
