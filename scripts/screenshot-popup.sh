#!/usr/bin/env bash
# Regenerate the Chrome Web Store screenshots of the settings popup.
# Renders the REAL popup.html/popup.js in headless Chrome against a tiny chrome.*
# stub, so the shots always show the shipped defaults (and, correctly, no
# flag-gated Claude Code row). Requires: Google Chrome, ImageMagick.
#
# Store rules enforced below: 1280x800, JPEG or 24-bit PNG with NO alpha.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
BG='#f5f3ef'
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# $1 = output png, $2 = popup window height, $3 = crop height (2x px),
# $4 = crop top offset (2x px — crop into the panel to keep small text legible),
# $5 = "open" to expand the two <details> editors, then caption lines.
shot() {
  local out=$1 winh=$2 croph=$3 cropy=$4 details=$5; shift 5
  local dir="$TMP/$(basename "$out" .png)"
  mkdir -p "$dir/vendor" && cp popup.html popup.js "$dir/" && : > "$dir/vendor/posthog.js"
  DETAILS="$details" python3 - "$dir/popup.html" <<'PY'
import os, sys
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
s = s.replace('<script src="vendor/posthog.js"></script>', stub + '<script src="vendor/posthog.js"></script>')
if os.environ.get("DETAILS") == "open":
    s = s.replace("<details class=", "<details open class=")
open(p, "w").write(s)
PY
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=320,"$winh" --virtual-time-budget=3000 \
    --screenshot="$dir/popup.png" "file://$dir/popup.html" >/dev/null 2>&1

  # rounded corners, so the popup reads as a floating panel
  magick "$dir/popup.png" -crop "640x${croph}+0+${cropy}" +repage -resize x620 \
    \( +clone -alpha extract -draw 'fill black polygon 0,0 0,12 12,0 fill white circle 12,12 12,0' \
       \( +clone -flip \) -compose Multiply -composite \( +clone -flop \) -compose Multiply -composite \) \
    -alpha off -compose CopyOpacity -composite "$dir/round.png"

  local args=(-size 1280x800 "xc:$BG"
    \( "$dir/round.png" \( +clone -background black -shadow 40x14+0+8 \) +swap -background none -layers merge +repage \)
    -gravity East -geometry +120+0 -composite -gravity NorthWest)
  local y=240
  args+=(-font Helvetica-Bold -pointsize 46 -fill '#1c1c1c' -annotate "+90+$y" "$1"); shift; y=$((y + 56))
  args+=(-font Helvetica-Bold -pointsize 46 -annotate "+90+$y" "$1"); shift; y=$((y + 76))
  args+=(-font Helvetica -pointsize 23 -fill '#5b5b5b')
  for line in "$@"; do args+=(-annotate "+90+$y" "$line"); y=$((y + 34)); done
  # 24-bit, alpha stripped — the shadow compositing leaves 16-bit RGBA otherwise,
  # which the store rejects.
  args+=(-background "$BG" -alpha remove -alpha off -depth 8 -define png:color-type=2 "PNG24:$out")
  mkdir -p docs/store-assets
  magick "${args[@]}"

  # (the trailing \n matters: without it `read` hits EOF, returns 1 and `set -e`
  # kills the script before the checks run)
  read -r W H TYPE DEPTH CH < <(magick identify -format '%w %h %[type] %[depth] %[channels]\n' "$out")
  [[ "$W $H" == "1280 800" ]] || { echo "FAIL: $out is ${W}x${H}, must be 1280x800" >&2; exit 1; }
  [[ "$DEPTH" == "8" && "$CH" == srgb* ]] || { echo "FAIL: $out is $DEPTH-bit $CH, must be 24-bit with no alpha" >&2; exit 1; }
  echo "wrote $out (${W}x${H}, $TYPE ${DEPTH}-bit, $CH)"
}

shot docs/store-assets/screenshot-1-settings.png 420 775 0 closed \
  'Six Basecamp fixes,' 'each its own toggle' \
  'Relative timestamps · Arabic RTL' \
  'One-click reactions · hover action bar' \
  'Font picker · analytics opt-out'

shot docs/store-assets/screenshot-2-customize.png 700 790 490 open \
  'Your emoji,' 'your menu, your order' \
  'Pick the reaction set and the exact order it' \
  'renders in. Drag the action-menu items to' \
  'reorder, untick the ones you never use.'
