// Regression test for the launcher prompt (`ccPrompt` in content.js).
//
// Why this exists: workers posted to Basecamp twice while "Reply when done" was
// unchecked. Both times the cause was prompt WORDING, not code — once because
// CC_AUTO_PROMPT said "do respond" regardless of the checkbox, once because the
// unchecked branch emitted an empty string (silence reads as "no opinion", not
// as a prohibition). Neither is catchable by eye in a template literal, so the
// invariants are asserted here instead.
//
// Run:  node tests/ccprompt_test.mjs      (no deps; exits non-zero on failure)
//
// It extracts ccPrompt + its constants out of content.js rather than importing
// it, because content.js is one IIFE that expects a live `chrome` and a DOM.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content.js"), "utf8");

const grab = (start, end) => {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`content.js: could not find ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`content.js: could not find ${end} after ${start}`);
  return src.slice(i, j + end.length);
};

const code =
  grab("const CC_AUTO_PROMPT =", 'destructive";') + "\n" +
  grab("const CC_DISCLOSE_PREFIX =", 'Claude";') + "\n" +
  grab("function ccPrompt(", "\n  }") + "\n" +
  "export { ccPrompt, CC_AUTO_PROMPT, CC_DISCLOSE_PREFIX };";

const m = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);

let failures = 0;
const check = (ok, msg) => { if (!ok) { console.error("FAIL:", msg); failures++; } };

// The disclosure line is duplicated in career-coach scripts/bc_send.py
// (DISCLAIMER) and must stay byte-identical — the sender prepends it.
check(m.CC_DISCLOSE_PREFIX === "هذه رسالة مؤتمتة 🤖 من Claude",
  `CC_DISCLOSE_PREFIX drifted: ${m.CC_DISCLOSE_PREFIX}`);

// The empty-textarea default must not have an opinion about replying; that is
// the checkbox's job alone.
check(!/respond|reply/i.test(m.CC_AUTO_PROMPT),
  "CC_AUTO_PROMPT mentions responding — it must leave that to the checkbox");

for (const reply of [true, false]) {
  for (const disclose of [true, false]) {
    const out = m.ccPrompt(
      m.CC_AUTO_PROMPT, "oneshot", "https://3.basecamp.com/x/circles/1", reply, disclose,
    );
    const at = `(reply=${reply} disclose=${disclose})`;

    check(!/\/basecamp\b/.test(out),
      `${at} points at /basecamp — collides with the 37signals plugin skill; use /bc-thread`);

    if (!reply) {
      check(/Do NOT post anything to Basecamp/.test(out),
        `${at} lacks an explicit prohibition — an omitted instruction is not a "no"`);
      check(!/--no-disclaimer/.test(out),
        `${at} mentions disclosure while posting is forbidden — self-contradictory`);
    } else {
      check(/SHORT/.test(out), `${at} lost the length rule`);
      check(disclose ? !/--no-disclaimer/.test(out) : /--no-disclaimer/.test(out),
        `${at} disclosure clause should appear only when the box is unchecked`);
      check(!/Start EVERY message/.test(out),
        `${at} re-introduced disclaimer boilerplate — the SENDER prepends it, never the model`);
    }
  }
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("ccPrompt: all checks passed");
