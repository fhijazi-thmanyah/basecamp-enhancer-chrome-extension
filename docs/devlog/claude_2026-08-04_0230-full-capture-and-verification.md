# 2026-08-04 — telemetry verified server-side + "capture everything" (v1.18.0)

## Verification (PostHog MCP now connected)

Queried the `events` table directly. Confirmed captured:

- faris.hijazi@thmanyah.com: `$identify`, `$pageview`s (message 10159100419, circle
  48364833), both ❤️ `reaction_sent` events (`ok=true`), popup `setting_changed`.
- **5 more colleagues already using the extension** (baqais, safiyah.algorish,
  abdelati.elasri, Abdulelah.Aldhafr, Mustafa.Hasan) — reactions, pageviews,
  settings churn. 6 unique identified users total. Zero `extension_error` events.

## Bug found during verification

**No `$autocapture` events at all** — `advanced_disable_decide` +
`advanced_disable_feature_flags` (added for "opted-out ⇒ zero requests") also
prevent autocapture and session replay from ever activating: posthog-js waits for
the remote-config response before wiring both. Client `autocapture:true` alone is
not sufficient.

## Changes (v1.18.0, "capture everything" per user)

- `content.js` `phApply()`: removed the two `advanced_disable_*` flags; added
  `capture_dead_clicks`, `capture_heatmaps`, `disable_session_recording:false`.
  Masking follows remote config (passwords always masked).
- PostHog project 540812 (via MCP `project-settings-update`):
  `session_recording_opt_in`, `capture_console_log_opt_in`,
  `capture_performance_opt_in`, `autocapture_web_vitals_opt_in`,
  `heatmaps_opt_in`, `capture_dead_clicks` all true;
  `recording_domains = [app.basecamp.com, 3.basecamp.com]`.
- `popup.html` telemetry row + README Arabic privacy note now disclose session
  recordings.
- popup.js unchanged: its init stays minimal (custom `setting_changed` only — no
  point recording/autocapturing the settings popup, and it keeps decide disabled
  so opening the popup costs zero config requests).
- Deliberately NOT enabled: `autocapture_exceptions_opt_in` — it would ingest all
  of Basecamp's own JS errors; our `extension_error` listener (filtered to our
  extension's stacks) stays the error signal.

Trade-off recorded in CLAUDE.md: opted-out users now still make the remote-config
fetch (no events, no recording).

## Self-host question (user asked)

Everything used (capture, identify, autocapture, pageviews, replay, HogQL/insights)
exists in the open-source hobby self-host. Would need: swap `PH_HOST` in
content.js+popup.js, host publicly (colleagues' browsers must reach it, TLS).
Cloud-only losses: Max AI, this MCP integration (points at cloud), managed scaling.
