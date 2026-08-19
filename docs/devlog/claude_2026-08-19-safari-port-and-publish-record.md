# 2026-08-19 — Chrome Web Store accepted; publish record + Safari port (v1.22.0)

The Chrome Web Store submission (v1.21.1, Unlisted) was **accepted and is live**.
Task: "save the keys so we don't lose it, and publish to Safari."

## The "keys" — what actually exists

There is **no local signing key**. The store upload was a ZIP, so Google generated
and holds the CRX signing key — nothing on disk to back up (verified: no `.pem`
anywhere in the repo or sibling dirs). What CAN be lost is the **item ID**, the
**unlisted install link**, and the **publisher Google account**. None of those were
recorded anywhere (searched all three Gmail accounts via gws — no acceptance email;
the store copy isn't installed in any local Chrome profile, so no ID/`key` to lift
from Preferences). Created `docs/store-listing.md` → **§6 Published item record**
with TODO slots only Faris can fill from the devconsole (which /chrome cannot
script — see memory `chrome-webstore-devconsole-unscriptable`). §6 also documents
how to pin dev builds to the store ID via the CRX `"key"` once the item ID is known.

## Safari port

`safari/` = Xcode project from `xcrun safari-web-extension-converter` (Swift,
macOS-only, `--copy-resources` from the clean build.sh package, `--no-open`).
Verified end-to-end: ad-hoc Release build succeeds, appex registers with Safari
(`pluginkit -m -p com.apple.Safari.web-extension` shows
`com.farishijazi.basecamp-enhancer.Extension`).

Three things needed fixing:

1. **Bundle-ID mangling.** The converter derives the *app* ID from `--app-name`
   (→ `com.farishijazi.Basecamp-Enhancer`) while the appex uses the passed
   `--bundle-identifier` — so the appex ID didn't prefix the app ID and
   `ValidateEmbeddedBinary` failed. sed-fixed the pbxproj to
   `com.farishijazi.basecamp-enhancer` (+ `.Extension`).
2. **Deployment target.** Xcode 26 generated `MACOSX_DEPLOYMENT_TARGET = 26.3`
   (current-OS only). Lowered to **13.3** = Safari 16.4, the floor for MV3
   background service workers; still builds.
3. **Fonts were genuinely Chrome-only** — `styles.css` hardcoded
   `chrome-extension://__MSG_@@extension_id__/fonts/…` in `@font-face` src.
   Safari's scheme is `safari-web-extension://` and it doesn't substitute
   `__MSG_@@extension_id__` in content-script CSS. Fix (works identically in
   Chrome, one codebase): `ensureFontFaces()` in content.js injects a
   `<style id="bce-fontfaces">` built from `chrome.runtime.getURL("fonts/…")`
   on first `applyFont()`; the `@font-face` block is gone from styles.css.
   Laziness preserved (faces only fetch when a rule uses the family), idempotent
   via the id guard, re-created by `reconcile()` if a Turbo head-merge drops it.

Everything else needed no change: Safari exposes the `chrome.*` namespace, and
every API we use (`storage.sync`/`local`/`onChanged`, `runtime.getURL`/
`sendMessage`/`onMessage`, action popup, `web_accessible_resources`) is
supported. `storage.sync` is local-backed in Safari (no cross-device sync) —
acceptable.

- `scripts/build-safari.sh` — the only writer of
  `safari/…/Extension/Resources/` (copy of the runtime files): runs
  `build.sh --check`, rsyncs the same `FILES` list, ad-hoc `xcodebuild`.
- `manifest.json` → **1.22.0** (font-loading change ⇒ next Chrome upload needs
  a bump anyway).
- `.gitignore` — safari build products + `xcuserdata/`.

## Verified / not yet verified

- `./scripts/build.sh --check` green (parses, ccprompt tests pass) and
  `./scripts/build-safari.sh` green end-to-end.
- **Not yet visually verified** (needs Faris): fonts in Chrome after the
  refactor (requires reloading the unpacked extension at `chrome://extensions`),
  and the extension running in Safari (requires the *Allow unsigned extensions*
  toggle — a human-only Safari setting). Both are the first things to check.

## Left for Faris

1. Paste item ID + unlisted link + publisher account into
   `docs/store-listing.md` §6.
2. Reload the unpacked extension, confirm the font picker still works in Chrome.
3. Safari: Develop → Developer → Allow unsigned extensions → enable the
   extension → check Basecamp.
4. Decide Safari distribution: App Store vs notarized direct download — both
   need a paid Apple Developer membership (routes in `docs/store-listing.md` §7).
