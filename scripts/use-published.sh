#!/bin/bash
# Remove the npm link so npx/bunx will fetch the published version again.
set -e

echo "==> Removing npm global link for @portel/photon..."
npm unlink -g @portel/photon 2>/dev/null || npm rm -g @portel/photon 2>/dev/null || true

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
echo "Done. npm link removed. Next 'npx @portel/photon' or 'bunx @portel/photon' will fetch from npm."

# Verify it's gone
if which photon &>/dev/null; then
  echo "Warning: 'photon' still resolves to $(which photon)"
else
  echo "'photon' command no longer in PATH (expected)."
fi
