# 2026-08-14 — popup compaction, observer coverage, and a perf audit (v1.21.0)

Three asks from Faris, in one pass:

1. the toolbar popup is "fat" — make it small;
2. Force RTL and the relative-time labels "don't work always" — make every change
   get picked up;
3. the extension makes the browser feel heavy — **find out why, don't optimize yet**.

Everything below was verified live against real Basecamp in the `thmanyah` Chrome
profile (`/chrome`), not from the DOM alone — see [[always-visual-test-chrome]].

---

## 1. Popup: 1200px tall → 434px

`popup.html` only. Measured on a rendered copy of the real popup (served over
localhost with a `chrome.*` shim, so `popup.js` actually ran):

| | before | after |
|---|---|---|
| width | 264px | 300px |
| height, everything visible | ~1200px (overflowed the screen, "Delete" cut off) | **434px** collapsed / 677px with both editors open |
| row height | ~55px | 43px |

What changed:

- **The two editors are now `<details>`, collapsed by default.** The 9-row menu
  list + the emoji input were more than half the popup's height while being
  things you touch once. They're one click away, and `popup.js` needed no change
  (`#menuEditor`/`#emojiEditor` keep their ids and the `.disabled` toggle).
- 300px wide (from 264) so descriptions fit on one line instead of wrapping to
  three; row padding 10→6px, base font 13→12px, descriptions 10.5px, switch
  36×20→30×17.
- Copy shortened where it wrapped ("Font — Thmanyah typefaces", "Inline message
  menu — Edit/Reply/Bookmark/… beside bubbles", option labels in the font
  `<select>`). The full font-row explanation moved to the select's `title`.
- Descriptions **wrap, they don't ellipsize** — I tried `text-overflow: ellipsis`
  and it clipped the *privacy* line ("visits, clicks, session replays & errors —
  tied to your email"). A truncated privacy disclosure is worse than one extra
  line of text, so nowrap was dropped again.
- The menu list stays single-column: drag-to-reorder in `popup.js` compares
  `e.clientY` only, so a 2-column grid would make the drop position ambiguous.

## 2. Why RTL and the time labels "didn't always work"

Two separate bugs. The observer was one of them; it was not the bigger one.

### 2a. The observer only ever saw *added elements*

`MutationObserver(... {childList, subtree})` + `for (node of m.addedNodes) if
(node.nodeType === 1) enhance(node)`. Three real cases fell through it:

- **Text changed in place** (`characterData`, or a swapped text node). Turbo
  morphs and Basecamp's in-place edits keep the elements and replace only text —
  nothing was re-decided, so an edited message kept the direction it had when it
  was first rendered, and a `<time>` whose text was re-rendered kept a stale
  "(X ago)".
- **A node added *inside* a container we'd already decided.** `dir` is a majority
  vote over the container's whole text: a `<p>` streamed into an existing
  `.formatted_content` matches no `RTL_SELECTOR` itself, so `applyAutoDir(p)`
  found nothing and that paragraph got **no `dir` at all** — while the
  container's own vote was now out of date.
- Added **text** nodes were skipped outright (`nodeType !== 1`).

Fix, in `content.js`:

- observe `characterData` as well, and take `parentElement` for non-element
  targets;
- mutations are collected into a **set of dirty roots, flushed once per animation
  frame** (`markDirty`/`flushDirty`) instead of calling `enhance()` synchronously
  per added node — a burst of stream updates is now one pass;
- each dirty root gets `enhanceSubtree(root)` **plus `reDirContext(root)`**, which
  re-decides the nearest enclosing `RTL_SELECTORS` container (that's the fix for
  case 2);
- `applyCcLaunchers()` moved out of the per-node path — it's called **once per
  flush** (it does a `getBoundingClientRect`, i.e. a forced layout, and it used to
  run for every added node);
- **feedback guard**: `OURS_SEL` (`.bce-ago,.bce-reactions,.bce-hoverbar,
  .bce-cc-btn,.bce-ccpop`) — anything mutated inside our own DOM is ignored in
  `markDirty`. This matters more than it looks: on an idle card table, **41 of the
  41 mutations in 26 s were the extension's own** (the 60 s label refresh writing
  `badge.textContent`). `.bce-anchor` is deliberately *not* in that list — that
  class sits on Basecamp's own bubble, whose contents do need enhancing.
- `DIRTY_MAX = 200` roots → fall back to one whole-document sweep, so a huge burst
  can't degrade into 1000 individual passes;
- **rAF alone was a bug: `requestAnimationFrame` never fires in a background tab.**
  The first version queued mutations forever in a hidden tab and only caught up when
  you switched to it. Caught by the end-to-end test below (the automation tab is
  always hidden — which turned out to be the useful accident here). `markDirty` now
  arms **both** a rAF and a `setTimeout(…, 250)`; whichever fires first flushes and
  cancels the other. `teardown()` clears both.

### Tested end-to-end, not just reasoned about

The real `content.js` was loaded into a test page with a `chrome.*` shim (storage
returning the defaults) over synthetic Basecamp-ish markup, in a **hidden** tab —
the worst case. Results after the fix:

| case | before | after |
|---|---|---|
| `<p>` (Arabic) appended into an already-decided English container | `dir` = **null**, container stale `auto` | `p` = `rtl`, container re-voted to `rtl` |
| paragraph text replaced in place (characterData only) | container stuck at `rtl` | container + block re-decided to `auto` |
| `<time>` `datetime` + text re-rendered in place | badge stuck at "(2 weeks ago)" | 1 badge (no duplicate), "(3 days ago)" |
| idle 2 s, mutations seen by a spy observer | — | **0** (no feedback loop) |

### 2b. The real RTL gap: Basecamp renders titles *outside* `.formatted_content`

Scanning three views for elements whose text is majority-Arabic but whose computed
`direction` is still `ltr` (excluding anything already tagged `data-bce-dir`):

- **card table**: 190 such elements — every `.kanban-card__title`, every column
  title, the page `h1`. This is exactly the screenshot Faris sent: "تنقيح الانابيب
  في Airbyte" laid out with the English word at the wrong end.
- **project home**: `.dock-card__title` / `.dock-card__body`,
  `.vaultable-line__name` / `.vaultable-line__summary-text` (docs & files rows),
  `.recording-preview`, `.project-timeline-snapshot__content`.
- **chat/ping**: essentially clean — only `strong.chat-line__author` (names,
  harmless). So chat was never the broken view; boards and lists were.

Added those to `RTL_SELECTORS`, plus `main h1, main h2, main h3` for page and
column headings. Safe by construction: `majorityDir` returns `"auto"` for
Latin-majority text, so English titles are untouched. Verified visually before/after
on the card table — card titles now right-align and read correctly, and nothing else
moved (the avatars that appear in the "after" screenshot are Basecamp's own lazy
turbo-frames finishing, confirmed by re-checking the baseline).

## 3. Perf audit — what actually makes it heavy (NO fixes applied)

Measured on the `thmanyah` profile, on a card table (1193 DOM nodes) and a ping
room (2985 nodes, 50 chat lines). Ranked by my confidence × size.

### #1 — PostHog, and specifically session replay (by far the largest)

- `vendor/posthog.js` is **543 KB**, listed in `content_scripts` **before**
  `content.js` at `run_at: document_start`, so it is parsed and executed in
  **every Basecamp document** (every tab, every full navigation).
  Measured cost of just that, on this Mac: **9.2 ms compile + 8.9 ms execute ≈
  18 ms per document**, before a single event is captured.
- Session replay is **confirmed live**: `POST https://posthog.fhijazi.com/s/`
  fires within seconds of load (`/e/` for events, `/flags/` + `/array/…/config`
  on boot). Replay = rrweb: a second full-document MutationObserver, DOM
  serialization, mousemove sampling, compression and continuous upload — for the
  entire session, on every Basecamp tab. `autocapture`, `capture_heatmaps` and
  `capture_dead_clicks` are on too (all enabled in v1.18.0 "capture everything").
- This is the one thing that would be felt as "the browser is heavy" rather than
  "Basecamp is janky", because it is per-tab, permanent, and independent of what
  the page is doing.
- Cheap test if we want certainty: flip **Usage analytics** off in the popup
  (`phApply` opts the SDK out — no events, no recording) and see whether the
  feeling goes away. The 543 KB parse stays either way; only a lazier load or a
  slimmer build (`array.no-external.js` without replay) would remove that.

### #2 — the extension inflates the DOM by ~25%, which multiplies #1

On the 50-line ping room: **677 of 2985 elements are ours** (`.bce-ago`,
`.bce-reactions`, `.bce-react-btn`, `.bce-hoverbar`, `.bce-menu`). 8 emoji ×
50 records = 400 `<button>`s, one hover bar per record, and the lifted menus add
~10 more nodes per record once loaded. Every one of those nodes is also something
rrweb has to serialize and diff. The two costs compound.

### #3 — the RTL pass is our own hottest CPU path

A full `reconcile()` replicated against the live ping room: **2.73 ms**, of which

| phase | ms |
|---|---|
| RTL (`applyAutoDir`) | **2.12** |
| time labels | 0.18 |
| hover bars | 0.20 |
| standalone reactions | 0.16 |
| theme (`syncTheme`) | 0.04 |
| cc launchers | 0.03 |

`reconcile()` runs on every `turbo:load`/`render`/`frame-render`/
`before-stream-render` (rAF-coalesced) — i.e. on **every incoming chat message**.
The RTL cost is `textContent` + two regex scans **per container and again per
block**, and a container's `textContent` already includes all of its blocks' text,
so the same characters are scanned repeatedly (roughly text × nesting depth).
Section 2b makes this pass cover more elements, so it grew; that is a deliberate
correctness-over-speed trade for now.

### #4 — per-record `/options` prefetch

Every chat line / comment lazily fetches its own action menu
(`…/lines/<id>/options`, ~5–12 KB) as it nears the viewport, each parsed with a
fresh `DOMParser` document. A room you scroll through = one request per record.
Confirmed live (`/lines/10078949555/options`, …). Bandwidth and allocation, not
much CPU.

### #5 — background polling keeps the service worker alive

`ccSyncBusy` runs every 10 s **per tab** while launcher buttons exist, and hits
`GET /api/workers` through the service worker whenever any session is tracked
(HQ is currently up with a live worker, so it does). An open popover polls every
5 s on top. That keeps the MV3 service worker from ever idling out. Small, but it
is a permanent background cost and it multiplies by open Basecamp tabs.

### Ruled out / negligible

- The 60 s relative-label sweep: 0.18 ms.
- `syncTheme`'s `getComputedStyle` walk: 0.04 ms.
- Fonts: 1.1 MB in the repo, but faces load **lazily — only the selected family**
  (3 files seen on the wire for Serif Display). One-time, cached.
- Mutation volume on an idle page: ~40 records / 26 s, **all of them ours**.

Not measured: live frame-time/jank. rAF and timers are throttled in a background
tab, and the automation tab is never foregrounded, so any number I produced there
would have been fiction. The costs above are measured; the jank they add is
inferred from them.

---

## 4. Follow-up: the direction vote is now memoized (implemented + measured)

Faris asked whether whitelisting elements / only touching newly-added ones / going
non-blocking would help. Answers, with numbers:

- **It's already a whitelist** (`RTL_SELECTORS`), and matching was never the cost.
- **"Only newly added" is what the code did until today** — it *is* the bug in §2.
  Turbo morphs keep elements and swap text; a morph also strips our attributes off
  elements that stay put, and a removal is neither an added node nor a text change.
  So a purely incremental trigger cannot be correct on its own.
- The good version of the idea: **let the observer be the invalidation signal**, and
  memoize the vote. Implemented as `dirVote` (WeakMap) + `decideDir(el, fallback,
  force)`; `force` is passed only from `flushDirty`/`reDirContext`, i.e. exactly
  "this element's text just changed". Every other pass reads the cache and only
  **verifies the attribute** — which is the part that can't be skipped, because a
  morph drops `dir`/`data-bce-dir` while keeping the element alive.

### A/B on the real `content.js`

Same file, one variant with the memoization `sed`-ed out, same synthetic chat DOM
(60 records × 3 paragraphs + a list), timing the **real `reconcile()`** (reached
through the `storage.onChanged` listener, which runs it synchronously):

| body text | uncached (median) | memoized (median) | |
|---|---|---|---|
| 24 K chars (`k=1`) | 2.55 ms | 2.50 ms | no measurable gain |
| **477 K chars (`k=20`)** | **13.31 ms** | **0.97 ms** | **13.7×** |

The point isn't the 13×, it's the *shape*: the old cost grew linearly with how much
text the thread holds, and threads only grow. The memoized cost is flat.

On the **real** ping room (2938 nodes, 26 K chars), interleaved A/B of the vote pass:
**1.72 ms → 1.40 ms (1.22×)**. Modest, because a normal room's text is small.

### Viewport-gating: measured, then rejected

Gating only pays if per-element work dominates. It doesn't — splitting the pass on
the real room:

| | ms |
|---|---|
| `document.querySelectorAll(RTL_SELECTORS)` — the query itself | **0.985** |
| all per-element work for the 76 matches (attribute reads + block walk) | 0.245 |

So an `IntersectionObserver` per container would add per-target cost to save a
fraction of 0.245 ms. Not worth it — dropped.

That query is now the dominant term, and it's **~25–50 µs per selector per sweep**,
essentially regardless of how many elements match (measured warm: `.formatted_content`
22 µs, `main h1` 32 µs, `textarea` 26 µs, `[contenteditable='true']` 112 µs; all 26
selectors combined ≈ 1.06 ms ≈ their sum). **The RTL coverage fix in §2b therefore
costs ~+0.5 ms per sweep** (14 → 26 selectors, 0.58 → 1.06 ms) — a deliberate
correctness-for-speed trade, and the obvious knob if we ever want it back.

### "Can't we make it non-blocking?"

Not really, and it wouldn't be the win:
- a **Web Worker** has no DOM, and shipping text out + results back costs about what
  the scan costs;
- **time-slicing / `requestIdleCallback`** removes long tasks but not total CPU, and
  deferring direction decisions past paint means a visible LTR→RTL flip;
- the honest ranking is unchanged: our whole `reconcile()` is single-digit ms per
  Turbo event, while PostHog is 543 KB parsed per document plus continuous replay.

### Correctness of the cache — tested

Same harness as §2, extended (real `content.js`, hidden tab):

| case | result |
|---|---|
| in-place text swap re-votes (cache invalidated) | `rtl` → `auto` ✓ |
| morph strips `dir`+`data-bce-dir`, text unchanged → reconcile restores from cache | restored ✓ |
| Force RTL toggled **off** | `dir` gone, 0 `[data-bce-dir]` left ✓ |
| toggled back **on** | re-applied from cache ✓ |
| added Arabic `<p>` in an English container | `p=rtl`, container re-voted ✓ |
| `<time>` re-rendered in place | 1 badge, text refreshed ✓ |
| idle 2 s | 0 mutations (no feedback loop) ✓ |

Known, deliberate caveat: a cached block ignores the `fallback` argument, so a block
with **zero** strong characters ("…", bare numbers) keeps its old inherited direction
if its container later flips without the block's own text changing. The force path
recomputes container and blocks together, so this only survives where no text moved.

## 5. Live verification with the real (reloaded) extension

Card table, ping room and campfire, `thmanyah` profile:

- **Card table** — 14 of 21 `.kanban-card__title` now `dir="rtl"` (the other 7 are
  Latin-majority titles, correctly left as `auto`), 25 elements RTL, page `h1` and
  column headings flipped, 20 relative-time badges. The majority-Arabic-but-LTR count
  dropped **190 → 120**, and the remainder are *wrappers* around already-fixed titles
  (`.kanban-card__wrap`, `.kanban-card__content`), the toolbar breadcrumb and avatar
  name boxes — nothing whose text reads wrong.
- **Campfire / ping room** — 50–51 hover bars on 50 records, 450 reaction buttons,
  106–124 badges, 147 elements RTL, CC launcher present. No console output from us.
- **The observer, live**, by injecting the same DOM changes a Turbo stream makes
  (then reverting them):

  | live case | result |
  |---|---|
  | Arabic `<p>` appended into an existing `.formatted_content` | `dir="rtl"`, tagged `data-bce-dir="none"` ✓ |
  | same `<p>`, text replaced in place with English | flips to `auto` (memo invalidated) ✓ |
  | `<time>` datetime changed in place | badge "(2 months ago)" → "(5 days ago)", still exactly 1 ✓ |

### Two things found while verifying

- **The CC launcher was parked in its last-resort fallback.** Placement only ran
  inside `if (!btn)`, so if the button was created before Turbo filled the composer,
  it stayed in the pane host forever — on a campfire it sat at the far left of the
  composer while `.chat__footer .chat__tools` existed right there. Now the mount
  point is resolved on **every** pass and the button is re-homed when a better slot
  appears (dropping `.bce-cc-beside` when it moves out of the gutter). Pre-existing,
  not a regression from the batching. **Verified after the fix**, on first load: the
  campfire button mounts as the **last child of `.chat__tools`** (renders after
  emoji/attach/mic/A, inside the composer's border), and with a sidebar ping open
  there are 2 panes → 2 buttons with independent URLs, the sidebar one correctly
  still in the pane-host fallback because that (disabled) room has **no tool row and
  no form at all** — `tools: 0`, `formRelative: 0`. No stale `.bce-cc-beside`.
- **A recurring `Uncaught TypeError: … reading 'classList'` on chat pages is
  BASECAMP'S, not ours.** It fires every ~40 s from `clearTypingStatus` in their
  `desktop-*.js`, on every ActionCable connect; no extension frame appears in the
  stack. Cause: `RoomController` caches `statusElement = element.querySelector(
  "[data-behavior~=chat_typing_status]")` **at construction**, and for a room whose
  typing-status node isn't there yet (or at all — e.g. the disabled ping room, which
  has zero of them) it's null forever. We never remove Basecamp nodes — the only DOM
  we delete is our own — but if you want certainty, toggle the extension off in
  `chrome://extensions` and watch the same console.

## Files touched

- `popup.html` — compact layout, `<details>` editors, shorter copy.
- `content.js` — `OURS_SEL`, `enhanceSubtree`/`enhance` split, `reDirContext`,
  batched `markDirty`/`flushDirty` observer (+`characterData`, rAF **and** timer),
  rAF/timer cancel in `teardown`, title/preview selectors in `RTL_SELECTORS`,
  `dirVote` WeakMap + `decideDir(el, fallback, force)` memoization.
- `manifest.json` — 1.20.0 → **1.21.0**.
- `CLAUDE.md` — observer/RTL/popup notes.

## Still open (deliberately not done)

- #3 (the RTL vote) **is now done** — see §4. What's left of that pass is the
  selector query, and gating it was measured and rejected.
- The two bigger items are untouched: **#1 replay / lazy-load the 543 KB SDK** and
  **#2 the 400 emoji buttons** (build the row on demand instead of per record).
  Those are where the remaining order-of-magnitude is.
- A live jank measurement needs a foreground tab — worth doing by hand with
  DevTools' performance panel before/after any of the above.
