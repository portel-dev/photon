# Photon Improvement Plan
_Date: 2026-01-10_

## Photon Runtime Overview
- **Loader (`src/loader.ts`)** compiles `.photon.ts` files with `tsx`, installs declared dependencies, and caches compiled bundles plus manifest metadata under `~/.cache/photon-mcp` so MCP servers and the CLI can run the same artifact.
- **Server (`src/server.ts`)** wraps `@modelcontextprotocol/sdk/server`, hydrates tools/prompts/resources produced by the loader, and exposes stdio/HTTP transports so Claude Desktop, Cursor, and Photon’s daemon can attach.
- **Daemon & Watcher (`src/daemon/*.ts`, `src/watcher.ts`)** keep long-lived MCP instances hot, watch the filesystem for recompiles, and stream status updates via SSE/WebSocket bridges to local clients.
- **CLI (`src/cli.ts`)** is the control plane: it scaffolds photons, validates schemas, manages marketplaces, and exposes doctor/setup flows that humans and agents rely on for lifecycle automation.
- **Integrations (`src/deploy/*`, `src/test-client.ts`)** push the runtime into hosting targets (e.g., Cloudflare Workers) and provide smoke-test harnesses for external consumers.

## Code Quality Snapshot
- Cache keys and dependency manifests rely only on photon names, so similarly named files in different directories clobber each other (`src/loader.ts`).
- Remote source resolution (`github`, `npm`) is stubbed with TODOs; marketplace-driven photons cannot be fetched without manual copying, breaking CLI workflows.
- Multiple components hard-code versions (`src/server.ts` → `'1.0.0'`, CLI banners) rather than reading from `package.json`, producing misleading diagnostics and bug reports.
- Configuration helpers live in both `src/loader.ts` and `src/cli.ts`, drifting in wording/behavior and forcing duplicated tests.
- Reload/backoff behavior in `PhotonServer` + watcher layers logs retries but never exposes failure state to clients, making IDE integrations blind to crashes.
- Observability and tests skew toward happy paths; asset discovery, dependency audit failures, and SSE flows lack coverage.
- CLI/UX logic intermixes raw `console.log` calls with formatter utilities, so some commands look polished while others echo inconsistent banners.

## Recommended Fixes

### 1. Isolate Dependency and Build Caches
- **Problem:** `PhotonLoader` stores dependency metadata and compiled `.mjs` artifacts under `~/.cache/photon-mcp/dependencies/${mcpName}` (`src/loader.ts`), so two distinct photons that share a name (e.g., `analytics.photon.ts` from different directories) clobber each other.
- **Fix:** include the photon file hash (or resolved path) in both cache paths and metadata files, and invalidate per `[name+hash]` key instead of name-only. This prevents false cache hits and ensures hot reloads don't reuse code compiled from another project.
- **Bonus:** surface cache directory in verbose logs so users can manually clear problematic entries.

### 2. Complete Marketplace/GitHub/NPM Resolution Paths
- **Problem:** `resolvePhotonPath` (`src/loader.ts`) throws `TODO` errors for `github` and `npm` source types and only heuristically checks local folders for `marketplace` entries, leaving CLI features such as @photon dependencies unusable outside local copies.
- **Fix:**
  1. Implement marketplace download hooks that consult `templates/` or a configurable registry URL before falling back to the filesystem.
  2. For `github`, support `owner/repo/path` refs via `gh api` or `fetch`, caching under `~/.photon/marketplace`.
  3. For `npm`, leverage `npm view` + `npm pack` to download tarballs and extract `.photon.ts` files, with checksum validation.
- **Result:** `@photon` dependencies declared in source can be resolved consistently, enabling composable photons and marketplace installs.

### 3. Source Version from package.json
- **Problem:** `PhotonServer` instantiates MCP `Server` with hard-coded `version: '1.0.0'` (`src/server.ts`), which quickly drifts from `package.json` (currently `1.4.1`).
- **Fix:** import version from `../package.json` (using `import type { version } from '../package.json' assert { type: 'json' }`) or inject it during build via `tsc` path mapping, then pass the real version into `Server` and CLI banners.
- **Benefit:** downstream clients, telemetry, and bug reports will reference accurate runtime versions.

### 4. Deduplicate Constructor/Env Documentation Logic
- **Problem:** Both `src/loader.ts` and `src/cli.ts` maintain bespoke helpers for extracting constructor params, computing env var names, and printing configuration instructions, leading to divergent messaging and maintenance burden.
- **Fix:** move env-var doc generation plus prompt helpers into a shared module (e.g., `src/shared/config-docs.ts`) that exposes `renderConfigGuide(params, mcpName)`; have both loader and CLI consume it.
- **Extra:** add unit tests covering the shared helper so docs remain synchronized.

### 5. Harden Hot-Reload Failure Handling
- **Problem:** `PhotonServer.reload()` tracks failure counts but only logs retries; `FileWatcher` immediately reports success/failure without exponential backoff or surfacing stack traces to dev UI.
- **Fix:**
  - Expose reload status via `notifications/status` so SSE clients/renderers know when recompiles fail.
  - After the max failure threshold, automatically disable the watcher until the next successful manual reload, preventing tight error loops.
  - Persist last error stack in memory and show it via `/api/status` for easier debugging.

### 6. Improve Observability and Testing Coverage
- **Problem:** While there are numerous `tests/*.ts` scripts, there is no automated coverage of asset discovery, MCP client injection failure cases, or SSE streaming endpoints, and runtime logs lack structured levels.
- **Fix:**
  - Add integration tests for `loader.executeTool` with mocked stateful workflows and asset URIs.
  - Introduce a lightweight logger abstraction (info/warn/error/debug) so verbose mode can be toggled without sprinkling `console.error` everywhere.
  - Wire these tests into `npm run test:all` to catch regressions before release.

### 7. Streamline Dependency Setup UX
- **Problem:** `setupMCPDependencies` (CLI) asks users for environment variables one MCP at a time, but there is no validation that provided values satisfy schema requirements, nor a way to reuse config across machines.
- **Fix:**
  - Allow exporting/importing `mcp-servers.json` snippets, and validate entries by calling `SDKMCPClientFactory` immediately after writing them.
  - Cache successful configs per workspace and show a summary table after setup so teams can copy-paste into documentation.

Implementing these fixes will make Photon’s runtime more deterministic, composable, and user-friendly, while reducing support load for cache confusion and dependency configuration issues.
