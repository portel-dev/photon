#!/bin/bash
# Test runner with failure summary
# Runs all test suites and collects failures for a final report.

set -o pipefail

# Build first
echo "━━━ Building ━━━"
npm run build 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Build failed — aborting tests"
  exit 1
fi

# Define test suites (name:command)
SUITES=(
  "security:npx tsx tests/security.test.ts"
  "schema:npx tsx tests/schema-extractor.test.ts"
  "marketplace:npx tsx tests/marketplace-manager.test.ts"
  "loader:npx tsx tests/loader.test.ts"
  "server:npx tsx tests/server.test.ts"
  "integration:npx tsx tests/integration.test.ts"
  "ui-resources:npx tsx tests/ui-resources.test.ts"
  "client-adaptive:npx tsx tests/client-adaptive.test.ts"
  "zero-config:npx tsx tests/zero-config.test.ts"
  "mcp-config:npx tsx tests/mcp-configuration.test.ts"
  "cli:npx tsx tests/cli-runner.test.ts"
  "logger:npx tsx tests/logger.test.ts"
  "error-handler:npx tsx tests/error-handler.test.ts"
  "validation:npx tsx tests/validation.test.ts"
  "daemon-pubsub:npx tsx tests/daemon-pubsub.test.ts"
  "daemon-buffer:npx tsx tests/daemon-event-buffer.test.ts"
  "instance-drift:npx tsx tests/instance-drift.test.ts"
  "daemon-watcher:npx tsx tests/daemon-watcher.test.ts"
  "ui-rendering:npx tsx --test tests/ui/result-rendering.test.ts"
  "photon-instance-mgr:npx vitest run tests/photon-instance-manager.test.ts"
  "viewport-proxy:npx vitest run tests/viewport-aware-proxy.test.ts"
  "viewport-manager:npx vitest run tests/viewport-manager.test.ts"
  "pagination-integration:npx vitest run tests/pagination-integration.test.ts"
  "pagination-perf:npx vitest run tests/pagination-performance.test.ts"
  "pagination-phase5:npx tsx tests/pagination-phase5.test.ts"
  "pagination-phase5c:npx tsx tests/pagination-phase5c.test.ts"
  "pagination-phase5d:npx tsx tests/pagination-phase5d.test.ts"
  "phase6a:npx tsx tests/phase6a-service-worker.test.ts"
  "phase6b:npx tsx tests/phase6b-offline-state.test.ts"
  "phase6c:npx tsx tests/phase6c-offline-sync.test.ts"
  "phase6d:npx tsx tests/phase6d-integration.test.ts"
  "promises:npx tsx tests/promises.test.ts"
  "readme:bash tests/readme-validation.sh"
)

TOTAL=0
PASSED=0
FAILED=0
FAILURES=()
LOGDIR=$(mktemp -d)

echo ""
echo "━━━ Running ${#SUITES[@]} test suites ━━━"
echo ""

for entry in "${SUITES[@]}"; do
  NAME="${entry%%:*}"
  CMD="${entry#*:}"
  TOTAL=$((TOTAL + 1))
  LOGFILE="$LOGDIR/$NAME.log"

  printf "  %-30s " "$NAME"

  # Run test, capture output
  eval "$CMD" > "$LOGFILE" 2>&1
  EXIT=$?

  if [ $EXIT -eq 0 ]; then
    PASSED=$((PASSED + 1))
    echo "✓ pass"
  else
    FAILED=$((FAILED + 1))
    echo "✗ FAIL (exit $EXIT)"
    FAILURES+=("$NAME")
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Total:  $TOTAL"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "❌ FAILED SUITES:"
  echo ""
  for NAME in "${FAILURES[@]}"; do
    echo "  ┌── $NAME ──"
    # Show last 15 lines of output (usually contains the error)
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
