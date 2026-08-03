# Public repo hygiene: no machine-local paths (v1.16.6)

The repo moved to a public GitHub home, so the hardcoded
`CC_WORKDIR = /Users/<user>/…/career-coach` had to go:

- content.js no longer defines or sends a workdir with `hqSpawn`; the backend
  applies its own default (standalone cc-tmux-api: `$CC_TMUX_WORKDIR`/`$HOME`;
  HQ pins career-coach server-side in its private wrapper — where the worker
  skills resolve from).
- Git HISTORY was scrubbed with git-filter-repo (`/Users/<user>` → `~` in all
  blobs) and force-pushed, since the old commits carried the path too.
