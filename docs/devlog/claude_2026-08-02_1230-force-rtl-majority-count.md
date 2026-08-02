# Force RTL: majority count instead of first-strong-char (v1.16.0)

User report (with screenshot): a majority-Arabic paragraph beginning
"10. english first …" rendered LTR. Root cause: `dir="auto"` resolves from the
FIRST strong character, and the lexxy composer writes `<p dir="auto">` per
paragraph — so any Arabic paragraph that opens with an English word or number
lays out LTR, and our old `setAutoDir` ("only set when no dir exists") never
touched those paragraphs at all.

Change (content.js, feature renamed **Force RTL** in the popup):

- `majorityDir(el)` counts Arabic vs Latin letters (`RTL_CHARS`/`LTR_CHARS`
  ranges incl. presentation forms); more Arabic ⇒ `dir="rtl"`, else `dir="auto"`.
- Applied to each `RTL_SELECTORS` container AND its `RTL_BLOCK_SEL` blocks
  (`p,li,ul,ol,h1-h6,blockquote,[dir='auto']`) — the per-block pass is what
  fixes composer-written `<p dir="auto">`.
- Editables still always get plain `dir="auto"` (typing must self-direct).
- `setDir` may now override an existing `dir="auto"` (never explicit ltr/rtl);
  `data-bce-dir` therefore stores the ORIGINAL value ("none" = no attribute,
  legacy "1" treated as none) and `removeAutoDir` restores it exactly.

Verified with synthetic markup in the live tab (standalone copy of the new
functions): english-first Arabic ⇒ rtl, all-English ⇒ untouched auto,
explicit `dir=ltr` ⇒ untouched, checklist `ul/li` ⇒ rtl, idempotent double-run,
revert restores `auto`/absent exactly. Live re-verify after extension reload.
