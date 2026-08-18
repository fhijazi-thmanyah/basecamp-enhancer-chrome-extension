#!/usr/bin/env bash
# Regenerate the Chrome Web Store screenshot of the settings popup (1280x800).
# Renders the REAL popup.html/popup.js in headless Chrome against a tiny chrome.*
# stub, so the shot always shows the shipped defaults (and, correctly, no
# flag-gated Claude Code row). Requires: Google Chrome, ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=docs/store-assets/screenshot-1-settings.png
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp popup.html popup.js "$TMP/" && mkdir -p "$TMP/vendor" && : > "$TMP/vendor/posthog.js"
python3 - "$TMP/popup.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
stub = """<script>
window.chrome = {
  storage: {
    sync:  { get: (d, cb) => cb(d && typeof d === "object" ? d : {}), set: () => {} },
    local: { get: (d, cb) => cb({}), set: () => {} },
  },
  runtime: { getManifest: () => ({ version: "0" }), id: "shot" },
  tabs: { query: (q, cb) => cb([]) },
};
</script>
"""
open(p, "w").write(s.replace('<script src="vendor/posthog.js"></script>',
                             stub + '<script src="vendor/posthog.js"></script>'))
PY

"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=320,420 --virtual-time-budget=3000 \
  --screenshot="$TMP/popup.png" "file://$TMP/popup.html" >/dev/null 2>&1

magick "$TMP/popup.png" -crop 640x775+0+0 +repage -resize x620 \
  \( +clone -alpha extract -draw 'fill black polygon 0,0 0,12 12,0 fill white circle 12,12 12,0' \
     \( +clone -flip \) -compose Multiply -composite \( +clone -flop \) -compose Multiply -composite \) \
  -alpha off -compose CopyOpacity -composite "$TMP/round.png"

mkdir -p docs/store-assets
magick -size 1280x800 xc:'#f5f3ef' \
  \( "$TMP/round.png" \( +clone -background black -shadow 40x14+0+8 \) +swap -background none -layers merge +repage \) \
  -gravity East -geometry +120+0 -composite \
  -font Helvetica-Bold -pointsize 46 -fill '#1c1c1c' -gravity NorthWest -annotate +90+240 'Six Basecamp fixes,' \
  -font Helvetica-Bold -pointsize 46 -annotate +90+296 'each its own toggle' \
  -font Helvetica -pointsize 23 -fill '#5b5b5b' -annotate +90+372 'Relative timestamps · Arabic RTL' \
  -font Helvetica -pointsize 23 -annotate +90+406 'One-click reactions · hover action bar' \
  -font Helvetica -pointsize 23 -annotate +90+440 'Font picker · analytics opt-out' \
  -font Helvetica -pointsize 19 -fill '#8a8a8a' -annotate +90+510 'Turn everything off and Basecamp' \
  -font Helvetica -pointsize 19 -annotate +90+538 'is exactly as it was.' \
  "$OUT"
echo "wrote $OUT ($(magick identify -format '%wx%h' "$OUT"))"
