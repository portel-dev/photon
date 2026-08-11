#!/bin/sh
# Run a package script with either Bun or Node/npm.
set -eu

if command -v bun >/dev/null 2>&1; then
  exec bun run "$@"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm run "$@"
fi

echo "A package runner is required: install Bun or Node.js/npm." >&2
exit 1
