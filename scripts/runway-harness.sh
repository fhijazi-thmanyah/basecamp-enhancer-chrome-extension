#!/usr/bin/env bash
# Headless DOM test for the suggested-replies feature: renders the REAL
# content.js + styles.css on a mock Basecamp message page (tests/harness/)
# against a chrome.* stub that plays HQ, clicks Edit/Revise/Send/Reject, and
# prints the assertions the page wrote. `--shot out.png` also saves a
# screenshot with the runway panel open. Needs google-chrome + python3.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHROME=${CHROME:-google-chrome}
PORT=${PORT:-8765}
WWW=$(mktemp -d)
trap 'kill "$SRV" 2>/dev/null; rm -rf "$WWW"' EXIT
mkdir -p "$WWW/4149173/buckets/1/messages/222"
ln -s "$ROOT" "$WWW/ext"
cp "$ROOT/tests/harness/stub.js" "$WWW/stub.js"
cp "$ROOT/tests/harness/runway.html" "$WWW/4149173/buckets/1/messages/222/index.html"
python3 -m http.server "$PORT" --directory "$WWW" >/dev/null 2>&1 & SRV=$!
sleep 1
URL="http://localhost:$PORT/4149173/buckets/1/messages/222/"
OUT=$("$CHROME" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=8000 --dump-dom "$URL" 2>/dev/null \
  | sed -n '/<pre id="out">/,/<\/pre>/p')
echo "$OUT"
if [ "${1:-}" = "--shot" ]; then
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1400,950 \
    --virtual-time-budget=8000 --screenshot="$(realpath -m "$2")" "$URL#shot" 2>/dev/null
fi
grep -q "DONE=true" <<<"$OUT" || { echo "FAIL: harness did not finish"; exit 1; }
