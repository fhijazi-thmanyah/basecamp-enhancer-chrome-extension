# 2026-08-04 — CC launcher on PostHog feature flags + self-owned ingestion domain (v1.19.0)

## 1. cc-launcher branch retired → PostHog feature flags

The compile-time `CC_ENABLED`/`CC_HQ_LINK` consts (and the `cc-launcher`
branch whose only diff flipped them) are replaced by two PostHog flags,
targeting person-property email = faris.hijazi@thmanyah.com at 100%:

- `cc-launcher` (id 797772) — the launcher button + popup `#ccRow`
- `cc-hq-link` (id 797778) — per-row "HQ ↗" tray deep links

Mechanics: `phApply` registers `posthog.onFeatureFlags` →
`isFeatureEnabled(..., {send_event:false})` → `ccFlags` → cached in
`chrome.storage.local.bceCcFlags` → `reconcile()`. popup.js reads the cache
only. Cache = instant launcher on load + survives telemetry-off (flags just
stop refreshing). Verified via `/flags?v=2`: true for faris's distinct_id,
false for others. Granting someone the launcher = add their email to the
flags in PostHog; no build/branch.

Branch `cc-launcher` deleted (local + origin) after merging its docs into
master. ONE branch now.

## 2. Ingestion goes through posthog.fhijazi.com (self-host later = no re-release)

`PH_HOST` (content.js + popup.js) → `https://posthog.fhijazi.com`, with
`ui_host: https://us.posthog.com`. That domain is an nginx reverse proxy on
ftower (`~/media-server/compose/posthog/`, Traefik + Cloudflare tunnel):
`/static/*` → us-assets.i.posthog.com, everything else → us.i.posthog.com.
Runtime DNS re-resolution (PostHog rotates IPs), 20 MB bodies (replay),
X-Forwarded-For preserved, `/healthz` for the container healthcheck
(Traefik drops unhealthy containers — the first deploy 500'd because the
healthcheck wget'd `/`, which upstreams to a 404). Full e2e verified through
the public domain: capture `{"status":"Ok"}`, static serves JS, flags
evaluate. Swapping to self-hosted PostHog later = retarget the upstreams in
`provision/nginx/posthog.conf` (or deploy the real stack on that domain);
installed extensions never notice. See the ftower-side
`compose/posthog/CLAUDE.md` for the client contract.

## Gotchas

- Flags only refresh while telemetry is on (they ride the SDK); the storage
  cache carries the last state otherwise.
- First-ever run on a new profile: launcher appears only after
  identify → flags round-trip (person email must match) — seconds, once.
- Do NOT re-add compile-time gates; the flags are the mechanism now.

## Addendum (same day): proxy PARKED, not live

User call: skip the proxy for now. v1.19.1 reverts `PH_HOST` to
`https://us.i.posthog.com` directly — routing telemetry + flag delivery
through a home server made the cc-launcher gate depend on ftower uptime.
The ftower proxy stays deployed and healthy as a ready cutover path
(flip PH_HOST back to posthog.fhijazi.com when self-hosting).

## Addendum 2: proxy LIVE after all (v1.19.2)

User: "ftower is always up — bring it back." PH_HOST is back on
https://posthog.fhijazi.com (+ ui_host us.posthog.com); capture re-verified
through the domain ({"status":"Ok"}). The ftower compose/posthog/CLAUDE.md
now marks the proxy as production infra: if it's down, telemetry stalls and
flags stop refreshing (cached flag state keeps the launcher working).
