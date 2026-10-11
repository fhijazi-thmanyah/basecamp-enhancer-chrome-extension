# 2026-08-27 — the HQ field that saved nothing, and the launcher that vanished

Three symptoms reported together, three unrelated causes. See @../../CLAUDE.md for
the invariants this added.

## 1. Uncommitted `popup.html`/`popup.js` — stale, dropped

The working tree held the **pre-`3368b50`** single-text-field HQ editor, i.e. the exact
code that commit replaced (including the debounced `setTimeout` around
`chrome.permissions.request`, which can never be granted — Chrome requires a user
gesture). It came back via `git pull --rebase --autostash` reapplying local edits over
the newer commit. Stashed rather than discarded:

    git stash list   # "stale pre-3368b50 single-input HQ popup (superseded by the HQ list commit)"

## 2. "the HQ server URL doesn't save" — popup.js ran before the markup existed

`3368b50` appended the HQ block **after** `<script src="popup.js">`:

    <script src="vendor/posthog.js"></script>
    <script src="popup.js"></script>
      <div class="subrow__foot"> … #hqPick #hqBase #hqAdd … </div>

popup.js is a classic script (no `defer`, no `DOMContentLoaded` wrapper), so it executes
at that point in the parse. Every `getElementById` for the HQ controls returned null and
the first top-level `hqPick.addEventListener` threw, killing the rest of the file. The
field *rendered*, so it looked fine — it just had no code behind it.

Reproduced and fixed under a headless harness (real popup.html + a `chrome.*` stub, the
technique `scripts/screenshot-popup.sh` already uses):

    before: {"opts": 0, "errors": ["Script error."]}
    after : picks populate, sync.set {"hqBase": "http://thmanyah:8377"},
            perm.request ["http://thmanyah:8377/*"]

The block now lives in `<details class="subrow" id="hqEditor">` directly under `#ccRow`,
before the scripts, and popup.js hides it behind the same `bceCcFlags.launcher` gate as
the launcher toggle.

## 3. "where did the Claude Code launcher button go" — identified as `bc:<id>`, not by email

`chrome.storage.local` for the extension was recreated at 14:49 today
("Creating DB … since it was missing" in the LevelDB `LOG`), i.e. the extension was
re-added — so the `bceCcFlags` cache was gone and the gate had to be resolved live.
It resolved **false**, because the only thing in that store was:

    bceWho = {"email":"","id":"52082712","name":""}

With no email, `phIdentity` falls back to `posthog.identify("bc:52082712")`, and both
flags target `email`. Verified directly against the proxy:

    distinct_id "faris.hijazi@thmanyah.com" → cc-launcher enabled=true  (condition_match)
    distinct_id "bc:52082712"               → cc-launcher enabled=false ("No matching condition set")

The email scrape required an `a[href*="/my/profile"]` anchor to be present in the DOM at
the moment `phApply` ran; it now falls back to `<origin>/<account>/my/profile` derived
from `location.pathname`. (The empty result was never cached permanently — the cache is
only reused `if (st.bceWho.email)` — so the retry path already existed.)

Optional belt-and-braces, **not** applied: add `basecamp_person_id = 52082712` as a second
condition set on flags 797772/797778 so the gate survives a failed email lookup entirely.

## 4. `http://thmanyah:8377` — the daemon binds loopback; you already tunnel to it

cc-tmux-api **is** the service on `service@thmanyah`, but it binds loopback only:

    service@thmanyah $ ss -ltnp | grep 8377
    LISTEN 0 2048 127.0.0.1:8377 0.0.0.0:* users:(("uvicorn",pid=24145,fd=15))

So no host:port outside that box can ever reach it — not `thmanyah:8377` (MagicDNS →
100.120.250.112, pings, port closed) and not `192.168.0.43:8377` (in the extension's
`host_permissions` **and** in popup.js's `HQ_SEED`, where it is misleading: it cannot
work by design). That bind is the security boundary — the API has no auth and spawns
`--dangerously-skip-permissions` workers, so opening it to the tailnet is not the fix.

It is already reachable the intended way. `~/Library/LaunchAgents/
com.farishijazi.thmanyah-hq-tunnel.plist` runs

    ssh -N -L 127.0.0.1:8377:127.0.0.1:8377 service@192.168.0.43

so **`http://127.0.0.1:8377` on the Mac IS thmanyah's cc-tmux-api** — same worker list
over the tunnel and over ssh (`['hq-morning-brief-1']`), `/openapi.json` title
`cc-tmux-api`. The extension needs no new address at all.

### Fix: `tailscale serve`, not a wider bind

Binding uvicorn to `0.0.0.0` would reach the LAN as well as the tailnet. `tailscale
serve` listens on the tailscale interface **only** and proxies to the same loopback
port, so the daemon's bind never changes:

    service@thmanyah $ sudo tailscale serve --bg --http=8377 http://127.0.0.1:8377
    service@thmanyah $ sudo tailscale serve status
    http://thmanyah:8377 (tailnet only)
    http://thmanyah.tail8678c.ts.net:8377 (tailnet only)
    |-- / proxy http://127.0.0.1:8377

Verified from the Mac: `curl http://thmanyah:8377/api/workers` → 200 via 100.120.250.112,
`['hq-morning-brief-1']`. The config persists in `/var/lib/tailscale/tailscaled.state`,
so it survives a reboot. To undo: `tailscale serve --http=8377 off`.

### Extension changes that follow

- **`http://192.168.0.43:8377/*` dropped from `host_permissions`.** It could never
  answer (loopback bind), and it was never covered by the permission justification in
  `docs/store-listing.md`, which describes loopback only. The manifest and that
  justification now agree.
- **`HQ_SEED` seeds `http://thmanyah:8377`** instead of the LAN IP.
- **`hqEnsurePerm(url, ok)`** — activation, not just "add", now requires the host
  permission. The old `hqPick.change` handler assumed "the origin was already granted
  when it was added", which is false for *seeded* entries: they were never added, so
  selecting one stored a base the service worker has no permission to fetch. Both the
  select and the add button route through the one helper (both are real user gestures,
  which `permissions.request` requires).

### Still open on the Mac

1. The tunnel dials the **LAN** address, which dies off office wifi —
   `/tmp/thmanyah-hq-tunnel.err` is a wall of
   `ssh: connect to host 192.168.0.43 port 22: Operation timed out`. Dialling
   `service@thmanyah` (Tailscale MagicDNS, verified working) makes it durable.
2. `com.farishijazi.thmanyah-hq` — the **local** career-coach HQ — wants the same
   `127.0.0.1:8377`. It is currently unloaded (`launchctl list` shows only the tunnel;
   its last log ends in a `tmux list-panes` 10 s timeout and a shutdown), so there is no
   live collision, but two agents claiming one port is a trap: whichever binds first
   wins, and the tunnel's `ExitOnForwardFailure=yes` + `KeepAlive` turns losing into a
   restart loop.
