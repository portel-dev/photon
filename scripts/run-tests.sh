#!/bin/bash
# Test runner with failure summary
# Runs all test suites and collects failures for a final report.
# Uses bun for faster execution (falls back to npx tsx if bun unavailable).

set -o pipefail

# Detect runtime
if command -v bun &>/dev/null; then
  RUN="bun"
  VITEST="bunx vitest run"
  # bun needs 'bun test' for node:test describe/it, not 'bun file.ts'
  RUN_TEST="bun test"
else
  RUN="npx tsx"
  VITEST="npx vitest run"
  RUN_TEST="npx tsx --test"
fi

# Build first
echo "━━━ Building ━━━"
if command -v bun &>/dev/null; then
  bun run build 2>&1
else
  npm run build 2>&1
fi
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
  "daemon-pubsub:$RUN tests/daemon-pubsub.test.ts"
  "daemon-buffer:$RUN tests/daemon-event-buffer.test.ts"
  "instance-drift:$RUN tests/instance-drift.test.ts"
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
  "serv-http-auth:$RUN tests/serv-http-auth.test.ts"
  "session-resolver:$RUN tests/session-resolver.test.ts"
  "session-resolver-disk-fallback:$RUN tests/session-resolver-disk-fallback.test.ts"
  "shell-cwd-injection:$RUN tests/shell-cwd-injection.test.ts"
  "sqlite-stores:$RUN tests/sqlite-stores.test.ts"
  "typed-access-capabilities:$RUN tests/typed-access-capabilities.test.ts"
  "version-dev-marker:$RUN tests/version-dev-marker.test.ts"
  "mcp-client-sdk:$RUN tests/mcp-client-sdk.test.ts"
  "schedule-autonomous-fire:$RUN tests/schedule-autonomous-fire.test.ts"
  "schedule-boot-load:$RUN tests/schedule-boot-load.test.ts"
  "schedule-ghost-cancel:$RUN tests/schedule-ghost-cancel.test.ts"
  "schedule-missed-fire:$RUN tests/schedule-missed-fire.test.ts"
)

TOTAL=0
PASSED=0
FAILED=0
FAILURES=()
LOGDIR=$(mktemp -d)
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
