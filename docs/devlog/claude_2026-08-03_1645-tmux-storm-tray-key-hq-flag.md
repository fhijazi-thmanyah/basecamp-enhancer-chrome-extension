# 2026-08-03 — tmux poll storm (stuck "Spawning worker…"), view-independent tray key, CC_HQ_LINK flag (v1.16.7 + cc-tmux-api 0.2.1)

## Symptom chain (all one root cause)

After the v1.16.6 reload, launches sat forever at "Spawning worker…", tray
dots stayed gray, and session names never became claude.ai links — while the
workers themselves launched fine (`hq-bc-3` was live with a `web_url` the
whole time).

Root cause: `/api/workers` cost ~100 tmux subprocess calls per GET (~8 per
worker in `list_workers`, one `display-message` per session in `list_others`,
one `list-sessions` **per routine** in HQ's `list_routines`) and is polled
every 5 s by each open popover, every 10 s by each tab's `ccSyncBusy`, plus
the HQ dashboard. The serial tmux server queued up until individual commands
blew their 10 s `subprocess.run` timeout → intermittent 500s (seen in
`/tmp/thmanyah-hq.err`, 16 TimeoutExpired tracebacks) and spawn POSTs stuck
>30 s in the same queue (reproduced with curl: timeout at 30 s while the tmux
session was created fine). Failed polls are also why the tray link "still
didn't work": `pollTray` only sets the name's `href` from a successful
response.

## Fixes

**cc-tmux-api 0.2.1 (`d0635e8`)** — batch + cache:
- `_sessions_full()`: sessions + all `@hq_*` user options in ONE
  `list-sessions -F` call (tmux formats expand user options; title last with
  bounded split since it's user input).
- `_pane_cmds()`: all pane commands in ONE `list-panes -a` call.
- One `capture-pane` per worker, reused for status classification and tail
  (`_classify` extracted; `status_of` keeps its signature for the HQ wrapper).
- 2 s TTL cache on `list_workers` (lock-guarded): concurrent pollers coalesce
  into one rebuild; a tmux stall serves the last snapshot stale instead of
  500ing; invalidated on spawn/kill so changes show on the next poll.
- Per-worker `TimeoutExpired` degrades that row to `status:"unknown"`.
- Measured: rebuild 0.12 s, cache hit ~0 s; HQ GET `/api/workers` now
  30–180 ms; spawn under 6 concurrent polls returns in 0.79 s.

**career-coach `b0e7925`** — `list_routines` hoists ONE `workers._sessions()`
call instead of one per routine (`_alive_session(name, live)`).

## Extension v1.16.7

- **`convoKey` is now view-independent** (user: maximized ping vs sidebar
  panel showed different session trays). Key = `origin` + the
  `/circles/<id>` | `/chats/<id>` tail when present (else path with
  `/my/sidebar/` stripped), after dropping fragment, query, and the trailing
  `@<message-id>` marker. Unifies `/my/sidebar/circles/<id>`,
  `/<acct>/circles/<id>@<msg>`, and campfire `/buckets/<b>/chats/<id>` vs
  sidebar `/chats/<id>`. Unit-tested in node (match matrix + distinct ids).
- **`CC_HQ_LINK` flag** (user: "showing the HQ … shouldn't be in the main
  branch"): the per-row "HQ ↗" dashboard deep link is gated; false on
  master, true on cc-launcher (branch diff is now 3 lines).
- **Popup: `#ccRow` moved to the bottom** (below the emoji editor), and its
  subtitle says "Claude worker" instead of "HQ worker".
- Session-name links needed no code change — they populate via `pollTray`
  once the backend answers reliably (backend fix above).

## Verification

- Perf script (scratchpad `test_list_perf.py`) against live tmux: 9 workers,
  fields intact, `web_url` present for all, cache-hit identity, `status_of`
  re-export path works.
- Probe spawns `hq-probe-stuck-spawn-1` / `hq-probe-perf-fix-1` created,
  confirmed listed (`working`, career-coach workdir), then killed (etiquette:
  no stray unattended workers).
- convoKey: node unit matrix above.
- NOT yet visually verified (Chrome MCP disconnected): tray link click,
  unified tray across views. Needs an extension reload (v1.16.7) + live look.

See CLAUDE.md → Gotchas ("polling hot path") and the publish-gate paragraph
(3-line branch diff) — both updated.
