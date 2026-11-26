#!/usr/bin/env bash
set -euo pipefail

# Xvfb provides a display; a window manager is also needed for focus/minimize/restore.
openbox > /tmp/kjmcl-openbox.log 2>&1 &
wm_pid=$!
trap 'kill "$wm_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in {1..50}; do
  if xprop -root _NET_SUPPORTING_WM_CHECK | grep -q 'window id'; then
    ready=true
    break
  fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then
  cat /tmp/kjmcl-openbox.log
  exit 1
fi
for test in welcome-desktop desktop resource-desktop save-desktop library-desktop upgrade-desktop lightweight-desktop folders-desktop mod-resources-desktop appearance-desktop assistant-desktop; do
  node "scripts/${test}-smoke.mjs"
done
