---
type: Architecture
title: Conformance and Enforcement Architecture
description: Structural guarantees for cross-transport parity, format coverage, and data-path stability.
---
> Related: [index.md](index.md) | [daemon-architecture.md](daemon-architecture.md)

# Conformance and Enforcement Architecture

How the runtime guarantees cross-transport parity, format coverage, and
data-path stability structurally, instead of relying on convention and
post-hoc QA. Added June 2026.

## Schema-Driven Conformance Matrix

`tests/conformance/matrix.ts` generates parity checks from each fixture
photon's own extracted schema. For every declared method:

- Tool surface, inputSchema, and annotations must be identical on STDIO
  MCP and SSE HTTP.
- The method is invoked with schema-synthesized arguments (respecting
  @min/@max, enums, formats) across CLI (`--json`), STDIO, and SSE, and
  the data-level results must be equal.

Adding a method to a fixture adds its checks automatically; nothing to
remember. Methods marked `@destructive`, `@webhook`, or `@scheduled` get
schema-parity checks only, never invocation.

Fixtures: `tests/fixtures/promise-test.photon.ts` (basics),
`tests/fixtures/conformance-rich.photon.ts` (gauge, metric, kv, chips,
tree, timeline, constrained params). Runner:
`tests/conformance/conformance.test.ts`, wired into `run-tests.sh` and
`npm run test:conformance`.

Hand-written regression cases stay in `tests/transport-parity.test.ts`;
the matrix guarantees coverage breadth, the hand-written file pins
specific past regressions.

## Unified tools/call Handling

`PhotonServer.handleCallToolRequest()` (src/server.ts) is the single
tools/call flow for every MCP transport. STDIO and SSE handlers are
one-line delegates. Before this, @async fire-and-forget, task-mode
dispatch, config elicitation retry, and error logging existed only on
STDIO; the same call behaved differently per transport. Session routing
(notifications, input/sampling providers, elicitation) comes exclusively
from `HandlerContext.server`.

CLI direct execution shares `loader.executeTool()` with the MCP path, so
all three transports converge on one execution core.

## Closed Format Registry

`src/formats/format-registry.ts` declares coverage for every literal
`OutputFormat` value on every render target as
`Record<CanonicalFormat, Record<RenderTarget, TargetCoverage>>`. Each
cell is either a real renderer (with its dispatch location) or an
explicit documented fallback; there is no absent state.

- Adding a format to photon-core's OutputFormat without a coverage
  decision per target fails `tsc` at build time.
- `tests/contract/format-coverage.test.ts` cross-checks registry cells
  against the scraped dispatch code in both directions, so the registry
  cannot drift from reality.
- Adding a render target means adding it to `RenderTarget`, forcing an
  explicit decision for all 30 formats at once.

## Explicit baseDir Enforcement

photon-core's data-path resolvers (`getDataRoot`, `getPhotonDataDir`,
etc.) fall back to `PHOTON_DIR`/`~/.photon` when baseDir is omitted.
Ambient resolution at call time caused the memory and storage baseDir
drift bugs. `eslint.config.mjs` now bans bare calls via
`no-restricted-syntax` (arity-checked per resolver); every call must
pass baseDir explicitly, using `getDefaultContext().baseDir` when the
boot context is the right answer. photon-core's `Photon.storage()` is
pinned to the loader-set `_baseDir` (regression test in photon-core
`tests/storage-basedir.test.ts`).

## Always-Inject, Never Regex-Gate

Capability injection for plain classes (emit, memory, storage, assets,
assetUrl) is unconditional. Source-regex gating (e.g.
`/this\.storage\s*\(/`) misses TS-cast call shapes like
`(this as any).storage(...)` and silently leaves helpers undefined.
All injected helpers are lazy closures (zero cost unless called) and
user-defined methods always win. `detectCapabilities()` remains
log-only diagnostics.

## DOM Render Contract

`tests/contract/render-dom.test.ts` executes every FORMAT_CATALOG entry
through the real bridge renderers (generateRenderersScript) in headless
Chromium with network blocked, asserting a real renderer is registered
(the json fallback must not mask gaps), no page errors, non-empty DOM,
and that the example's leaf values appear in the output. Closes the
chain: registry declares coverage, conformance proves transport,
this proves data reaches the DOM. chart:* asserts on its offline data
table fallback.

Release gate: CI, Release, and `scripts/pre-release-check.sh` must install
Playwright Chromium before the suite runs. A missing browser is a release
blocker, not a flaky test to rerun around, because it means DOM contract
coverage did not execute on the release surface.

## Daemon Chaos Suite

`tests/daemon-chaos.test.ts` inflicts the daemon's historical failure
modes deliberately (SIGKILL mid-life, vanished socket, stale pid file,
spawn race, worker respawn after the daemon's spawn cwd is deleted) in
isolated HOMEs, asserting one invariant: every recovery path converges
to clean-boot state. Scenario 5 cache-busts the photon source so the
respawn recompiles through cwd-sensitive child processes (verified red
without the chdir fix).

Release gate: every release must address failures here before tagging or
publishing. The spawn-race scenario protects the one-daemon-per-HOME
contract; if it fails, fix daemon startup or the process-count assertion
with evidence before proceeding.

## Identity Module

`src/shared/identity.ts` owns every compound photon identity format:
ps targets (LAST-colon split), channels (FIRST-colon split), circuit
keys, loader cache keys; `photonFromCompositeKey` in
daemon/registry-keys.ts inverts compositeKey. A lint rule bans
hand-rolled `split(':')`/`lastIndexOf(':')` in backend src; non-identity
uses carry per-line disables with reasons.

## Security Posture Contract

`tests/contract/security-posture.test.ts` pins default-closed: CORS
answers localhost origins only (including lookalike-attack unit tests
and source scans for wildcard or out-of-policy headers), HTTP error
responses never carry raw error text (paren-balanced payload scan with
`posture-allow:` exemptions), the four exposed surfaces keep their rate
limiters, and the playground stays inside the devMode gate.

## Coverage Gate

`tests/contract/coverage-gate.test.ts` makes new surface area arrive
with its keeper: every DaemonRequest type needs a daemon dispatch site
AND at least one test; every bridge-rendered format needs a
FORMAT_CATALOG entry (which auto-feeds the DOM contract). The format
registry carries `bridge` as a third RenderTarget, cross-checked against
the actual generated script.

## Resolved Divergence (June 12)

Plain-class `storage()` injected by the loader used to resolve next to
the photon source file while the Photon base class resolved under
`.data/`. The documented contract (data dir) won: the injected helper now
delegates to `getPhotonDataDir(ns, name, baseDir)` exactly like the base
class, with no legacy fallback (decision: owner). Regression test:
`tests/storage-injected-location.test.ts`.
