# Suggested replies inline in Basecamp (v1.24.0)

Faris asked for the HQ runway (Claude's drafted replies) to show up IN Basecamp,
per thread, with HQ's accept/reject/edit, saying which thread/message it replies to.

## What shipped
- extension: `applyRunway` (content.js "Feature 6"), `hqRunway`/`hqAction` in
  background.js (action allow-list send|edit|revise|reject), popup toggle
  `runway` (hidden unless the cc-launcher flag is on), styles at the end of styles.css.
- HQ (career-coach `hq/main.py`): `GET /api/runway` (cheap pending-drafts list) and
  an `edit` action (hand edit; line 0 meta kept byte-for-byte). Restart HQ to load.

## Verified
- `tests/runway_test.mjs` (19 matching cases; it caught a comment draft matching a
  chat with the same id, fixed by matching `collection/id`).
- `scripts/runway-harness.sh`: real content.js in headless Chrome, all
  interactions + a screenshot. Found two bugs, both fixed: body-null crash at
  document_start, and `pageIsDark` reporting dark before any opaque background.
- HQ `edit` exercised live on a throwaway draft (meta md5 unchanged, empty body
  refused, `../` path refused), then deleted.

## Not verified
- On the real Basecamp DOM: the thmanyah Chrome profile was not connected to this
  session, and reloading an unpacked extension needs chrome://extensions by hand.
  Selectors used are the ones the extension already relies on
  (`article.thread-entry--form`, `.chat__lines`, `#__recording_<id>`).
