#!/bin/bash
# Link the local photon repo as the global `photon` command, and symlink
# the sibling photon-core repo into node_modules so edits in either
# project flow through to the global binary without an npm publish.
#
# Run this after switching repos, after a fresh clone, or any time the
# global `photon` is suspected of running stale code.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Clearing npx cached @portel/photon..."
count=0
for d in "$HOME/.npm/_npx"/*/; do
  if [ -f "$d/node_modules/@portel/photon/package.json" ]; then
    rm -rf "$d"
    count=$((count + 1))
  fi
done
echo "    Removed $count npx cache dir(s)"

echo "==> Clearing bunx cached @portel/photon..."
bun_count=0
while IFS= read -r pkg; do
  [ -n "$pkg" ] && rm -rf "$pkg" && bun_count=$((bun_count + 1))
done < <(find "$HOME/.bun" -path "*/@portel/photon/package.json" -exec dirname {} \; 2>/dev/null)
echo "    Removed $bun_count bun cache dir(s)"

echo "==> Symlinking @portel/photon-core to ../photon-core..."
# When both repos are checked out side-by-side, edits to photon-core
# should reach photon's build without a publish. Skip silently if the
# sibling isn't there (CI, isolated checkouts).
CORE_REPO="$(cd "$REPO_DIR/.." && pwd)/photon-core"
CORE_LINK="$REPO_DIR/node_modules/@portel/photon-core"
if [ -d "$CORE_REPO" ]; then
  if [ -L "$CORE_LINK" ] && [ "$(readlink "$CORE_LINK")" = "$CORE_REPO" ]; then
    echo "    Already symlinked → $CORE_REPO"
  else
    rm -rf "$CORE_LINK"
    mkdir -p "$(dirname "$CORE_LINK")"
    ln -s "$CORE_REPO" "$CORE_LINK"
    echo "    Linked → $CORE_REPO"
  fi
else
  echo "    Skipped — sibling photon-core repo not found at $CORE_REPO"
fi

echo "==> Building local photon..."
cd "$REPO_DIR"
npm run build

echo "==> npm link (global)..."
npm link

echo "==> Killing any running daemons spawned by an older binary..."
# A daemon spawned by the previous global install may still own the
# socket; without this kill the next `photon` invocation hands off to
# that stale daemon and silently misses every new RPC.
pkill -f 'dist/daemon/server.js' 2>/dev/null || true
sleep 1

echo ""
echo "Done. 'photon' now points to the local repo:"
which photon
photon --version 2>/dev/null || true
