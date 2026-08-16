# 2026-08-13 — "it still sends when the checkbox is off": one sender, one disclaimer, one skill name

Faris: the launcher sometimes posts to Basecamp even with the **"Reply when done"**
checkbox unchecked, and the rules are scattered and inconsistent. Spans two repos
(`basecamp-enhancer`, `career-coach`).

## Root causes found (five, all real)

1. **`CC_AUTO_PROMPT` contradicted the checkbox.** The empty-textarea default — the
   *first-class* launch mode — literally said *"if there's something to respond with,
   **do respond**"*. With the box unchecked the worker was still instructed to reply.
   Most likely single cause.
2. **Unchecking emitted an empty string.** `ccPrompt`'s `reply` clause was
   `replyWhenDone ? "…reply…" : ""`. Silence is not a prohibition; an agent asked a
   question inside the thread answered it.
3. **Pings/circles had NO gate at all.** `bc_thread_watch.py send` posted chat lines via
   `basecamp chat post` **directly** — no disclaimer, no outbox, no toggle. The launcher
   is used mostly on pings, and `/basecamp`'s watch mode pointed straight at that
   subcommand. Its justification ("bc_send.py can't reach pings") was **false**:
   `bc_send.py chat` passed `--chat`, a flag `basecamp chat post` does not have
   (it is `-p/--project` + `-r/--room`), so that path had simply never been run.
4. **`/basecamp` was a name collision.** The worker prompt said "Use /basecamp".
   The 37signals plugin skill claims that exact trigger in its frontmatter
   (`# Direct invocations: - basecamp - /basecamp`) and describes itself as
   *"Full API coverage … use for ANY Basecamp question or action"*, documenting
   `basecamp comment` / `chat post` with no mention of the guard. career-coach's
   same-named skill described itself as read-only lookup. On a "reply" task the
   plugin's description wins — the model reached for the unguarded twin.
5. **Two skills sanctioned a bypass in writing** — `bc-reply` and `basecamp-cli` both
   said that if Faris asks for "send as me, no disclaimer", pass the body through
   `basecamp comment` directly.

Also: two different disclaimer strings (a worker obeying both would double-prefix), and
the extension's short one had a typo — **مؤتمة** for **مؤتمتة**.

## Decisions (Faris, via /grill-me)

- **Soft gates, not hard ones.** `cc-tmux-api`'s spawn API is `{title, prompt, workdir}`
  with no env passthrough, so the prompt is the only channel. A hard gate would have
  meant an API change + a policy file + a PreToolUse hook; explicitly rejected. And
  honestly: a worker running as the user with `--dangerously-skip-permissions` can
  bypass any local gate — what we can remove is every *sanctioned* path.
- **HQ / `config/autosend.json` is out of scope** — it is HQ's rollout brake, not the
  extension's gate. The extension must not read or depend on it.
- **One sender for every channel**, disclaimer owned by code, `/basecamp` renamed.

## Changes

**basecamp-enhancer** (shipped in v1.21.0 alongside the popup/perf work), `content.js` only, no UI change:
- `CC_AUTO_PROMPT`: dropped the "do respond" clause.
- Reply OFF now states the prohibition explicitly, and names the confusion an agent
  would otherwise make: Faris steering *this session* is an instruction; someone asking
  inside the Basecamp thread is not.
- Disclosure ON emits nothing (code prepends it); OFF emits `--no-disclaimer`, and is
  suppressed when replying is off so the prompt can't contradict itself.
- `CC_DISCLOSE_PREFIX` typo fixed; `Use /basecamp` → `Use /bc-thread`.

**career-coach:**
- `.claude/skills/basecamp/` → **`.claude/skills/bc-thread/`** (`git mv`, `name:` +
  description rewritten to cover reply routing and state that posting is guarded).
- `bc_send.py`: `DISCLAIMER` = the short corrected line; `with_disclaimer` is now
  **idempotent** (skips if the body already starts with it) and takes `suppress=`;
  new `--no-disclaimer`; **`chat` subcommand fixed** to `--in <project> --room <room>`;
  stopped reading the now-dead `disclaimer` config key.
- `bc_thread_watch.py`: deleted the direct-post branch — `cmd_send` routes **every**
  target through `bc_send.py` (net −12 lines).
- `bc-reply` + `basecamp-cli`: "send as me, no disclaimer" exceptions **deleted**;
  the false "circles post directly" routing note rewritten.
- `CLAUDE.md` + `README.md`: `/basecamp` → `/bc-thread` everywhere, guarded-sending
  section rewritten (one sender, idempotent disclaimer, cross-ref to the extension
  constant).

## Verification

- `py_compile` on both scripts; `bc_send.py status` and `chat --help` render.
- Unit checks (scratchpad): disclaimer applied once, **idempotent on re-application**,
  suppressed by `--no-disclaimer`; `basecamp_send("chat", …)` builds
  `["basecamp","chat","post",body,"--in",project,"--room",room]`.
- `ccPrompt` exercised for **all four** checkbox combinations, asserting: no "do
  respond" in `CC_AUTO_PROMPT`, an explicit prohibition when reply is off, no
  disclosure boilerplate when it's on, `--no-disclaimer` present exactly when it
  should be, and no surviving `/basecamp` reference. All pass.
- **Not verified live** — no test worker was spawned and nothing was posted to
  Basecamp. The chat path's real round-trip (`bc_send.py chat`) is still unexercised
  against the API; it is flag-correct per `basecamp chat post --help` but has never
  actually posted.

## Follow-up (same day): collapse the duplication, shorten the prompt

Fixing the contradiction did not fix *what generates* contradictions — the send rule
was stated in **eight** files, and two of those copies were the ones that drifted.

- **One copy.** `basecamp-cli/SKILL.md` → "Sending" is now marked as the only copy;
  `bc-thread`, `bc-reply`, `qa-fix`, `data-question` and career-coach `CLAUDE.md`
  replaced their restatements with an `@`-pointer to it. Rule mentions outside the
  canonical file: **45 → 30**, and the remaining ones are pointers or architecture
  facts, not instructions. `brief` and `discover` were already one-liners.
- **Shorter prompt.** Dropped the "if you have no idea what to do…" preamble — being
  blocked is already covered by cc-tmux-api's `--append-system-prompt`; only the
  macOS-notification affordance is additive. Emitted prompt per launch:
  **363 → 294 chars** (reply on), **587 → 518** (reply off). −69 chars every launch.

Net ≈ **−10 lines**, not the ~−40 first estimated: the duplication was *semantic*
(eight statements of one rule) rather than bulky prose. The line saving is small;
removing five places that can independently drift is the actual win.

## Handoff — state as of 2026-08-16

**Shipped and pushed.**
- `basecamp-enhancer` — `be76190` (v1.21.0, bundled with another session's popup/perf
  work) + `dccce7b` (length rule). Pushed to `fhijazi-thmanyah/basecamp-enhancer-chrome-extension`.
- `career-coach` — `c7e9b08`. Pushed to `FarisHijazi/basecamp-coach`.
- Regression test added: `tests/ccprompt_test.mjs` (verified it fails on a reintroduced
  `/basecamp`). Run after ANY `ccPrompt` edit.

**Working, verified:** all four checkbox combinations of the launcher prompt; disclaimer
applied once and idempotent on re-application; `--no-disclaimer` suppresses it;
`basecamp_send("chat", …)` builds the right argv; no restatement of the sending rules
survives outside the canonical `basecamp-cli/SKILL.md` → "Sending"; every `@`-pointer to
it resolves; `py_compile` + JS parse clean on all touched files.

**NOT verified — the honest gap:**
- **`bc_send.py chat` has still never posted to the real API.** It is flag-correct per
  `basecamp chat post --help` and unit-tested for command shape only. The first ping
  reply through it will be its first live run — expect to debug that, not to trust it.
- No test worker was spawned; nothing was posted to Basecamp end-to-end. The soft gate
  ("Reply when done" off ⇒ worker doesn't post) has **never been observed working** — it
  is reasoned about, not demonstrated. That is the single most valuable next test:
  launch a worker on a real ping with the box unchecked and confirm silence.

**Open / deliberately not done:**
- The disclosure checkbox survives by Faris's explicit call. Dropping it remains the
  single biggest available simplification (a UI row, a prompt branch, a CLI flag and a
  code path, to express "post as a bot without admitting it").
- Gates are SOFT by decision. A worker with `--dangerously-skip-permissions` can still
  bypass them; what was removed is every *sanctioned* path. If a bypass happens again,
  the fix is not more prompt text — it is the hard gate that was scoped and rejected
  (cc-tmux-api env passthrough + a per-session policy + a PreToolUse hook).
- `career-coach` was 6 commits ahead of origin from OTHER sessions at handoff time —
  not mine, not pushed by me.

## Note for Faris

`config/autosend.json` is currently **`{"enabled": true}`** — autosend is LIVE, and as
of this change that now covers pings too. It is untracked by git, so there is no record
of who flipped it or when. Out of scope per your call, but you should know.
