#!/bin/bash
# Pre-release verification script
# Runs automatically before release-it to catch fresh-install issues
# Exit on any failure
set -e

echo "═══════════════════════════════════════════════════"
echo "  Pre-Release Verification"
echo "═══════════════════════════════════════════════════"
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

# ─── 1. Replace npm-linked packages with registry versions ──
echo "▶ Step 1: Resolve npm links"
LINKED=""
for dep in $(node -e "const p=require('./package.json'); console.log([...Object.keys(p.dependencies||{}), ...Object.keys(p.devDependencies||{})].join(' '))"); do
  target="node_modules/$dep"
  if [ -L "$target" ]; then
    version=$(node -e "const p=require('./package.json'); console.log((p.dependencies||{})['$dep'] || (p.devDependencies||{})['$dep'] || 'latest')")
    echo "  ⚠ $dep is npm-linked → reinstalling $version from registry"
    npm unlink "$dep" 2>/dev/null || true
    npm install "$dep@$version" --save 2>/dev/null
    LINKED="$LINKED $dep"
  fi
done
if [ -z "$LINKED" ]; then
  echo "  ✓ No npm-linked packages"
else
  echo "  ✓ Resolved:$LINKED"
  # Ensure lock file is clean for the release commit
  git checkout -- package-lock.json 2>/dev/null || true
  npm install
fi
echo ""

# ─── 2. Lockfile sync check (critical — `npm ci` in CI/Release workflows fails hard if out of sync) ──
echo "▶ Step 2: Lockfile sync"
if ! npm ci --dry-run >/dev/null 2>&1; then
  echo "  ✗ FAIL: package-lock.json is out of sync with package.json"
  echo "    CI and Release workflows will fail. Run 'npm install' and commit package-lock.json."
  npm ci --dry-run 2>&1 | grep -E "Invalid:" | head -3
  exit 1
fi
echo "  ✓ npm ci dry-run passes (package-lock.json in sync)"
echo ""

# ─── 3. Build verification ───────────────────────────
echo "▶ Step 3: Full build"
npm run build
npm run build:beam
echo "  ✓ Build passes"
echo ""

# ─── 3. Test suite ───────────────────────────────────
echo "▶ Step 4: Test suite"
npm test
echo "  ✓ Tests pass"
echo ""

# ─── 5. Yield pattern check ─────────────────────────
echo "▶ Step 5: Yield pattern verification"
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

# ─── 6. Dependency audit ────────────────────────────
echo "▶ Step 6: Runtime dependency check"
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

# ─── 7. Fresh install simulation ────────────────────
echo "▶ Step 7: Fresh install simulation"
FRESH_DIR=$(mktemp -d)
export PHOTON_DIR="$FRESH_DIR"

# Trap to clean up temp dir on any failure
cleanup_fresh() {
  rm -rf "$FRESH_DIR"
  unset PHOTON_DIR
}
trap cleanup_fresh EXIT

# Test 6a: Beam starts with only internal photons
echo "  Testing Beam startup..."
BEAM_LOG=$(mktemp)
PHOTON_DIR="$FRESH_DIR" node dist/cli.js beam > "$BEAM_LOG" 2>&1 &
BEAM_PID=$!
sleep 6
kill $BEAM_PID 2>/dev/null || true
wait $BEAM_PID 2>/dev/null || true

if grep -q "⚡ Photon Beam" "$BEAM_LOG"; then
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

# Test 6b: Marketplace search works
echo "  Testing marketplace search..."
SEARCH_OUT=$(PHOTON_DIR="$FRESH_DIR" node dist/cli.js search web 2>&1)
if echo "$SEARCH_OUT" | grep -q "web"; then
  echo "  ✓ Marketplace search works"
else
  echo "  ✗ FAIL: Marketplace search returned no results"
  echo "$SEARCH_OUT"
  exit 1
fi

# Test 6c: Photon install works
echo "  Testing photon install..."
ADD_OUT=$(PHOTON_DIR="$FRESH_DIR" node dist/cli.js add web 2>&1)
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

# ─── 8. Visual tests (optional — requires lookout + MLX) ────
echo ""
echo "▶ Step 8: Visual tests (lookout AI)"
if command -v photon >/dev/null 2>&1 && photon lookout status -y 2>/dev/null | grep -q '"ready": true\|ready.*true'; then
  echo "  Lookout available — running visual tests..."
  npm run test:visual
  echo "  ✓ Visual tests passed"
else
  echo "  ⏭ Lookout not available (no MLX or photon not installed) — skipping"
fi

# ─── 9. Promise validation (core intents — release gate) ────
echo ""
echo "▶ Step 9: Promise validation"
echo "  Running promise validation suite..."
npm run test:promises
echo "  ✓ Platform promises validated"
# Restore test fixture data files
git checkout -- tests/fixtures/.data/ 2>/dev/null || true

# ─── 10. Global install simulation ────
echo ""
echo "▶ Step 10: Global install simulation"
PACK_TGZ=$(npm pack 2>/dev/null | tail -1)
PACK_ABS="$(pwd)/$PACK_TGZ"
if [ -f "$PACK_ABS" ]; then
  # Test with bun if available
  if command -v bun >/dev/null 2>&1; then
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
  else
    echo "  ⏭ bun not available — skipping bun global test"
  fi

  # Test with npm/node if available
  if command -v node >/dev/null 2>&1; then
    echo "  Testing npm global install..."
    npm install -g "$PACK_ABS" 2>/dev/null || true
    NPM_OUT=$(photon --version 2>&1) || true
    npm uninstall -g @portel/photon 2>/dev/null || true
    if echo "$NPM_OUT" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
      echo "  ✓ npm global install works ($NPM_OUT)"
    else
      echo "  ✗ FAIL: npm global install broken: $NPM_OUT"
      rm -f "$PACK_ABS"
      exit 1
    fi
  else
    echo "  ⏭ node not available — skipping npm global test"
  fi

  rm -f "$PACK_ABS"
else
  echo "  ⏭ npm pack failed — skipping install test"
fi

# ─── 10. Production dependency verification ────
echo ""
echo "▶ Step 11: Production dependency verification"
PROD_DIR=$(mktemp -d)
PACK_CHECK=$(npm pack 2>/dev/null | tail -1)
if [ -f "$PACK_CHECK" ]; then
  cd "$PROD_DIR"
  npm init -y > /dev/null 2>&1
  npm install "$(cd - > /dev/null && pwd)/$PACK_CHECK" --production > /dev/null 2>&1
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
  echo "  ⏭ npm pack failed — skipping production dep test"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ All pre-release checks passed"
echo "═══════════════════════════════════════════════════"
