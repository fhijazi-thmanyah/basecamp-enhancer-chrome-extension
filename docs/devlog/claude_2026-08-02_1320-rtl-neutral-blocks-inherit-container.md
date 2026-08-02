# RTL: neutral-only blocks inherit the container direction (v1.16.2)

User report after v1.16.1: "…"-placeholder blockquotes in an Arabic doc showed
the quote bar on the right (fixed) but the "…" text hugged the LEFT edge.

Cause: those blocks contain only neutral characters (no letters), so
`majorityDir` counted 0 vs 0 ⇒ kept `dir="auto"` — and `dir="auto"` with zero
strong characters defaults to **LTR**, detaching the content from its bar.

Fix: `majorityDir(el, fallback)` — neutral-only or tied text returns the
fallback, and `setAutoDir` passes the container's own decided direction as the
fallback for its blocks. So "…" placeholders in an Arabic doc go rtl, while the
same "…" in an English doc stays ltr. Verified with synthetic markup: neutral
blockquote/p ⇒ rtl in Arabic container, auto/ltr in English container; Arabic
and English paragraphs unchanged.
