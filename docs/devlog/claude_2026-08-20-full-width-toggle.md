# 2026-08-20 — "Full width" toggle (v1.22.0, default OFF)

Task: let Basecamp's middle column use the whole screen, off by default.

## Finding the cap (the interesting part)

The thmanyah Chrome profile never connected, so this was diagnosed from
artifacts Faris supplied instead of live automation:

1. First guess (`.container { max-width }`) was wrong — a saved copy of the
   narrow element (`midcol.html`) showed the current redesign's markup:
   `main#main-content.main-content.perma` > `.perma-toolbar` / `.perma-header`
   / `article.message` / `.document-style-content` / `.thread`.
2. A `querySelectorAll('main, main *')` max-width sweep found **no caps** —
   because the constraint isn't a max-width at all.
3. An ancestor walk showed `main.main-content` computing `w=1088px` with
   `margin-inline` auto-resolved to 692px each side → the column is **sized**,
   not capped. The console dump leaked the CDN stylesheet URL
   (`bc3-production-assets-cdn.basecamp-static.com/assets/desktop-*.css`,
   public, no auth), and the real rule is:
   `.perma { --perma-width: 1088px; inline-size: min(100% -
   var(--perma-page-margin)*2, var(--perma-width)); margin-inline: auto }` —
   and Basecamp itself ships size modifiers ending in
   `.perma--full { --perma-width: 100% }`.

So the feature is exactly one rule, riding their own sizing formula:

```css
html[data-bce-wide] .perma { --perma-width: 100% !important; }
```

Faris verified live in DevTools that both `width: auto` on the element and
`style.setProperty('--perma-width','100%')` fill the screen as wanted — the
shipped rule is the latter, selector-scoped.

## Wiring (standard feature pattern)

`fullWidth: false` in `DEFAULTS` (content.js + popup.js), `fullWidth` in
`TOGGLES`, a popup row ("Full width — middle column uses the whole screen",
between Force RTL and Font), `applyFullWidth`/`removeFullWidth` (set/remove
`data-bce-wide` on `<html>`) wired into `reconcile()`. Applies/reverts live
via `storage.onChanged`, no reload. Popup grows one 43px row (~477px closed —
still well under Chrome's 600px cap).

Chat rooms and card tables have no `.perma` sizing and are untouched (verified
by the max-width sweep on a chat page: only the outage banner and blank-slate
had caps, both irrelevant).

Still on v1.22.0 — the 1.22.0 zip was never uploaded, so no bump needed.
`./scripts/build.sh --check` green; Safari resources re-synced via
`./scripts/build-safari.sh --sync`.
