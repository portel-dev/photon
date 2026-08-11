#!/bin/sh
# Execute a TypeScript test with either supported project runtime.
# Bun runs TypeScript natively; Node uses the project's tsx loader.
set -eu

if command -v bun >/dev/null 2>&1; then
  exec bun "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node --import tsx "$@"
fi

echo "A JavaScript runtime is required: install Bun or Node.js." >&2
exit 1
