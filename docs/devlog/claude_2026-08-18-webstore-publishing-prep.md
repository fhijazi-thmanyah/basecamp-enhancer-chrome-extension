# 2026-08-18 — Chrome Web Store publishing prep (v1.21.1)

Task: "set this up and get it ready for chrome webstore publishing." The extension
was already publishable in spirit (Unlisted item, working code) but three things
would have bitten at upload or review, and the non-code half of a submission had
never been written down.

## What was actually broken

1. **`manifest.description` was 180 chars.** The store's hard limit is 132 — the
   upload is rejected outright. It had been 180 since v1.16.7 (eight versions), so
   either nothing was uploaded in that window or the uploads failed silently to a
   human. Rewritten to 119 chars.
2. **The `cc-launcher` publish gate was half-broken.** `#ccRow` is hidden with the
   HTML `hidden` attribute, but `.row { display: flex }` on the same element beats
   the UA stylesheet's `[hidden] { display: none }`. So **every** published install
   showed a "Claude Code launcher" toggle that flips a setting with no visible
   effect (the content-script half of the gate worked correctly). Fixed with an
   explicit `[hidden] { display: none !important; }` in `popup.html`. Caught by
   rendering the popup, not by reading it — see the screenshot script below.
3. **No privacy policy.** The extension identifies users by their Basecamp email
   and records **session replays of Basecamp pages** by default. That mandates a
   privacy-policy URL and a full set of data disclosures in the dashboard; neither
   existed.

## What was added

- `scripts/build.sh` — the single build path. Parses every JS file, runs
  `tests/*_test.mjs`, enforces the store's name/description limits, checks every
  manifest-referenced path exists, writes `dist/basecamp-enhancer-<version>.zip`
  and asserts the manifest sits at the zip root. `--check` validates without
  zipping. (Gotcha found while writing it: `unzip -l … | grep -q` trips `set -o
  pipefail` when grep exits first and unzip takes a SIGPIPE — read the listing into
  a variable instead.)
- `scripts/screenshot-popup.sh` — renders the real `popup.html`/`popup.js` in
  headless Chrome against a five-line `chrome.*` stub and composites a 1280×800
  store screenshot into `docs/store-assets/`. Using the real popup is the point:
  it is what surfaced bug 2.
- `docs/PRIVACY.md` — the policy the listing links to. Enumerates exactly what
  PostHog receives (identity, autocapture, replay, custom events, IP/UA), where it
  goes (`posthog.fhijazi.com` → PostHog US Cloud), what is stored locally and never
  sent, and the one-click opt-out. Must be updated in the same commit as any
  telemetry change.
- `docs/store-listing.md` — every dashboard field ready to paste: listing copy,
  single purpose, a justification per permission (including the honest one for the
  localhost host permission), the data-disclosure checkboxes, the three
  certifications, review-risk notes, release checklist.
- `manifest.json` → **1.21.1**.

Verified: `./scripts/build.sh` green, and `Google Chrome --pack-extension` accepts
the unzipped package (it refuses an invalid manifest).

## Left for a human

- **Feature screenshots.** Only the settings-popup shot is generated. Screenshots
  showing RTL / the hover bar need real Basecamp content, and the frames in
  `docs/media/*.gif` contain a colleague's name, face, message text and an internal
  repo URL — not uploadable. Needs either a scratch Basecamp project or a decision
  to ship with the one popup screenshot.
- **Uploading.** The dashboard is a manual, signed-in flow; the zip and every field
  it asks for are ready.
