#!/bin/bash
# Test runner with failure summary
# Runs all test suites and collects failures for a final report.
# Uses Bun for install/build/test execution.

set -o pipefail

# macOS GUI-launched shells can inherit a very low soft descriptor limit even
# when interactive shells report a higher value. The full suite starts many
# short-lived Bun/Vitest processes and writes per-suite logs, so raise the soft
# limit before the runner begins.
ulimit -n 4096 2>/dev/null || ulimit -n 2048 2>/dev/null || true

if ! command -v bun &>/dev/null; then
  echo "❌ Bun is required. Install Bun, then run: bun install"
  exit 1
fi
RUN="bun"
VITEST="bunx vitest run"
# bun needs 'bun test' for node:test describe/it, not 'bun file.ts'
RUN_TEST="bun test"

# Build first
echo "━━━ Building ━━━"
bun run build 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Build failed — aborting tests"
  exit 1
fi

# Define test suites (name:command)
# $RUN and $VITEST are expanded at eval time.
# Append new suites here whenever a test file is added under tests/.
SUITES=(
  # Core
  "security:$RUN tests/security.test.ts"
  "schema:$RUN tests/schema-extractor.test.ts"
  "marketplace:$RUN tests/marketplace-manager.test.ts"
  "loader:$RUN tests/loader.test.ts"
  "server:$RUN tests/server.test.ts"
  "integration:$RUN tests/integration.test.ts"
  "ui-resources:$RUN tests/ui-resources.test.ts"
  "client-adaptive:$RUN tests/client-adaptive.test.ts"
  "zero-config:$RUN tests/zero-config.test.ts"
  "mcp-config:$RUN tests/mcp-configuration.test.ts"
  "cli:$RUN tests/cli-runner.test.ts"
  "logger:$RUN tests/logger.test.ts"
  "error-handler:$RUN tests/error-handler.test.ts"
  "validation:$RUN tests/validation.test.ts"
  "bridge-generation:$RUN tests/bridge/bridge-generation.test.ts"
  "bridge-protocol:$RUN tests/bridge/protocol.test.ts"
  "bridge-integration:$RUN tests/bridge/beam-integration.test.ts"
  "beam-web-routes:$RUN tests/beam-web-route-matching.test.ts"
  "streamable-http:$RUN tests/streamable-http-transport.test.ts"
  "daemon-pubsub:$RUN tests/daemon-pubsub.test.ts"
  "daemon-subscribe-reconnect-leak:$RUN tests/daemon-subscribe-reconnect-leak.test.ts"
  "storage-injected-location:$RUN tests/storage-injected-location.test.ts"
  "daemon-chaos:$RUN tests/daemon-chaos.test.ts"
  "env-proxy-set:bunx tsx tests/env-proxy-set.test.ts"
  "identity:$RUN tests/identity.test.ts"
  "daemon-buffer:$RUN tests/daemon-event-buffer.test.ts"
  "instance-drift:$RUN tests/instance-drift.test.ts"
  "daemon-stale-binary:$RUN tests/daemon-stale-binary-restart.test.ts"
  "daemon-watcher:$RUN tests/daemon-watcher.test.ts"
  "execution-history:$RUN tests/execution-history.test.ts"
  "beam-daemon-routes:$RUN tests/beam-daemon-routes.test.ts"
  "ui-rendering:$RUN_TEST tests/ui/result-rendering.test.ts"
  "photon-instance-mgr:$VITEST tests/photon-instance-manager.test.ts"
  "viewport-proxy:$VITEST tests/viewport-aware-proxy.test.ts"
  "viewport-manager:$VITEST tests/viewport-manager.test.ts"
  "pagination-integration:$VITEST tests/pagination-integration.test.ts"
  "pagination-perf:$VITEST tests/pagination-performance.test.ts"
  "pagination-phase5:$RUN tests/pagination-phase5.test.ts"
  "pagination-phase5c:$RUN tests/pagination-phase5c.test.ts"
  "pagination-phase5d:$RUN tests/pagination-phase5d.test.ts"
  "phase6a:$RUN tests/phase6a-service-worker.test.ts"
  "phase6b:$RUN tests/phase6b-offline-state.test.ts"
  "phase6c:$RUN tests/phase6c-offline-sync.test.ts"
  "phase6d:$RUN tests/phase6d-integration.test.ts"
  "promises:$RUN tests/promises.test.ts"
  "readme:bash tests/readme-validation.sh"
  # v1.23 additions
  "a2ui-mapper:$RUN tests/a2ui-mapper.test.ts"
  "a2ui-e2e:$RUN tests/a2ui-e2e.test.ts"
  "a2ui-renderer-script:$RUN tests/a2ui-renderer-script.test.ts"
  "ag-ui-adapter:$RUN tests/ag-ui-adapter.test.ts"
  "audit-sqlite:$RUN tests/audit-sqlite.test.ts"
  "auth-endpoints:$RUN tests/auth-endpoints.test.ts"
  "call-always-injected:$RUN tests/call-always-injected.test.ts"
  "claim-codes:$RUN tests/claim-codes.test.ts"
  "claim-scope-enforcement:$RUN tests/claim-scope-enforcement.test.ts"
  "cimd:$RUN tests/cimd.test.ts"
  "format-coverage:$RUN tests/contract/format-coverage.test.ts"
  "render-dom:$RUN tests/contract/render-dom.test.ts"
  "security-posture:$RUN tests/contract/security-posture.test.ts"
  "coverage-gate:$RUN tests/contract/coverage-gate.test.ts"
  "daemon-multibase-keys:$RUN tests/daemon-multibase-keys.test.ts"
  "daemon-protocol-validation:$RUN tests/daemon-protocol-validation.test.ts"
  "daemon-schedule-provider:$RUN tests/daemon-schedule-provider.test.ts"
  "execution-history-sqlite:$RUN tests/execution-history-sqlite.test.ts"
  "format-snapshot:$RUN tests/format-snapshot.test.ts"
  "hot-reload-state-transfer:$RUN tests/hot-reload-state-transfer.test.ts"
  "memory-always-injected:$RUN tests/memory-always-injected.test.ts"
  "memory-sqlite:$RUN tests/memory-sqlite.test.ts"
  "concurrent-calls:$RUN tests/concurrent-calls.test.ts"
  "caller-cwd:$RUN tests/caller-cwd.test.ts"
  "sample-elicit-confirm:$RUN tests/sample-elicit-confirm.test.ts"
  "memory-baseDir-regression:$RUN tests/memory-baseDir-regression.test.ts"
  "oauth:$RUN tests/oauth.test.ts"
  "oauth-sqlite-stores:$RUN tests/oauth-sqlite-stores.test.ts"
  "schedule-baseDir-regression:$RUN tests/schedule-baseDir-regression.test.ts"
  "schedule-suppress-disable:$RUN tests/schedule-suppress-disable.test.ts"
  "serv-http-auth:$RUN tests/serv-http-auth.test.ts"
  "session-resolver:$RUN tests/session-resolver.test.ts"
  "session-resolver-disk-fallback:$RUN tests/session-resolver-disk-fallback.test.ts"
  "shell-cwd-injection:$RUN tests/shell-cwd-injection.test.ts"
  "sqlite-stores:$RUN tests/sqlite-stores.test.ts"
  "typed-access-capabilities:$RUN tests/typed-access-capabilities.test.ts"
  "version-dev-marker:$RUN tests/version-dev-marker.test.ts"
  "version-notify:$RUN tests/version-notify.test.ts"
  "mcp-client-sdk:$RUN tests/mcp-client-sdk.test.ts"
  "schedule-autonomous-fire:$RUN tests/schedule-autonomous-fire.test.ts"
  "schedule-boot-load:$RUN tests/schedule-boot-load.test.ts"
  "schedule-ghost-cancel:$RUN tests/schedule-ghost-cancel.test.ts"
  "schedule-cancel-create-regression:$RUN tests/schedule-cancel-create-regression.test.ts"
  "schedule-declared-active-dedup:$RUN tests/schedule-declared-active-dedup.test.ts"
  "schedule-ghost-photon:$RUN tests/schedule-ghost-photon.test.ts"
  "schedule-missed-fire:$RUN tests/schedule-missed-fire.test.ts"
  "daemon-imposter-eviction:$RUN tests/daemon-imposter-eviction.test.ts"
  "host-mode:$RUN tests/host-mode.test.ts"
  "sample-augmenter:$RUN tests/sample-augmenter.test.ts"
  "cf-route-matcher:$VITEST tests/cf-template-route-matcher.test.ts"
  "cf-deploy-codegen:$VITEST tests/cf-deploy-codegen.test.ts"
  "cf-deploy-stale-core:$VITEST tests/cf-deploy-codegen-stale-core.test.ts"
  "daemon-rpc-contract:$RUN tests/daemon-rpc-contract.test.ts"
  "durable-lines:$RUN tests/durable-lines.test.ts"
  "daemon-parent-watchdog:$RUN tests/daemon-parent-watchdog.test.ts"
  "daemon-health-probe:$RUN tests/daemon-health-probe.test.ts"
  "worker-dep-proxy:$RUN tests/worker-dep-proxy.test.ts"
  "progress-token-echo:$VITEST tests/progress-token-echo.test.ts"
  "transport-parity-resources:$VITEST tests/transport-parity-resources.test.ts"
  "transport-parity:$RUN tests/transport-parity.test.ts"
  "conformance:$RUN tests/conformance/conformance.test.ts"
  "dynamic-resources-subscribe:$VITEST tests/dynamic-resources-subscribe.test.ts"
  "roots:$VITEST tests/roots.test.ts"
  "subscribe-sse-e2e:$VITEST tests/dynamic-resources-subscribe-sse.e2e.test.ts"
  "beam-status-sse:$VITEST tests/beam-status-sse.test.ts"
)

TOTAL=0
PASSED=0
FAILED=0
FAILURES=()
LOGDIR=$(mktemp -d)
STATUSFILE="$LOGDIR/status.tsv"
START_TIME=$(date +%s)

echo ""
echo "━━━ Running ${#SUITES[@]} test suites ($RUN) ━━━"
echo ""

for entry in "${SUITES[@]}"; do
  NAME="${entry%%:*}"
  CMD="${entry#*:}"
  TOTAL=$((TOTAL + 1))
  LOGFILE="$LOGDIR/$NAME.log"

  printf "  %-30s " "$NAME"

  SUITE_START=$(date +%s)
  eval "$CMD" > "$LOGFILE" 2>&1
  EXIT=$?
  printf "%s\t%s\t%s\n" "$NAME" "$EXIT" "$CMD" >> "$STATUSFILE"
  SUITE_END=$(date +%s)
  SUITE_DUR=$((SUITE_END - SUITE_START))

  if [ $EXIT -eq 0 ]; then
    PASSED=$((PASSED + 1))
    echo "✓ pass  ${SUITE_DUR}s"
  else
    FAILED=$((FAILED + 1))
    echo "✗ FAIL  ${SUITE_DUR}s"
    FAILURES+=("$NAME")
  fi
done

END_TIME=$(date +%s)
TOTAL_DUR=$((END_TIME - START_TIME))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Total:  $TOTAL   (${TOTAL_DUR}s)"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "❌ FAILED SUITES:"
  echo ""
  for NAME in "${FAILURES[@]}"; do
    echo "  ┌── $NAME ──"
    tail -15 "$LOGDIR/$NAME.log" | sed 's/^/  │ /'
    echo "  └──────────"
    echo ""
  done
  echo "  Full logs: $LOGDIR/"
  exit 1
else
  echo ""
  echo "✅ All tests passed!"
  rm -rf "$LOGDIR"
  exit 0
fi
