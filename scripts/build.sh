#!/usr/bin/env bash
# Validate the extension and build the Chrome Web Store upload zip.
# Usage: ./scripts/build.sh            (build dist/basecamp-enhancer-<version>.zip)
#        ./scripts/build.sh --check    (validate only, no zip)
set -euo pipefail
cd "$(dirname "$0")/.."

# Runtime files only — manifest at the root of the zip. Anything not listed here
# (README/CLAUDE.md/icon.png/docs/tests/scripts) stays out of the upload.
FILES=(manifest.json content.js background.js popup.html popup.js styles.css icons fonts vendor)

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok  $*"; }

echo "== syntax =="
for f in content.js background.js popup.js vendor/posthog.js; do
  node --check "$f" >/dev/null || fail "$f does not parse"
  ok "$f"
done

echo "== tests =="
for t in tests/*_test.mjs; do node "$t" || fail "$t"; done

echo "== manifest =="
VERSION=$(python3 - <<'PY'
import json, os, sys
m = json.load(open("manifest.json"))
def bad(msg): print("FAIL: " + msg, file=sys.stderr); sys.exit(1)

# Chrome Web Store hard limits (the upload is rejected past these).
if len(m["name"]) > 45: bad(f'name is {len(m["name"])} chars, max 45')
if len(m["description"]) > 132: bad(f'description is {len(m["description"])} chars, max 132')
if m["manifest_version"] != 3: bad("manifest_version must be 3")

# Every path the manifest names must exist in the tree.
refs = list(m["icons"].values()) + list(m["action"]["default_icon"].values()) + [m["action"]["default_popup"], m["background"]["service_worker"]]
for cs in m["content_scripts"]: refs += cs.get("js", []) + cs.get("css", [])
for war in m["web_accessible_resources"]:
    refs += [r for r in war["resources"] if "*" not in r]
for r in refs:
    if not os.path.exists(r): bad(f"manifest references missing file: {r}")
print(m["version"])
PY
) || exit 1
ok "name/description within store limits, all referenced files present"
echo "  version $VERSION"

[[ "${1:-}" == "--check" ]] && { echo "checks passed (no zip built)"; exit 0; }

echo "== zip =="
mkdir -p dist
OUT="dist/basecamp-enhancer-$VERSION.zip"
rm -f "$OUT"
zip -qr "$OUT" "${FILES[@]}" -x '*.DS_Store'
# The store rejects a zip whose manifest is not at the root. (Read the listing
# into a variable first: `unzip | grep -q` can trip `pipefail` when grep exits
# early and unzip takes a SIGPIPE.)
LIST=$(unzip -Z1 "$OUT")
grep -qx 'manifest.json' <<<"$LIST" || fail "manifest.json is not at the zip root"
ok "$OUT ($(du -h "$OUT" | cut -f1), $(wc -l <<<"$LIST" | tr -d ' ') entries)"
echo
echo "Upload $OUT at https://chrome.google.com/webstore/devconsole"
echo "Listing copy + permission justifications: docs/store-listing.md"
