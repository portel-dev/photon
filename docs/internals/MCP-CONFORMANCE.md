# MCP conformance and SDK policy

Photon keeps its protocol model independent of the official TypeScript SDK.
The SDK is an interoperability dependency at the edge, not the source of
Photon's canonical 2026 types.

## Tested versions

The machine-readable pins live in
`tests/conformance/pins.json`. The current release gate uses:

| Component | Pinned revision |
| --- | --- |
| MCP specification | `modelcontextprotocol/modelcontextprotocol@31eefec6` |
| MCP 2026 protocol | `2026-07-28` |
| Tasks extension | `modelcontextprotocol/ext-tasks@2c1425d9` |
| MCP Apps | `@modelcontextprotocol/ext-apps@1.7.5` |
| TypeScript SDK v1 | `@modelcontextprotocol/sdk@1.29.0` |
| Official conformance | `@modelcontextprotocol/conformance@0.2.0-alpha.10` |

The TypeScript SDK v2 line is still prerelease (`2.0.0-beta.5` at the pinned
review). Photon will not replace a stable compatibility adapter with a beta
runtime dependency. Adoption requires a stable v2 release, coverage for every
advertised Photon feature, and a clean golden-wire diff.

## Adapter boundary

All v1 SDK imports in production source are confined to
`src/mcp/sdk-v1-2025/`. Modules under `src/mcp/protocol/` must not import that
boundary. This prevents v1-only result types or SDK classes from becoming
canonical 2026 runtime types.

Run the boundary check with:

```bash
bun run test:mcp-sdk-boundary
```

## Verification profiles

The release gate is split by what the upstream runner can actually exercise:

| Profile | Command | Coverage |
| --- | --- | --- |
| Official 2025 HTTP | `MCP_CONFORMANCE_PROFILE=mcp-2025-http bun run test:mcp-official-conformance` | 42 checks |
| Official 2026 core HTTP | `MCP_CONFORMANCE_PROFILE=mcp-2026-http-core bun run test:mcp-official-conformance` | 23 checks |
| Official 2026 draft HTTP | `MCP_CONFORMANCE_PROFILE=mcp-2026-http-draft bun run test:mcp-official-conformance` | 80 checks |
| Official Tasks extension | `MCP_CONFORMANCE_PROFILE=mcp-2026-tasks-extension bun run test:mcp-official-conformance` | 35 checks |
| Photon stdio/HTTP parity | `bun run test:photon-conformance` | Generated schema, annotation, and invocation parity |
| MCP Apps contract | `bun run test:mcp-apps-contract` | Resource, client-capability, host protocol, and bridge behavior |
| Golden wire adapters | `bun run test:mcp-wire` | Revision-specific request and response fixtures |

Run every official HTTP and Tasks profile with:

```bash
bun run test:mcp-official-conformance
```

Reports and runner logs are written below `artifacts/mcp-conformance/`. CI
archives that directory even when a profile fails.

## Upstream coverage decisions

The pinned official server runner accepts a URL and does not expose a stdio
server target. Photon therefore uses the official runner for Streamable HTTP
and its generated parity suite with the stable official SDK for stdio.

The pinned upstream conformance package has no MCP Apps server scenarios.
Photon therefore treats `test:mcp-apps-contract` as the complete extension
contract gate. This is an explicit coverage substitution, not a claim that an
upstream Apps suite passed.

The official conformance package is itself prerelease because it is the first
line containing the 2026 draft and Tasks scenarios. Its exact version and
source revision are pinned; Dependabot-style floating upgrades are not used for
the release gate.

## Upgrade policy

The main CI gate installs exact dependency pins. A weekly compatibility job
installs the newest SDK patch allowed by the recorded v1 compatibility range
and runs the SDK boundary, cross-transport, and MCP Apps contract suites.

An SDK or schema update may be merged only when:

1. canonical protocol tests pass without source casts to SDK-only types;
2. golden 2025 and 2026 wire fixtures have no unexplained changes;
3. official HTTP and Tasks profiles pass;
4. stdio/HTTP parity and MCP Apps contracts pass;
5. the pins file and this document are updated together.
