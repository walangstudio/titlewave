#!/usr/bin/env bash
# Claude Code statusline that shows the live session title set by /rename or lm-rename.sh.
#
# The open TUI's prompt-box header can't be repainted from outside a running session, so a
# script-driven rename is otherwise invisible until reopen. The statusline IS re-rendered from
# disk on a timer, so it's the one in-window surface that can reflect an external rename live.
# This reads the current title fresh on every render and prepends it in cyan: [my-title] ...
#
# settings.json ("statusLine"):
#   wrap an existing statusline:  {"type":"command","command":"/opt/apps/tools/scripts/cc-title-statusline.sh ccstatusline","refreshInterval":5}
#   standalone (no other line):   {"type":"command","command":"/opt/apps/tools/scripts/cc-title-statusline.sh","refreshInterval":5}
#
# Requires: jq. Args (optional) = your existing statusline command; its output is wrapped.
set -uo pipefail

input=$(cat)
q() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }

title=""
transcript=$(q '.transcript_path')
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  # match only real top-level custom-title records; fromjson? skips any non-JSON line
  title=$(jq -rR 'fromjson? | select(.type=="custom-title") | .customTitle // empty' "$transcript" 2>/dev/null | tail -n1)
fi

if [ "$#" -gt 0 ]; then
  body=$(printf '%s' "$input" | "$@")   # feed the same stdin JSON to the wrapped statusline
else
  model=$(q '.model.display_name')
  dir=$(q '.workspace.current_dir')
  body="${model:-Claude}"
  title_home=${HOME:-}
  if [ -n "$title_home" ]; then
    case $dir in
      "$title_home") dir='~' ;;
      "$title_home"/*) dir="~${dir#"$title_home"}" ;;
    esac
  fi
  [ -n "$dir" ] && body="$body · $dir"
fi

# Prepend [title] only if the wrapped statusline doesn't already render it itself
# (e.g. ccstatusline's Session widget). ANSI-strip the body first, then substring-match
# the title so we don't show the session name twice.
prefix=""
if [ -n "$title" ]; then
  body_plain=$(printf '%s' "$body" | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g')
  [[ "$body_plain" == *"$title"* ]] || prefix=$'\033[36m['"$title"$']\033[0m '
fi

printf '%s%s' "$prefix" "$body"
