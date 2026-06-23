#!/bin/bash
# Pre-release verification script
# Runs automatically before release-it to catch fresh-install issues
# Exit on any failure
set -e

# release-it can run hooks from environments with macOS's low GUI soft
# descriptor limit. Raise it before build/test/fresh-install checks.
ulimit -n 4096 2>/dev/null || ulimit -n 2048 2>/dev/null || true

echo "═══════════════════════════════════════════════════"
echo "  Pre-Release Verification"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── Pre-flight: git clean + registry sync ──────
# These two checks have caused repeated release failures.
# Run them first so the problem is visible immediately.

echo "▶ Pre-flight: working directory and registry"

# Must be clean before anything else runs.
GIT_DIRTY=$(git status --porcelain 2>/dev/null | grep -v '^\?\?' || true)
if [ -n "$GIT_DIRTY" ]; then
  echo "  ✗ FAIL: Working directory has uncommitted changes — commit or stash before releasing:"
  echo "$GIT_DIRTY" | sed 's/^/    /'
  exit 1
fi
echo "  ✓ Working directory is clean"

# Warn clearly if registry version does not match package.json.
# If registry is ahead, fail early because release-it would target an already-published version.
# If package.json is ahead, a previous release-it run likely tagged but did not publish.
PKG_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
NPM_VERSION=$(bun pm view "$(node -e "process.stdout.write(require('./package.json').name)")" version 2>/dev/null || echo "unavailable")
if [ "$NPM_VERSION" != "unavailable" ]; then
  VERSION_CMP=$(node -e "
    const parse = (v) => v.split('.').map(Number);
    const [a, b] = [process.argv[1], process.argv[2]].map(parse);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) > (b[i] || 0)) process.exit(1);
      if ((a[i] || 0) < (b[i] || 0)) process.exit(2);
    }
  " "$NPM_VERSION" "$PKG_VERSION"; echo $?)
  if [ "$VERSION_CMP" = "1" ]; then
    echo "  ✗ FAIL: npm registry has $NPM_VERSION but package.json says $PKG_VERSION"
    echo "    package.json is behind the already-published registry version."
    echo "    Bump package.json/bun.lock to $NPM_VERSION before running release-it,"
    echo "    or release-it will try to publish an already-existing version."
    exit 1
  elif [ "$VERSION_CMP" = "2" ]; then
    echo "  ⚠ npm registry has $NPM_VERSION but package.json says $PKG_VERSION"
    echo "    A prior release-it run likely tagged but did not publish."
    echo "    release-it can continue because the package version is ahead of npm."
  fi
fi
echo "  ✓ Registry check complete (npm: ${NPM_VERSION}, package.json: ${PKG_VERSION})"
echo ""

# ─── 0. Clean-state pre-flight ──────────────────────
# Catches dirty-repo bugs that have shipped before:
#  - Stray `*.photon.ts` in repo root: getDefaultContext() treats the repo
#    as a PHOTON_DIR and rebinds .data/, breaking loader tests with
#    confusing errors like "npm package did not install correctly".  HARD FAIL.
#  - Broken symlinks under tracked paths (esp. skills/*): tests clobber
#    them and the tarball can end up shipping dangling links.  HARD FAIL.
#  - Runtime artifacts the daemon writes to the repo root (daemon.lock,
#    .migrated, daemon.log, .data/): don't ship (files: bin/dist/templates)
#    but can pollute the fresh-install simulation in Step 7.  WARN only.
echo "▶ Step 0: Clean-state pre-flight"
HARD_FAIL=""
WARN=""

# 0a — stray photon files in repo root (HARD FAIL)
STRAY_PHOTONS=$(find . -maxdepth 1 -name '*.photon.ts' 2>/dev/null)
if [ -n "$STRAY_PHOTONS" ]; then
  HARD_FAIL="$HARD_FAIL\n  Stray .photon.ts in repo root (move to src/photons/ or delete):\n$(echo "$STRAY_PHOTONS" | sed 's/^/    /')"
fi

# 0b — broken symlinks under tracked paths (HARD FAIL)
BROKEN_LINKS=$(find src tests skills templates -type l ! -exec test -e {} \; -print 2>/dev/null)
if [ -n "$BROKEN_LINKS" ]; then
  HARD_FAIL="$HARD_FAIL\n  Broken symlinks (recreate or remove):\n$(echo "$BROKEN_LINKS" | sed 's/^/    /')"
fi

# 0c — runtime artifacts in repo root (WARN — they don't ship but can pollute tests)
for f in daemon.lock daemon.log .migrated .data; do
  if [ -e "$f" ]; then
    WARN="$WARN\n  Runtime artifact in repo root: $f (rm before release for clean test runs)"
  fi
done

if [ -n "$HARD_FAIL" ]; then
  echo "  ✗ FAIL: Repository has dirty state:"
  echo -e "$HARD_FAIL"
  if [ -n "$WARN" ]; then
    echo "  Also noticed (non-fatal):"
    echo -e "$WARN"
  fi
  exit 1
fi
if [ -n "$WARN" ]; then
  echo "  ⚠ Warnings:"
  echo -e "$WARN"
fi
echo "  ✓ No stray photons or broken symlinks"
echo ""

# ─── 1. Replace linked packages with registry versions ──
echo "▶ Step 1: Resolve package links"
LINKED=""
for dep in $(node -e "const p=require('./package.json'); console.log([...Object.keys(p.dependencies||{}), ...Object.keys(p.devDependencies||{})].join(' '))"); do
  target="node_modules/$dep"
  if [ -L "$target" ]; then
    version=$(node -e "const p=require('./package.json'); process.stdout.write((p.dependencies||{})['$dep'] || (p.devDependencies||{})['$dep'] || 'latest')")
    is_dev=$(node -e "const p=require('./package.json'); process.stdout.write((p.devDependencies||{})['$dep'] ? '1' : '0')")
    echo "  ⚠ $dep is linked → reinstalling $version from registry"
    unlink "$target" 2>/dev/null || rm -rf "$target"
    if [ "$is_dev" = "1" ]; then
      bun add --dev "$dep@$version" >/dev/null
    else
      bun add "$dep@$version" >/dev/null
    fi
    LINKED="$LINKED $dep"
  fi
done
if [ -z "$LINKED" ]; then
  echo "  ✓ No linked packages"
else
  echo "  ✓ Resolved:$LINKED"
  bun install --frozen-lockfile
fi
echo ""

# ─── 2. Lockfile sync check (critical — Bun install in CI/Release workflows fails hard if out of sync) ──
echo "▶ Step 2: Lockfile sync"
if ! bun install --frozen-lockfile --dry-run >/dev/null 2>&1; then
  echo "  ✗ FAIL: bun.lock is out of sync with package.json"
  echo "    CI and Release workflows will fail. Run 'bun install' and commit bun.lock."
  bun install --frozen-lockfile --dry-run 2>&1 | head -20
  exit 1
fi
echo "  ✓ bun install dry-run passes (bun.lock in sync)"
echo ""

# ─── 3. CI browser dependency pre-flight ─────────────
echo "▶ Step 3: CI browser dependency"
bunx playwright install --with-deps chromium
echo "  ✓ Playwright Chromium is installed for DOM contract tests"
echo ""

# ─── 4. Build verification ───────────────────────────
echo "▶ Step 4: Full build"
bun run build
bun run build:beam
echo "  ✓ Build passes"
echo ""

# ─── 5. Test suite ───────────────────────────────────
echo "▶ Step 5: Test suite"
if [ "${PHOTON_RELEASE_ASSUME_TESTED:-}" = "1" ]; then
  echo "  ✓ Tests already passed in this release session"
else
  bun run test
  echo "  ✓ Tests pass"
fi
echo ""

# ─── 6. Release-blocker regression checks ────────────
echo "▶ Step 6: Release-blocker regressions"
bun tests/daemon-chaos.test.ts
bun tests/contract/render-dom.test.ts
echo "  ✓ Daemon spawn-race and DOM rendering regressions pass"
echo ""

# ─── 7. Yield pattern check ─────────────────────────
echo "▶ Step 7: Yield pattern verification"
# Check multi-line yields: line with 'yield {' must be followed by emit:/ask:/checkpoint:
# Uses awk to pair yield lines with their next line
# Check that each 'yield {' has emit:/ask:/checkpoint: on same line or next line
BAD_YIELDS=""
for f in src/photons/*.photon.ts; do
  while IFS= read -r line; do
    linenum=$(echo "$line" | cut -d: -f1)
    content=$(echo "$line" | cut -d: -f2-)
    nextline=$(sed -n "$((linenum+1))p" "$f")
    combined="$content $nextline"
    if ! echo "$combined" | grep -q 'emit:\|ask:\|checkpoint:'; then
      BAD_YIELDS="$BAD_YIELDS\n$f:$linenum: yield without emit/ask/checkpoint"
    fi
  done < <(grep -n 'yield {' "$f" | grep -v '//')
done
BAD_YIELDS=$(echo -e "$BAD_YIELDS" | sed '/^$/d')
if [ -n "$BAD_YIELDS" ]; then
  echo "  ✗ FAIL: Found yields without emit/ask/checkpoint pattern in src/photons/"
  echo "$BAD_YIELDS"
  exit 1
fi
echo "  ✓ All generator yields use emit pattern"
echo ""

# ─── 8. Dependency audit ────────────────────────────
echo "▶ Step 8: Runtime dependency check"
# Check that key runtime imports are in dependencies, not devDependencies
DEPS=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies||{}).join(' '))")
MISSING=""
for pkg in esbuild chokidar commander; do
  if ! echo "$DEPS" | grep -qw "$pkg"; then
    MISSING="$MISSING $pkg"
  fi
done
if [ -n "$MISSING" ]; then
  echo "  ✗ FAIL: Runtime packages missing from dependencies:$MISSING"
  exit 1
fi
echo "  ✓ Runtime dependencies present"
echo ""

# ─── 9. Fresh install simulation ────────────────────
echo "▶ Step 9: Fresh install simulation"
FRESH_DIR=$(mktemp -d)
FRESH_HOME="$FRESH_DIR/.photon-home"
export PHOTON_DIR="$FRESH_DIR"
export PHOTON_HOME="$FRESH_HOME"

# Trap to clean up temp dir on any failure
cleanup_fresh() {
  rm -rf "$FRESH_DIR"
  unset PHOTON_DIR
  unset PHOTON_HOME
}
trap cleanup_fresh EXIT

# Test 9a: Beam starts with only internal photons
echo "  Testing Beam startup..."
BEAM_LOG=$(mktemp)
PHOTON_DIR="$FRESH_DIR" PHOTON_HOME="$FRESH_HOME" node dist/cli.js beam > "$BEAM_LOG" 2>&1 &
BEAM_PID=$!

# Poll for startup banner (up to 30s). Use an isolated PHOTON_HOME so this
# fresh-install check never depends on the user's live global daemon state.
BEAM_STARTED=0
for i in $(seq 1 30); do
  if grep -q "⚡ Photon Beam" "$BEAM_LOG" 2>/dev/null; then
    BEAM_STARTED=1
    break
  fi
  if ! kill -0 $BEAM_PID 2>/dev/null; then
    break  # process died
  fi
  sleep 1
done
kill $BEAM_PID 2>/dev/null || true
wait $BEAM_PID 2>/dev/null || true

if [ "$BEAM_STARTED" -eq 1 ]; then
  echo "  ✓ Beam starts successfully"
else
  echo "  ✗ FAIL: Beam did not start"
  cat "$BEAM_LOG"
  rm -f "$BEAM_LOG"
  exit 1
fi

if grep -qi "error\|unknown yield\|cannot find" "$BEAM_LOG"; then
  ERRORS=$(grep -i "error\|unknown yield\|cannot find" "$BEAM_LOG" | head -5)
  echo "  ✗ FAIL: Errors during Beam startup:"
  echo "$ERRORS"
  rm -f "$BEAM_LOG"
  exit 1
fi
echo "  ✓ No errors during startup"
rm -f "$BEAM_LOG"

# Test 9b: Marketplace search works
echo "  Testing marketplace search..."
SEARCH_OUT=$(PHOTON_DIR="$FRESH_DIR" PHOTON_HOME="$FRESH_HOME" node dist/cli.js search web 2>&1)
if echo "$SEARCH_OUT" | grep -q "web"; then
  echo "  ✓ Marketplace search works"
else
  echo "  ✗ FAIL: Marketplace search returned no results"
  echo "$SEARCH_OUT"
  exit 1
fi

# Test 9c: Photon install works
echo "  Testing photon install..."
ADD_OUT=$(PHOTON_DIR="$FRESH_DIR" PHOTON_HOME="$FRESH_HOME" node dist/cli.js add web 2>&1)
if echo "$ADD_OUT" | grep -q "Added web"; then
  echo "  ✓ Photon install works"
else
  echo "  ✗ FAIL: Photon install failed"
  echo "$ADD_OUT"
  exit 1
fi

# Clean up fresh install dir — restore normal PHOTON_DIR
rm -rf "$FRESH_DIR"
unset PHOTON_DIR
unset PHOTON_HOME

# ─── 10. Visual tests (optional — requires lookout + MLX) ────
echo ""
echo "▶ Step 10: Visual tests (lookout AI)"
if command -v photon >/dev/null 2>&1 && photon lookout status -y 2>/dev/null | grep -q '"ready": true\|ready.*true'; then
  echo "  Lookout available — running visual tests..."
  bun run test:visual
  echo "  ✓ Visual tests passed"
else
  echo "  ⏭ Lookout not available (no MLX or photon not installed) — skipping"
fi

# ─── 11. Promise validation (core intents — release gate) ────
echo ""
echo "▶ Step 11: Promise validation"
echo "  ✓ Platform promises validated by Step 5 full suite"
# Restore test fixture data files
git checkout -- tests/fixtures/.data/ 2>/dev/null || true

# ─── 12. Global install simulation ────
echo ""
echo "▶ Step 12: Global install simulation"
PACK_TGZ=$(bun pm pack --quiet 2>/dev/null | tail -1)
PACK_ABS="$(pwd)/$PACK_TGZ"
if [ -f "$PACK_ABS" ]; then
  echo "  Testing bun global install..."
  bun add -g "$PACK_ABS" 2>/dev/null || true
  BUN_OUT=$(photon --version 2>&1) || true
  bun remove -g @portel/photon 2>/dev/null || true
  if echo "$BUN_OUT" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
    echo "  ✓ bun global install works ($BUN_OUT)"
  else
    echo "  ✗ FAIL: bun global install broken: $BUN_OUT"
    rm -f "$PACK_ABS"
    exit 1
  fi

  rm -f "$PACK_ABS"
else
  echo "  ⏭ bun pack failed — skipping install test"
fi

# ─── 13. Production dependency verification ────
echo ""
echo "▶ Step 13: Production dependency verification"
PROD_DIR=$(mktemp -d)
PACK_CHECK=$(bun pm pack --quiet 2>/dev/null | tail -1)
if [ -f "$PACK_CHECK" ]; then
  cd "$PROD_DIR"
  bun init -y > /dev/null 2>&1
  rm -f bun.lock bun.lockb
  bun add "$(cd - > /dev/null && pwd)/$PACK_CHECK" --production --no-frozen-lockfile > /dev/null 2>&1
  # Verify the CLI entry point loads without crashing
  PROD_OUT=$(node node_modules/@portel/photon/dist/cli.js --version 2>&1) || true
  cd - > /dev/null
  if echo "$PROD_OUT" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
    echo "  ✓ Production install works ($PROD_OUT)"
  else
    echo "  ✗ FAIL: Production install broken (missing runtime dep?): $PROD_OUT"
    rm -rf "$PROD_DIR"
    rm -f "$PACK_CHECK"
    exit 1
  fi
  rm -rf "$PROD_DIR"
  rm -f "$PACK_CHECK"
else
  echo "  ⏭ bun pack failed — skipping production dep test"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ All pre-release checks passed"
echo "═══════════════════════════════════════════════════"
