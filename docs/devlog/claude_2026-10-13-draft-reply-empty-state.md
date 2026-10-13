# 2026-10-13 - "Draft a reply" empty state + 3-line clamp (v1.25.0)

Asked by Faris: a way to get a draft for the current thread from the extension. First
idea (a menu on the orange Claude button) was superseded before any code: the purple
Suggested-replies bar should always exist and, when empty, prompt for a draft. Plus: clamp
long drafts to 3 lines with expand/scroll.

## What changed
- `content.js`: `rwEmpty` / `rwDraft` / `rwTick` / `rwFlashLanded`; empty bar rendered in the
  existing slots (main view above the comment composer, chat footer above the composer);
  body clamp (`measure`, `.bce-rw__more`).
- `background.js`: `hqDraft` -> `POST /api/draft {url}`.
- `styles.css`: `.bce-rw-empty*`, clamp/open rules, dark variants.
- Harness: stub answers `hqDraft` and parks a draft 1 s later; asserts clamp, empty bar
  (main + chat), spinner, landing. Budget raised to 20 s virtual time.

## Backend (career-coach, same day)
`hq/main.py` `POST /api/draft` spawns one draft-only worker per thread (dedup by title),
the worker saves via `bc_thread_watch.py send --draft` (new flag, passes `--draft` to
`bc_send.py`, which then always parks in the outbox). Idle draft workers are reaped by the
60 s worklog loop.

## Tested
- `node tests/*_test.mjs`, `./scripts/runway-harness.sh --shot` (all asserts pass).
- Live HQ: curl `/api/draft` for the self-ping -> worker parked
  `20261013-063329-chat-10195071141.md` (kind chat, project 48476507, so it matches the
  ping inline), visible in `/api/runway`; second call reused the same worker; bad URL 400.
- Not tested in real Chrome: the unpacked extension needs a manual reload.
