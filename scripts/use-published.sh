#!/bin/bash
# Remove the Bun link so bunx will fetch the published version again.
# Also tears down the photon-core sibling symlink so the next install
# pulls a real copy from the registry.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Removing bun global link for @portel/photon..."
(cd "$REPO_DIR" && bun unlink) 2>/dev/null || bun remove -g @portel/photon 2>/dev/null || true

echo "==> Removing @portel/photon-core sibling symlink (if any)..."
CORE_LINK="$REPO_DIR/node_modules/@portel/photon-core"
if [ -L "$CORE_LINK" ]; then
  rm -f "$CORE_LINK"
  echo "    Removed — run 'bun install' to restore the registry copy."
else
  echo "    Not a symlink, leaving in place."
fi

echo "==> Killing any running photon daemon (it may be linked-build)..."
pkill -f 'dist/daemon/server.js' 2>/dev/null || true
sleep 1

# Also clear stale npx/bunx caches so the next run fetches fresh
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

echo ""
echo "Done. bun link removed. Next 'bunx @portel/photon' will fetch from the registry."

# Verify it's gone
if which photon &>/dev/null; then
  echo "Warning: 'photon' still resolves to $(which photon)"
else
  echo "'photon' command no longer in PATH (expected)."
fi
