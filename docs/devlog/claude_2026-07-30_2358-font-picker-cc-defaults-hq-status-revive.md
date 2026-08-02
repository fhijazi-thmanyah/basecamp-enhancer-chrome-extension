# Font picker + CC popover defaults + HQ status/revive (v1.15.0)

Extension side (this repo) + spawner side (career-coach `72a0e02`) shipped together.

## Extension (v1.15.0)

- **Font is now a picker, not a toggle** (`bcFont`: `"" | plex | sans | seriftext |
  serifdisplay`, default `plex`). v1.14.0's boolean `thmanyahFont` is gone. styles.css
  maps the choice to a family via `--bce-font`; `fonts/` bundles IBM Plex Sans Arabic
  (5 weights, OFL) + the three ThmanyahFont-repo families (Regular/Medium/Bold each,
  OTF→woff2 via fonttools, weight-ranged so 300–900 all resolve). Only the selected
  family is ever downloaded (lazy @font-face).
- **CC popover defaults**: Watch = **one-shot** (was 15min), **"Reply when done"
  checked** by default.
- **Tray**: general "Open HQ ↗" header link removed (explicitly unwanted); per-row
  "HQ ↗" deep links remain.
- `CC_SETUP_HINT`/README: `BCE_WORKSPACE_DIR` is the **base** dir (default
  `~/.basecamp-enhancer`); sessions live under `$BCE_WORKSPACE_DIR/workspace/<sid>/`.

## HQ (career-coach commit 72a0e02) — fixes two user-reported bugs

1. **"Spinner stops while the worker is clearly working"** — the pane-text classifier
   under-reports `working` (long tool runs scroll the spinner out of the capture
   window). `status_of` now upgrades idle/unknown → working while the session **jsonl
   was appended < 60 s ago** (path known from `@hq_sid` + `@hq_workdir`); no Claude
   Code hooks needed — the jsonl is the activity feed. `/api/workers` now also exposes
   `jsonl_age_s`, `claude_session_id`, `workdir`.
2. **"Sessions never re-spawned after reboot"** — the tmux server (HQ's registry) dies
   with the machine. Task spawns now also write
   `$BCE_WORKSPACE_DIR/workspace/<sid>/meta.json` (+ the worker prompt names that dir
   as its scratch space and instructs `touch .done` when truly finished; ✕/kill
   tombstones too). On HQ startup `resume_registered()` revives non-tombstoned
   sessions < 5 days old with `claude --resume <sid>` under the **same tmux name →
   same claude.ai URL**; sessions whose spawn prompt contained `/loop` get a literal
   `continue` typed in ~10 s later so the watch resumes; one-shots idle until steered.
   `.done` dirs GC'd after 14 days. Routines never register (their tick respawns them).

Verified live end-to-end (spawn → registry → tmux-kill → HQ restart → revive with
same URL + nudge answered → API kill → `.done`). Grill-me decisions recorded here:
registry at default base (not inside career-coach), worker cwd stays career-coach
(skills resolve from cwd), revive-all-non-tombstoned, nudge loops only, 60 s
freshness, 14-day GC.
