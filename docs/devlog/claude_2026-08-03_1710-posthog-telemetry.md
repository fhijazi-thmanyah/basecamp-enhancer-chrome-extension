# 2026-08-03 — PostHog telemetry with opt-out (v1.17.0, `posthog-telemetry` branch)

User ask: "add posthog metrics with an ability to turn them off, they should
capture the user email + activity and page visits so that I can know when
errors happen" + "inject posthog SDK code into the bundle rather than
remotely loading" + "put this in a separate branch".

## Design

- **Bundled real SDK, no remote loading**: `vendor/posthog.js` is posthog-js's
  `dist/array.full.no-external.js` build — every lazy dependency inlined, the
  build PostHog documents for exactly this (environments where CDN loading is
  forbidden, like MV3). Listed before `content.js` in the manifest (shared
  isolated-world global) and loaded by `popup.html`. First iteration was a
  hand-rolled HTTP `/capture/` client through background.js; replaced on the
  user's ask — the SDK adds sessions, autocapture activity, history-change SPA
  pageviews (Turbo uses pushState), batching/retries.
- **Two gates**:
  1. `PH_KEY` (mirrored in content.js + popup.js) — **shipped EMPTY, the SDK
     never initializes until the `phc_…` project key is pasted in** (client-
     side keys, publishable; safe in the public repo).
  2. Popup toggle "Usage analytics" (`settings.telemetry`, default on) —
     honest label ("tied to your Basecamp email"), README privacy note in
     Arabic. `phApply()` opts the SDK in/out live; with `/decide` disabled
     (`advanced_disable_decide`), opted-out ⇒ zero requests. Guard opt_in
     behind `has_opted_out_capturing()` — unconditional `opt_in_capturing()`
     fires its own event every call.
- **Branching**: all of this lives on `posthog-telemetry` (master stayed at
  v1.16.7); merge to master when the key is in and it's verified live.
- **Identity** (`phIdentity`): person id from `meta[current-person-id]`;
  email + name regexed from ONE same-origin fetch of the user's own
  `/my/profile` page (they're not in the page DOM), cached in
  `chrome.storage.local.bceWho`; then `posthog.identify(email || "bc:"+id)`
  with email/name/person-id person props.
- **Events**: `$pageview` + autocapture (SDK, `capture_pageview:
  "history_change"`), `reaction_sent`, `cc_launch` / `cc_launch_result`,
  `setting_changed` (sent by **popup.js**, the single settings writer —
  capturing in content.js's `onChanged` would duplicate per open tab; arrays
  as counts), `extension_error` (window `error` + `unhandledrejection`
  filtered to stacks containing our `chrome-extension://` URL, plus
  sendBoost's catch). Session recording off; `/decide` disabled.

## Verified

- `node --check` on content.js/popup.js/background.js (background is back to
  HQ-only — the SDK made its phCapture relay unnecessary).
- Live POST to `https://us.i.posthog.com/capture/` with our event shape:
  `200 {"status":"Ok"}`. PostHog returns 200 even for an invalid key (silent
  drop) — a wrong key can't be detected from the response; confirm events in
  the PostHog UI after pasting the real key.
- Vendored bundle grepped: assigns the `posthog` global, contains
  `opt_out_capturing` + the `array.full.no-external` marker.
- NOT yet verified end-to-end in the browser (no key yet + Chrome MCP
  disconnected): paste key → reload → open Basecamp → check PostHog Activity.
  Watch for a popup-CSP issue on first open (none expected — the SDK is
  local and session recording is off).

## To enable

1. PostHog → project settings → copy the `phc_…` Project API key.
2. Paste into `PH_KEY` in **content.js AND popup.js** (and set `PH_HOST` in
   both if not US cloud).
3. Reload the extension.
