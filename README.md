# Basecamp Enhancer

A tiny Chrome extension (Manifest V3) that runs **only on Basecamp** and adds two quality-of-life fixes:

1. **Relative timestamps** — appends ` (X ago)` to `<time>` elements (e.g. `Jun 2 (6 days ago)`), computed from the `datetime` attribute via `Intl.RelativeTimeFormat`. Refreshed every 60 s. Timestamps within ±1 day are skipped, since Basecamp already shows those as the word "yesterday"/"today"/"tomorrow".
2. **RTL fix** — sets `dir="auto"` on content containers **and editable fields** (textareas, text inputs, the rich-text editor) so Arabic (and other RTL) text renders right-to-left — live as you type — while mixed Latin words/numbers stay correctly ordered, and English content stays LTR.
3. **Inline reactions** — a row of quick-boost emoji injected next to Basecamp's own "+" boost button on every reactable item (cards, comments, messages, chat, threads, pings), so you react in **one click** without opening the "…" menu. The bar is a **recently-used rotation**: every reaction you make — via the bar or Basecamp's own picker — bubbles that emoji to the front (max 8). Seed/edit the set from the popup.
4. **Inline action menu** — the entire "…" kebab menu (**Edit, Reply, Bookmark, Bubble up, Copy link, Delete / Put in the trash, …**) lifted **inline**, so you never open the kebab. Works on **chat/pings** (beside each bubble — yours on the left, others' on the right) **and comments** on cards, todos, and messages (under each comment). It's Basecamp's own menu (its controllers reconnect, so every action works natively) and loads lazily as records scroll into view.

All run continuously: a `MutationObserver` enhances new content as Basecamp streams it in, and every operation is **idempotent** — re-running never produces duplicate badges, bars, or re-set attributes. Turbo re-renders (cable-stream updates, morph refreshes) are caught via `turbo:*` events so decorations restore instantly instead of flickering.

## Toggles & options

Click the toolbar icon for a popup that enables/disables each feature independently, plus an **emoji editor** for the inline-reaction set (type/paste any emoji — spaces optional; "Reset to defaults" restores the standard set). Changes apply **live** to open Basecamp tabs (no reload) and persist via `chrome.storage.sync`. With all toggles off, the extension fully reverts its changes — plain Basecamp.

## Install (unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right) on
3. Click **Load unpacked** and select this folder (`basecamp-enhancer/`)
4. Open / reload [app.basecamp.com](https://app.basecamp.com) — you must be signed in

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, scoped to `app.basecamp.com` + `3.basecamp.com`, `run_at: document_start`, `storage` permission, toolbar `action` |
| `content.js` | All logic — time badges, RTL auto-dir, settings/apply-revert, observer wiring |
| `popup.html` / `popup.js` | Toolbar popup with the feature toggles |
| `styles.css` | Badge styling + `unicode-bidi: plaintext` bidi safety net |

## Notes

- Scoped via `content_scripts.matches`; it injects on no other site.
- The RTL selector list (`content.js` → `RTL_SELECTORS`) targets Basecamp content classes — chiefly `.formatted_content` (rendered messages/comments/descriptions), plus `.trix-content`, `.message__content`, `.todo__content`, etc. Add selectors there if a specific view isn't picking up direction.
