#!/usr/bin/env bash
# Sync the extension's runtime files into the Safari Xcode project and build it.
# The Safari app wraps the SAME files Chrome ships — safari/…/Resources is a
# copy, and this script is the only thing that should write it.
#
# Usage: ./scripts/build-safari.sh           (sync + ad-hoc Release build)
#        ./scripts/build-safari.sh --sync    (sync resources only, no xcodebuild)
#
# The ad-hoc build produces an app whose extension Safari will only load with
# Develop → Developer → "Allow unsigned extensions" enabled. For a distributable
# build, open safari/"Basecamp Enhancer"/"Basecamp Enhancer.xcodeproj" in Xcode
# and archive with a real team (see docs/store-listing.md → Safari section).
set -euo pipefail
cd "$(dirname "$0")/.."

# Same runtime file list as build.sh — keep the two in sync.
FILES=(manifest.json content.js background.js popup.html popup.js styles.css icons fonts vendor)

RES="safari/Basecamp Enhancer/Basecamp Enhancer Extension/Resources"
[ -d "$RES" ] || { echo "FAIL: $RES missing — regenerate with xcrun safari-web-extension-converter" >&2; exit 1; }

./scripts/build.sh --check

echo "== sync -> $RES =="
rsync -a --delete --exclude .DS_Store "${FILES[@]}" "$RES/"
echo "  ok  $(cd "$RES" && ls | tr '\n' ' ')"

[ "${1:-}" = "--sync" ] && exit 0

echo "== xcodebuild (ad-hoc) =="
cd "safari/Basecamp Enhancer"
xcodebuild -project "Basecamp Enhancer.xcodeproj" -scheme "Basecamp Enhancer" \
  -configuration Release \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" DEVELOPMENT_TEAM="" \
  -derivedDataPath build build | grep -E "BUILD (SUCCEEDED|FAILED)"
APP="build/Build/Products/Release/Basecamp Enhancer.app"
[ -d "$APP" ] && echo "app: safari/Basecamp Enhancer/$APP"
