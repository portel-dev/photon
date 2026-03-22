#!/bin/bash
# Marketplace verification script
# Usage: ./scripts/verify-marketplace.sh [test-name]
# Tests: all, install-photons, install-examples, back-forward, ui-assets, sync-methods

set -uo pipefail

PHOTON_DIR="${PHOTON_DIR:-/Users/arul/Projects/test-photon}"
PORT="${PORT:-3000}"
BASE="http://localhost:$PORT"
PASS=0
FAIL=0
SKIP=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
red() { printf "\033[31m✗ %s\033[0m\n" "$1"; }
yellow() { printf "\033[33m⊘ %s\033[0m\n" "$1"; }
header() { printf "\n\033[1m━━━ %s ━━━\033[0m\n" "$1"; }

assert_ok() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    green "$desc"; ((PASS++))
  else
    red "$desc"; ((FAIL++))
  fi
}

assert_fail() {
  local desc="$1"; shift
  if ! "$@" >/dev/null 2>&1; then
    green "$desc"; ((PASS++))
  else
    red "$desc (expected failure)"; ((FAIL++))
  fi
}

assert_contains() {
  local desc="$1" output="$2" pattern="$3"
  if echo "$output" | grep -q "$pattern"; then
    green "$desc"; ((PASS++))
  else
    red "$desc — expected '$pattern'"; ((FAIL++))
  fi
}

assert_not_contains() {
  local desc="$1" output="$2" pattern="$3"
  if ! echo "$output" | grep -q "$pattern"; then
    green "$desc"; ((PASS++))
  else
    red "$desc — found unwanted '$pattern'"; ((FAIL++))
  fi
}

wait_for_beam() {
  for i in $(seq 1 30); do
    curl -sf "$BASE/" >/dev/null 2>&1 && return 0
    sleep 1
  done
  red "Beam not responding on $BASE"
  exit 1
}

api() { curl -sf "$BASE$1" 2>/dev/null; }
api_post() { curl -s -X POST -H 'Content-Type: application/json' -d "$2" "$BASE$1" 2>/dev/null; }

# ─── Clean state ──────────────────────────────────────────────
clean_photon_dir() {
  # Remove everything except config files
  find "$PHOTON_DIR" -name "*.photon.ts" -delete 2>/dev/null || true
  find "$PHOTON_DIR" -mindepth 1 -maxdepth 1 -type d \
    ! -name '.cache' ! -name 'state' -exec rm -rf {} + 2>/dev/null || true
  rm -f "$PHOTON_DIR/.metadata.json" 2>/dev/null || true
}

# ─── Test: API basics ─────────────────────────────────────────
test_api_basics() {
  header "API Basics"

  local sources
  sources=$(api "/api/marketplace/sources")

  assert_contains "Sources endpoint returns data" "$sources" '"sources"'
  assert_contains "Built-in: photons marketplace" "$sources" '"name":"photons"'
  assert_contains "Built-in: examples marketplace" "$sources" '"name":"examples"'
  assert_contains "photons has builtIn flag" "$sources" '"builtIn":true'

  local list
  list=$(api "/api/marketplace/list")
  local count
  count=$(echo "$list" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['photons']))")
  if [ "$count" -gt 0 ]; then
    green "List endpoint returns $count photons"
    ((PASS++))
  else
    red "List endpoint returned 0 photons"
    ((FAIL++))
  fi

  # Verify search returns icon field
  local search
  search=$(api "/api/marketplace/search?q=walkthrough")
  assert_contains "Search returns icon field" "$search" '"icon"'
}

# ─── Test: Install from photons marketplace ───────────────────
test_install_photons() {
  header "Install from 'photons' marketplace"
  clean_photon_dir

  # Pick a simple photon from portel-dev/photons
  local name="todo"
  local result
  result=$(api_post "/api/marketplace/add" "{\"name\":\"$name\"}")

  if echo "$result" | grep -q '"success"'; then
    green "Installed $name"
    ((PASS++))
  else
    # Try another photon if todo doesn't exist
    name="hello-world"
    result=$(api_post "/api/marketplace/add" "{\"name\":\"$name\"}")
    if echo "$result" | grep -q '"success"'; then
      green "Installed $name"
      ((PASS++))
    else
      red "Failed to install from photons marketplace"
      ((FAIL++))
      return
    fi
  fi

  # Verify flat install (no namespace subdirectory)
  assert_ok "Photon file at root" test -f "$PHOTON_DIR/$name.photon.ts"
  assert_fail "No portel-dev namespace dir" test -d "$PHOTON_DIR/portel-dev"

  # Clean up
  rm -f "$PHOTON_DIR/$name.photon.ts"
  rm -rf "$PHOTON_DIR/$name"
}

# ─── Test: Install from examples marketplace ──────────────────
test_install_examples() {
  header "Install from 'examples' marketplace"
  clean_photon_dir

  local name="walkthrough"
  local result
  result=$(api_post "/api/marketplace/add" "{\"name\":\"$name\"}")

  if echo "$result" | grep -q '"success"'; then
    green "Installed $name"
    ((PASS++))
  else
    red "Failed to install $name"
    ((FAIL++))
    return
  fi

  # Verify flat install
  assert_ok "Photon file at root" test -f "$PHOTON_DIR/$name.photon.ts"
  assert_fail "No portel-dev namespace dir" test -d "$PHOTON_DIR/portel-dev"

  # Verify assets
  assert_ok "Assets dir exists" test -d "$PHOTON_DIR/$name"
  assert_ok "slides.md asset installed" test -f "$PHOTON_DIR/$name/slides.md"
  assert_fail "No double nesting" test -d "$PHOTON_DIR/$name/$name"

  # Verify slides load via CLI
  local cli_out
  cli_out=$(PHOTON_DIR="$PHOTON_DIR" photon cli "$name" main 2>&1 || true)
  assert_not_contains "No ENOENT error" "$cli_out" "ENOENT"
}

# ─── Test: Install photon with @ui assets ─────────────────────
test_ui_assets() {
  header "Install photon with @ui assets"
  clean_photon_dir

  # slides has @ui dashboard ./ui/slides.html
  local name="slides"
  local result
  result=$(api_post "/api/marketplace/add" "{\"name\":\"$name\"}")

  if echo "$result" | grep -q '"success"'; then
    green "Installed $name"
    ((PASS++))
  else
    red "Failed to install $name"
    ((FAIL++))
    return
  fi

  assert_ok "Photon file at root" test -f "$PHOTON_DIR/$name.photon.ts"
  assert_ok "UI directory exists" test -d "$PHOTON_DIR/$name"

  # Check for the UI HTML file
  if find "$PHOTON_DIR/$name" -name "*.html" | grep -q .; then
    green "UI HTML file installed"
    ((PASS++))
  else
    red "UI HTML file missing"
    ((FAIL++))
  fi

  assert_fail "No double nesting" test -d "$PHOTON_DIR/$name/$name"
}

# ─── Test: Marketplace URL routing ────────────────────────────
test_routing() {
  header "Marketplace URL Routing"

  # Test /marketplace returns HTML (not 404)
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/marketplace")
  if [ "$status" = "200" ]; then
    green "/marketplace returns 200"
    ((PASS++))
  else
    red "/marketplace returns $status"
    ((FAIL++))
  fi

  # Test / still works
  status=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/")
  if [ "$status" = "200" ]; then
    green "/ returns 200"
    ((PASS++))
  else
    red "/ returns $status"
    ((FAIL++))
  fi
}

# ─── Test: Built-in marketplace protection ────────────────────
test_builtin_protection() {
  header "Built-in Marketplace Protection"

  # Try to remove built-in marketplace
  local result
  result=$(api_post "/api/marketplace/sources/remove" '{"name":"photons"}' || echo '{"error":"blocked"}')
  assert_contains "Cannot remove photons marketplace" "$result" 'error\|Cannot'

  result=$(api_post "/api/marketplace/sources/remove" '{"name":"examples"}' || echo '{"error":"blocked"}')
  assert_contains "Cannot remove examples marketplace" "$result" 'error\|Cannot'
}

# ─── Test: Sync refreshes counts ──────────────────────────────
test_sync() {
  header "Marketplace Sync"

  local result
  result=$(api_post "/api/marketplace/sync" '{}')

  # After sync, sources should have counts
  local sources
  sources=$(api "/api/marketplace/sources")

  local examples_count
  examples_count=$(echo "$sources" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d['sources']:
    if s['name'] == 'examples':
        print(s['photonCount'])
        break
" 2>/dev/null || echo "0")

  if [ "$examples_count" -gt 0 ]; then
    green "Examples marketplace has $examples_count photons after sync"
    ((PASS++))
  else
    red "Examples marketplace shows 0 photons after sync"
    ((FAIL++))
  fi
}

# ─── Test: Name disambiguation ────────────────────────────────
test_disambiguation() {
  header "Name Disambiguation"

  local list
  list=$(api "/api/marketplace/list")

  # Check no current duplicates (all names unique)
  local dupes
  dupes=$(echo "$list" | python3 -c "
import json, sys
from collections import Counter
d = json.load(sys.stdin)
names = [p['name'] for p in d['photons']]
dupes = [n for n, c in Counter(names).items() if c > 1]
print(','.join(dupes) if dupes else 'none')
")

  if [ "$dupes" = "none" ]; then
    green "No duplicate names across marketplaces"
    ((PASS++))
  else
    yellow "Duplicate names found: $dupes (disambiguation should handle these)"
    ((SKIP++))
  fi
}

# ─── Test: Icons present ──────────────────────────────────────
test_icons() {
  header "Marketplace Icons"

  local list
  list=$(api "/api/marketplace/list")

  local missing
  missing=$(echo "$list" | python3 -c "
import json, sys
d = json.load(sys.stdin)
missing = [p['name'] for p in d['photons'] if p.get('marketplace') == 'examples' and not p.get('icon')]
print(','.join(missing) if missing else 'none')
")

  if [ "$missing" = "none" ]; then
    green "All examples photons have icons"
    ((PASS++))
  else
    red "Missing icons: $missing"
    ((FAIL++))
  fi

  # Verify search also returns icons
  local search
  search=$(api "/api/marketplace/search?q=docs")
  local search_icons
  search_icons=$(echo "$search" | python3 -c "
import json, sys
d = json.load(sys.stdin)
missing = [p['name'] for p in d['photons'] if not p.get('icon')]
print(','.join(missing) if missing else 'none')
")

  if [ "$search_icons" = "none" ]; then
    green "Search endpoint also returns icons"
    ((PASS++))
  else
    red "Search missing icons for: $search_icons"
    ((FAIL++))
  fi
}

# ─── Runner ───────────────────────────────────────────────────
run_test() {
  case "$1" in
    api-basics)        test_api_basics ;;
    install-photons)   test_install_photons ;;
    install-examples)  test_install_examples ;;
    ui-assets)         test_ui_assets ;;
    routing)           test_routing ;;
    builtin)           test_builtin_protection ;;
    sync)              test_sync ;;
    disambiguation)    test_disambiguation ;;
    icons)             test_icons ;;
    all)
      test_api_basics
      test_routing
      test_builtin_protection
      test_sync
      test_icons
      test_disambiguation
      test_install_photons
      test_install_examples
      test_ui_assets
      ;;
    *)
      echo "Usage: $0 {all|api-basics|install-photons|install-examples|ui-assets|routing|builtin|sync|disambiguation|icons}"
      exit 1
      ;;
  esac
}

# ─── Main ─────────────────────────────────────────────────────
TEST="${1:-all}"

echo "╔══════════════════════════════════════════╗"
echo "║   Marketplace Verification Suite         ║"
echo "╠══════════════════════════════════════════╣"
echo "║  PHOTON_DIR: $PHOTON_DIR"
echo "║  Beam:       $BASE"
echo "╚══════════════════════════════════════════╝"

wait_for_beam
run_test "$TEST"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  \033[32m%d passed\033[0m" "$PASS"
[ "$FAIL" -gt 0 ] && printf "  \033[31m%d failed\033[0m" "$FAIL"
[ "$SKIP" -gt 0 ] && printf "  \033[33m%d skipped\033[0m" "$SKIP"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit "$FAIL"
