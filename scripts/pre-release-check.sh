#!/bin/bash
# Pre-release verification script
# Runs automatically before release-it to catch fresh-install issues
# Exit on any failure
set -e

echo "═══════════════════════════════════════════════════"
echo "  Pre-Release Verification"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── 1. Build verification ───────────────────────────
echo "▶ Step 1: Full build"
npm run build
npm run build:beam
echo "  ✓ Build passes"
echo ""

# ─── 2. Test suite ───────────────────────────────────
echo "▶ Step 2: Test suite"
npm test
echo "  ✓ Tests pass"
echo ""

# ─── 3. Yield pattern check ─────────────────────────
echo "▶ Step 3: Yield pattern verification"
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

# ─── 4. Dependency audit ────────────────────────────
echo "▶ Step 4: Runtime dependency check"
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

# ─── 5. Fresh install simulation ────────────────────
echo "▶ Step 5: Fresh install simulation"
BACKUP_DIR="$HOME/.photon-prerelease-backup-$$"
SIMULATED=false

if [ -d "$HOME/.photon" ]; then
  mv "$HOME/.photon" "$BACKUP_DIR"
  SIMULATED=true
fi

# Trap to restore on any failure
restore_photon() {
  if [ "$SIMULATED" = true ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf "$HOME/.photon"
    mv "$BACKUP_DIR" "$HOME/.photon"
  fi
}
trap restore_photon EXIT

# Test 5a: Beam starts with only internal photons
echo "  Testing Beam startup..."
BEAM_LOG=$(mktemp)
node dist/cli.js beam > "$BEAM_LOG" 2>&1 &
BEAM_PID=$!
sleep 6
kill $BEAM_PID 2>/dev/null || true
wait $BEAM_PID 2>/dev/null || true

if grep -q "photons ready" "$BEAM_LOG"; then
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

# Test 5b: Marketplace search works
echo "  Testing marketplace search..."
SEARCH_OUT=$(node dist/cli.js search web 2>&1)
if echo "$SEARCH_OUT" | grep -q "web"; then
  echo "  ✓ Marketplace search works"
else
  echo "  ✗ FAIL: Marketplace search returned no results"
  echo "$SEARCH_OUT"
  exit 1
fi

# Test 5c: Photon install works
echo "  Testing photon install..."
ADD_OUT=$(node dist/cli.js add web 2>&1)
if echo "$ADD_OUT" | grep -q "Added web"; then
  echo "  ✓ Photon install works"
else
  echo "  ✗ FAIL: Photon install failed"
  echo "$ADD_OUT"
  exit 1
fi

# Restore original .photon (trap handles this)
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ All pre-release checks passed"
echo "═══════════════════════════════════════════════════"
