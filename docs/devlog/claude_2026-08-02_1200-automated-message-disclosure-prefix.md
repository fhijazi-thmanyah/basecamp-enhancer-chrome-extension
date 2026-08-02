# Automated-message disclosure prefix (v1.15.1)

User report: workers' Basecamp DMs/replies carried no hint they were automated.

- New `CC_DISCLOSE_PREFIX` = `هذه رسالة مؤتمة 🤖 من Claude` (user-chosen string,
  verbatim) in `content.js`.
- New popover checkbox **"Mention that this is an automated message"** (label shows
  the prefix), **checked by default**, rendered right under "Reply when done"
  (same `bce-ccpop__reply` row class — no CSS changes needed).
- `ccPrompt` gained a 5th param `disclose`; when set it appends: *"Start EVERY
  message you post to Basecamp with this exact line, then a blank line:
  <prefix>"* — so the instruction covers loop-watch responses too, not just the
  reply-when-done reply. The prefix is applied by the **worker** (it's a prompt
  instruction), not by the extension — the extension never posts messages itself.

No storage key: the checkbox is per-launch UI state like the Watch segmented
control, defaulting on each time the popover opens.
