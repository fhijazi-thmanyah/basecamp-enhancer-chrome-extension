# 2026-10-20 — GitHub link status icons (v1.26.0)

**Ask:** tiny icon next to any GitHub PR/issue link showing open/closed/draft/merged/archived; Basecamp only; use an existing extension if one exists.

**Existing options checked:** fregante "GitHub Issue Link Status" (Chrome store) — content script matches only `https://github.com/*` and only same-origin links (its domain toggle is for GitHub Enterprise), so it can't decorate Basecamp. Refined GitHub — github.com only. "PR Status" — Jira boards. Nothing covers arbitrary sites ⇒ built into basecamp-enhancer.

**What:** `content.js` feature block "GitHub link status", `background.js` `ghStatus` (GraphQL `resource(url:)` batch, 5 min cache), popup toggle + token field (`chrome.storage.local.ghToken`), `styles.css` `.bce-gh` (GitHub's state colors, `.bce-dark` palette). No manifest permission change (api.github.com is CORS-open).

**Tested:**
- `tests/ghstatus_test.mjs` — 30 checks incl. live API (archived repo, merged PR, missing repo → null).
- private Thmanyah-LLC PR resolves with the gh OAuth token.
- headless harness `tests/harness/ghstatus.html` with the real content.js/styles.css: 9 icons, all states correct, no duplicates, none in composer / list links / inaccessible PRs.
- popup rendered headlessly: no script error, token summary shows "✓ set".
- NOT yet tested in the real Basecamp tab — needs an unpacked-extension reload + token paste.

**Gotcha found:** popup stubs call `storage.get` callbacks synchronously, so any top-level `const` referenced inside the `sync.get(DEFAULTS…)` callback must be declared above it (TDZ) — the token block is placed before that call for this reason.

## v1.26.1 — no token needed
User reloaded, saw nothing (no token pasted) and wanted zero labor. Default path is now GitHub's hovercard endpoint with the user's github.com cookies (`https://github.com/*` host permission). Verified in the user's Chrome on github.com: `/hovercard` returns 406 without `X-Requested-With`, 200 (~4 KB) with it; the state-badge regex returned the right octicon for merged / open / draft / not-planned / completed and an `/issues/N` URL that is really a PR. Token stays as an optional upgrade (archived icon). NOT yet verified: cookies actually riding the service-worker fetch in the real extension (needs a reload on the Mac).
