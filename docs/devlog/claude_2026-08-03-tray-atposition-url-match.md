# Tray rows vanished on reopen: @<message-id> in convo URLs (v1.16.5)

User report: "hq-bc-2 didn't give a claude web URL". The backend HAD the URL
within seconds (bridgeSessionId was on line 4 of the jsonl); the tray row just
wasn't there to show it.

Root cause: `ccPaneUrl` captures chat URLs carrying Basecamp's trailing
`@<message-id>` "jump to message" marker (e.g. `/circles/48351285@10157797536`),
which tracks the last-read message and therefore CHANGES between visits.
`sameConvo` only stripped `#fragments`, so a session stored at position @A
viewed later at position @B failed the match — the tray silently hid the row
(and `ccSyncBusy` stopped matching, so the button also wouldn't spin).

Fix:
- `convoKey(u)` strips both the fragment and a trailing `@\d+` before
  comparing; `sameConvo` uses it (fixes old stored URLs too — normalization
  happens compare-side, not capture-side).
- Bonus resilience: `pollTray` now persists `web_url` into
  `chrome.storage.local.ccSessions` on first sight (it's immutable), and
  `renderTray` links the session name straight from storage — so a reopened
  tray shows claude.ai links even while the backend is unreachable.
