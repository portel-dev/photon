#!/bin/bash
# Link the local photon repo as the global `photon` command.
# Removes any npx/bunx cached copies first so they don't shadow the link.
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

echo "==> Building local photon..."
cd "$REPO_DIR"
npm run build

echo "==> npm link (global)..."
npm link

echo ""
echo "Done. 'photon' now points to the local repo:"
which photon
photon --version 2>/dev/null || true
