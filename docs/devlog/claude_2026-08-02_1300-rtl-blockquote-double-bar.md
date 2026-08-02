# RTL blockquote double-bar fix (v1.16.1)

User report after v1.16.0: "markdown quotes are now duplicated".

Diagnosis (probed live against real Basecamp CSS — their stylesheets are
CORS-blocked from `document.styleSheets`, so behavior was isolated empirically):

- An isolated `blockquote` outside `.formatted_content` has `border-left: 3px`
  only, in BOTH directions — Basecamp's base rule is physical.
- A fresh attribute-less `blockquote` inside a `dir=rtl` container gets
  `border-left: 3px` AND `border-right: 3px` — Basecamp's RTL rule (keyed on
  ancestor direction) ADDS the right bar without clearing the left.

So the double bar is a pre-existing Basecamp bug that only shows when a content
container is RTL — v1.16.0's majority-count force made that the common case and
surfaced it. Not a logic bug in the majority counting itself.

Fix: one scoped rule in `styles.css` —
`[data-bce-dir][dir="rtl"] blockquote { border-left: 0 !important }` — keeps
only the right-side bar. Scoped to our own `data-bce-dir` tag so toggling the
feature off reverts fully; a blockquote we force RTL with no RTL ancestor keeps
its single left bar (no right bar exists there to pair with).

Verified live (injected rule + synthetic quotes in the real page): single right
bar on all RTL quotes, english-first paragraph RTL, control blockquote outside
content untouched.
