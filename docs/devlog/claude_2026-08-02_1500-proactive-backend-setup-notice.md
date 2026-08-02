# Proactive backend-setup notice in the CC popover (v1.16.4)

Previously the `uvx git+…` setup hint only appeared AFTER a failed launch.
Now the popover shows it the moment it opens with no backend running:
`pollTray` always pings `hqWorkers` (it used to early-return when the tray
had no rows, so a fresh user with zero sessions never got a health check) and
sets a `setup`-kind status (amber) with `CC_SETUP_HINT` when the error
matches `/unreachable/i`. The notice self-clears on a later poll once the
backend is reachable, and never overwrites an in-flight launch status
(busy/ok/err). Styling: `.bce-ccpop__status[data-kind="setup"]`.
