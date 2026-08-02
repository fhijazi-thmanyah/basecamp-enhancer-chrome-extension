# Backend extracted: cc-tmux-api (v1.16.3)

The Claude Code launcher's backend is now a standalone, public, uvx-runnable
repo: **https://github.com/FarisHijazi/cc-tmux-api** (the decoupling planned in
`claude_2026-07-30_2123-backend-setup-docs-and-decoupling-plan.md`).

- **Package** (`src/cc_tmux_api/`): `workers.py` (spawn/list/send/kill/status,
  jsonl freshness, registry + reboot revival + tombstone GC, claude.ai web
  URLs), `vendor_amux.py` (classifier, vendored verbatim), `server.py`
  (FastAPI: `GET /api/workers`, `POST /api/workers/action`, plus a minimal
  built-in dashboard whose worker cards carry `id="w-<session>"` — so the
  tray's `#w-<session>` deep links work against it too). Binds 127.0.0.1 only,
  no auth (same boundary rules as HQ — never add CORS). Env: BCE_WORKSPACE_DIR,
  CC_TMUX_PORT, CC_TMUX_PREFIX, CC_TMUX_WORKDIR.
- **career-coach HQ now imports it** (git-pinned dep): `hq/workers.py` is a
  thin wrapper adding worklog claims + routine reaping + the thmanyah.d
  default workdir; `hq/vendor_amux.py` deleted. One implementation, two
  frontends. career-coach commit `2dd5e88`.
- **This repo**: README "Backend setup" + `CC_SETUP_HINT` now carry the real
  `uvx git+https://github.com/FarisHijazi/cc-tmux-api` command (was
  `<owner>/<backend-repo>` TODO).

Verified live: standalone server on :8378 listed the 5 real workers,
spawn→working+web_url+meta.json→kill→.done round-trip green, prefix guard
refuses foreign sessions; `uvx git+…` cold-install runs; real HQ restarted on
the wrapper with all workers/claims/routines intact and its own
spawn→worklog-claim→kill→claim-closed round-trip green.
