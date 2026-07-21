# CLAUDE.md — basecamp-enhancer

MV3 Chrome extension scoped to Basecamp. Two features, both idempotent, continuous, and individually toggleable. See @README.md for install/usage.

## Architecture

Content script (`content.js`, one IIFE) + toolbar popup (`popup.html`/`popup.js`). No build step, no dependencies.

**Settings flow (narrow waist = `chrome.storage.sync`):** popup is dumb — it only reads/writes two booleans (`timeLabels`, `rtl`). The content script holds the live `settings` object, seeds it from storage on load, and listens on `chrome.storage.onChanged` to apply/revert **without a reload**. `reconcile()` is the single function that makes the page match settings (`decorateAllTimes`/`removeTimeLabels`, `applyAutoDir`/`removeAutoDir`). Both off ⇒ fully reverted ⇒ plain Basecamp. Adding a feature = add its key to `DEFAULTS` (both files), a toggle row in `popup.html`, and an apply+remove pair wired into `reconcile()`/`enhance()`.

- **`decorateTime` / `decorateAllTimes`** — append a `.bce-ago` span with `Intl.RelativeTimeFormat` output (`numeric: "always"` → "N units ago", never the word "yesterday"). Idempotent: reuses the existing `:scope > .bce-ago` child instead of appending a new one. Two skip rules: (1) the whole ±1-calendar-day range (`calendarDayDiff`) — Basecamp shows yesterday/today/tomorrow as a relative *word*, so a badge is redundant; (2) any `<time>` with a later sibling `<time>` (`hasLaterTimeSibling`). Basecamp emits **two** `<time>` per timestamp sharing one `datetime` (`<a>` wraps `<time data-local="weekday">Tuesday</time>` + `<time data-local="time-or-date">Jun 2</time>`); rule 2 badges only the **last** sibling so the label never appears twice (`Tuesday` stays plain, `Jun 2 (6 days ago)` gets the badge). `decorateAllTimes` handles both descendant `<time>` (via `querySelectorAll`) **and** a root node that *is* a `<time>` (the observer hands these directly — `querySelectorAll` would miss them).
- **`applyAutoDir` / `setAutoDir`** — sets `dir="auto"` on `RTL_SELECTORS` (rendered content **and** editable fields: `textarea`, `input[type=text|search]`, `[contenteditable]`, `trix-editor`) so typed Arabic auto-directions live. `setAutoDir` only sets when the element has **no** `dir` already, and tags it `data-bce-dir` — so `removeAutoDir` reverts exactly what we touched and never disturbs Basecamp's own `dir` attributes.
- **`enhance(root)`** — runs the **enabled** features on a subtree; bails early if `root` is one of our own `.bce-ago` badges (avoids observer-feedback rework).
- **Wiring** — `run_at: document_start`, immediate `enhance()` (uses `DEFAULTS` until storage resolves, then `reconcile()` corrects), a `MutationObserver` on `document.documentElement` (continuous), `DOMContentLoaded`/`load` full sweeps, and a 60 s interval (guarded by `settings.timeLabels`) to refresh relative labels.

## Gotchas / invariants

- **Idempotency is load-bearing** — the observer fires on our own badge insertions; the early-return + reuse-existing-badge logic is what prevents loops/duplicates. Don't break it.
- **`<time>` root case** — when adding `<time>` handling, remember `querySelectorAll("time")` matches descendants only. Bare-node decoration is a separate explicit check.
- **Revert must be exact** — RTL revert only removes `dir` from `[data-bce-dir]`-tagged nodes; never blanket-strip `dir`, or you'd wipe Basecamp's own attributes. Keep `setAutoDir`'s "only when no existing `dir`" + tag invariant.
- To support a new Basecamp view's RTL, add its content class to `RTL_SELECTORS`.

## Packaging / publishing

- Icons are generated from `icon.svg` (source of truth) → `icons/icon{16,32,48,128}.png` via `for s in 16 32 48 128; do rsvg-convert -w $s -h $s icon.svg -o icons/icon$s.png; done`. Re-run after editing the SVG.
- Build the Web Store upload zip (runtime files only, manifest at root): `zip -r basecamp-enhancer.zip manifest.json content.js popup.html popup.js styles.css icons/ -x '*.DS_Store'`. Excludes `README.md`/`CLAUDE.md`/`icon.svg`/docs.
- Bump `version` in `manifest.json` for every Web Store re-upload (it rejects duplicate versions). Distribution: Chrome Web Store, **Unlisted**.

## Testing

No live signed-in account in the automation browser profile. Logic is verified by injecting `content.js`'s source against synthetic Basecamp-like markup via the Chrome MCP `javascript_tool` and asserting: single badge after double-run (idempotency), correct relative text, `dir=auto` resolving to `rtl` for Arabic-first / `ltr` for English-first, and dynamic nodes decorated by the observer. The `javascript_tool` REPL mangles top-level `await` — keep injected test code synchronous and split timing-dependent checks across separate calls.
