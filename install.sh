#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
destination=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/titlewave
if [ -e "$destination" ] || [ -L "$destination" ]; then
  echo "Already exists: $destination. Remove it explicitly before reinstalling." >&2
  exit 1
fi
mkdir -p "$(dirname "$destination")"
ln -s "$root/skills/titlewave" "$destination"
printf 'Linked %s. Prefer the marketplace package for managed updates.\n' "$destination"
