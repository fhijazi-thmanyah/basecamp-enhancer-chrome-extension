# Backend-setup docs + launcher-decoupling planning decisions

## Shipped (v1.13.2)

- **README → "Backend setup (Claude Code launcher only)"** — new bottom section: Claude
  Code installed + signed in; remote control defaulted on via `/config` → "Enable Remote
  Control for all sessions" = `true` (verified against the official remote-control docs —
  there is **no settings.json key or env var** for this, only `/config`); install `uv` +
  `tmux`; create the workspace dir and run the backend via `uvx git+…` (repo URL is a
  `<owner>/<backend-repo>` placeholder until the backend is extracted/published).
- **Workspace dir contract**: `BCE_WORKSPACE_DIR` env var, default
  `~/.basecamp-enhancer/workspace/` (personal override points elsewhere; the default is
  what ships in docs/hints).
- **content.js**: `CC_SETUP_HINT` (next to `CC_WORKDIR`) — when a Launch fails with the
  backend unreachable (`/unreachable/i` on the error), the popover status now appends the
  same `mkdir -p … && uvx git+…` command as a `<pre>` tail. Keep it in sync with the
  README section.

## Planning decisions (NOT implemented — future backend work)

Decoupling the launcher from HQ, per discussion on 2026-07-30:

- **Keep the local daemon as the spine.** Claude Code cloud **Routines** (`POST
  /v1/claude_code/routines/{id}/fire`, beta header `experimental-cc-routine-2026-04-01`)
  can launch a cloud session and return a `claude.ai/code/session_…` URL, and the session
  survives the laptop dying — but there is **no public API to read status, list sessions,
  or kill** a fired session (browser-only observation), and the trigger token shouldn't
  live client-side. So Routines = optional fire-and-forget mode later; it cannot replace
  the daemon's tray (status dots / kill / confirm-launch) or local tooling.
- **3-verb spawner contract** (spawn / list / kill — exactly what `background.js` already
  speaks) is the decoupling boundary. HQ becomes one implementation; a standalone
  `uvx`-installable daemon (extracted from HQ's spawner, **shared module, not a fork**)
  becomes the shippable one.
- **Per-session workspace folders**: daemon spawns from a fixed root but each session gets
  `$BCE_WORKSPACE_DIR/<session-uuid>/` as cwd (uuid = the `--session-id` HQ already
  passes; same id keys folder + jsonl + tmux + tray row). Plain folders (not worktrees) —
  isolation isn't the goal, per-session state/resumability is.
- **Restart-survivable sessions**: on daemon start, `claude --continue`/`--resume` each
  non-tombstoned workspace folder. NOTE (user-verified): resume only **revives** the
  session — the web URL goes live again but claude executes nothing without a prompt. A
  nudge prompt stays optional if watches should actually resume looping.
- **`.done` tombstone**: written by **the agent itself** when its job is finished (goes in
  the spawned-worker prompt template, career-coach side), and by the daemon when the user
  clicks ✕ in the tray. Tombstoned folders are never resumed and are the GC candidates.
- **Resume max-age: 5 days** — older non-tombstoned sessions are not auto-revived.
- Workspace folders + `meta.json` should become the session registry (single source of
  truth); the extension's `chrome.storage.local.ccSessions` demotes to a cache.
