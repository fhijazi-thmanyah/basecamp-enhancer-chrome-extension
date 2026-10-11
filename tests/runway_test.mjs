// Matching logic for the inline suggested-replies feature (rwTargetUrl /
// rwMatches / rwCommentId in content.js): which draft belongs on which page.
// A wrong "match" puts a reply card on the wrong thread, where one Send click
// posts it to the wrong people — so the cases below are the real draft shapes
// HQ's outbox holds (comment targets on app.basecamp.com, chat targets as a
// bare room id + bucket, pings as /circles/<bucket>).
//
// Run:  node tests/runway_test.mjs      (no deps; exits non-zero on failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "content.js"), "utf8");
const grab = (start, end) => {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`content.js: could not find ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`content.js: could not find ${end} after ${start}`);
  return src.slice(i, j + end.length);
};
const code =
  grab("function rwTargetUrl(", "\n  }") + "\n" +
  grab("function rwMatches(", "\n  }") + "\n" +
  grab("const rwCommentId =", ";\n") +
  "export { rwTargetUrl, rwMatches, rwCommentId };";
const m = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

let failures = 0;
const eq = (name, got, want) => {
  if (got !== want) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
};

const O = "https://3.basecamp.com";
const card = { kind: "comment", target: "https://app.basecamp.com/4149173/buckets/46684995/card_tables/cards/10321404505", project: null };
const reply = { kind: "comment", target: "https://app.basecamp.com/4149173/buckets/1/messages/222#__recording_333" };
const camp = { kind: "chat", target: "5096055703", project: "28320229" };
const ping = { kind: "chat", target: "10184496423", project: "48437449" };

eq("comment url is rewritten onto the page origin", m.rwTargetUrl(card, O, "4149173"), `${O}/4149173/buckets/46684995/card_tables/cards/10321404505`);
eq("chat url is built from bucket + room", m.rwTargetUrl(camp, O, "4149173"), `${O}/4149173/buckets/28320229/chats/5096055703`);
eq("chat url needs the account", m.rwTargetUrl(camp, O, ""), "");

eq("card page matches", m.rwMatches(card, `${O}/4149173/buckets/46684995/card_tables/cards/10321404505`), true);
eq("card page with fragment matches", m.rwMatches(card, `${O}/4149173/buckets/46684995/card_tables/cards/10321404505#__recording_9`), true);
eq("a longer id that merely starts the same does not", m.rwMatches(card, `${O}/4149173/buckets/46684995/card_tables/cards/103214045050`), false);
eq("another card does not", m.rwMatches(card, `${O}/4149173/buckets/46684995/card_tables/cards/10321404506`), false);
eq("the project page does not", m.rwMatches(card, `${O}/4149173/projects/46684995`), false);
eq("a comment draft never matches a chat", m.rwMatches(card, `${O}/4149173/buckets/46684995/chats/10321404505`), true === false);

eq("campfire room matches", m.rwMatches(camp, `${O}/4149173/buckets/28320229/chats/5096055703`), true);
eq("campfire with last-read marker matches", m.rwMatches(camp, `${O}/4149173/buckets/28320229/chats/5096055703@123`), true);
eq("other room does not", m.rwMatches(camp, `${O}/4149173/buckets/28320229/chats/5096055704`), false);
eq("ping matches via /circles/<bucket>", m.rwMatches(ping, `${O}/4149173/circles/48437449`), true);
eq("ping in the sidebar frame matches", m.rwMatches(ping, `${O}/4149173/my/sidebar/circles/48437449`), true);
eq("another ping does not", m.rwMatches(ping, `${O}/4149173/circles/484374490`), false);
eq("a chat draft never matches its bucket's card", m.rwMatches(camp, `${O}/4149173/buckets/28320229/card_tables/cards/1`), false);

eq("comment id from fragment", m.rwCommentId(reply), "333");
eq("no fragment, no comment id", m.rwCommentId(card), undefined);
eq("reply-to-comment draft matches its message page", m.rwMatches(reply, `${O}/4149173/buckets/1/messages/222`), true);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("all runway tests passed");
