#!/bin/bash
set -u
HTML="$1"; PNG="$2"; W="${3:-848}"; H="${4:-900}"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
rm -f "$PNG"
for i in 1 2 3 4; do
  "$EDGE" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --virtual-time-budget=6000 --window-size="${W},${H}" \
    --screenshot="$PNG" "file:///$HTML" >/dev/null 2>&1
  if [ -f "$PNG" ]; then echo "ok $PNG"; exit 0; fi
  sleep 1
done
echo "FAILED"; exit 1
