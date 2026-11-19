#!/usr/bin/env bash
set -euo pipefail
args=("${1:?usage: lm-rename.sh <name> [session-id]}" --agent claude)
if [ -n "${2:-}" ]; then args+=(--session "$2"); else args+=(--terminal); fi
if [ -n "${LM_RENAME_DRYRUN:-}" ]; then args+=(--dry-run); fi
exec node "$(dirname "$0")/bin/titlewave.mjs" "${args[@]}"
