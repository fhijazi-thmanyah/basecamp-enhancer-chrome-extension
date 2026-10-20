// GitHub link status: URL canonicalization + state mapping (content.js
// GH_LINK_RE / ghUrl / ghView) and the batched GraphQL lookup (background.js
// ghStatus). Network is stubbed unless GH_TOKEN is set, in which case the
// same lookup also runs against the real api.github.com.
//
// Run:  node tests/ghstatus_test.mjs
//       GH_TOKEN=$(gh auth token) node tests/ghstatus_test.mjs   (adds live checks)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const grabber = (file) => {
  const src = readFileSync(join(root, file), "utf8");
  return (start, end) => {
    const i = src.indexOf(start);
    if (i < 0) throw new Error(`${file}: could not find ${start}`);
    const j = src.indexOf(end, i);
    if (j < 0) throw new Error(`${file}: could not find ${end} after ${start}`);
    return src.slice(i, j + end.length);
  };
};
const load = (code) => import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const c = grabber("content.js");
const C = await load(
  c("const GH_LINK_RE =", ";\n") +
  c("function ghUrl(", "\n  }") + "\n" +
  c("function ghView(", "\n  }") + "\n" +
  "export { ghUrl, ghView };");

const b = grabber("background.js");
const B = await load(
  "let store = {}; globalThis.chrome = { storage: { local: { get: async (d) => ({ ...d, ...store }) } } };\n" +
  b("const GH_TTL =", "\nasync function ghStatus(").replace(/\nasync function ghStatus\($/, "") + "\n" +
  b("async function ghStatus(", "\n}") + "\n" +
  "export { ghStatus, ghCache, ghParseHovercard }; export const setStore = (s) => { store = s; };");

let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
  else console.log(`ok   ${name}`);
};

// --- canonicalization: every link shape collapses to /<repo>/<pull|issues>/<n>
const R = "https://github.com/acme/app";
eq("pr", C.ghUrl({ href: `${R}/pull/12` }), `${R}/pull/12`);
eq("pr files tab", C.ghUrl({ href: `${R}/pull/12/files#diff-1` }), `${R}/pull/12`);
eq("issue comment anchor", C.ghUrl({ href: `${R}/issues/7#issuecomment-99` }), `${R}/issues/7`);
eq("query string", C.ghUrl({ href: `${R}/pull/3?w=1` }), `${R}/pull/3`);
eq("dotted repo", C.ghUrl({ href: "https://github.com/acme/app.web/pull/1" }), "https://github.com/acme/app.web/pull/1");
eq("pulls list is not a PR", C.ghUrl({ href: `${R}/pulls` }), null);
eq("new issue is not an issue", C.ghUrl({ href: `${R}/issues/new` }), null);
eq("repo root", C.ghUrl({ href: R }), null);
eq("gist", C.ghUrl({ href: "https://gist.github.com/acme/1" }), null);

// --- state mapping
const pick = (v) => v && [v.state, v.icon, v.key];
const PR = (o) => ({ __typename: "PullRequest", isDraft: false, repository: { isArchived: false }, ...o });
const IS = (o) => ({ __typename: "Issue", stateReason: null, repository: { isArchived: false }, ...o });
eq("pr open", pick(C.ghView(PR({ state: "OPEN" }))), ["open", "pr", "open"]);
eq("pr draft", pick(C.ghView(PR({ state: "OPEN", isDraft: true }))), ["draft", "prDraft", "draft"]);
eq("pr merged", pick(C.ghView(PR({ state: "MERGED" }))), ["merged", "merged", "merged"]);
eq("pr closed", pick(C.ghView(PR({ state: "CLOSED" }))), ["closed", "prClosed", "closed"]);
eq("closed draft is closed", pick(C.ghView(PR({ state: "CLOSED", isDraft: true }))), ["closed", "prClosed", "closed"]);
eq("issue open", pick(C.ghView(IS({ state: "OPEN" }))), ["open", "issue", "open"]);
eq("issue completed", pick(C.ghView(IS({ state: "CLOSED", stateReason: "COMPLETED" }))), ["merged", "issueDone", "merged"]);
eq("issue not planned", pick(C.ghView(IS({ state: "CLOSED", stateReason: "NOT_PLANNED" }))), ["skip", "skip", "skip"]);
eq("issue duplicate", pick(C.ghView(IS({ state: "CLOSED", stateReason: "DUPLICATE" }))), ["skip", "skip", "skip"]);
const arch = C.ghView(PR({ state: "MERGED", title: "Fix it", repository: { isArchived: true } }));
eq("archived key", arch.key, "merged+a");
eq("archived label", arch.label, "PR merged · repo archived — Fix it");
eq("no access", C.ghView(null), null);

// --- background batching (stubbed fetch)
const realFetch = globalThis.fetch;
const calls = [];
const gqlFetch = async (url, init) => {
  calls.push(JSON.parse(init.body).query);
  const aliases = [...JSON.parse(init.body).query.matchAll(/(r\d+):resource/g)].map((m) => m[1]);
  return { ok: true, json: async () => ({ data: Object.fromEntries(aliases.map((a) => [a, a === "r1" ? null : { __typename: "PullRequest", state: "OPEN" }])) }) };
};
B.setStore({});
// --- no token: github.com hovercards with the user's session (markup copied from real responses)
const card = (cls, icon) => `<a class="Link--secondary">acme/app</a><span data-view-component="true" class="${cls}">\n  <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-${icon} mr-1">`;
eq("hc merged", B.ghParseHovercard(card("State State--merged State--small", "git-merge")), { __typename: "PullRequest", state: "MERGED" });
eq("hc draft", B.ghParseHovercard(card("State State--draft State--small", "git-pull-request-draft")).isDraft, true);
eq("hc not planned", B.ghParseHovercard(card("State State--small d-flex flex-items-center", "skip")).stateReason, "NOT_PLANNED");
eq("hc other svg first is ignored", B.ghParseHovercard('<svg class="octicon octicon-repo">' + card("State", "issue-opened")).state, "OPEN");
eq("hc garbage", B.ghParseHovercard("<html>login</html>"), null);
const hcCalls = [];
globalThis.fetch = async (url, init) => {
  hcCalls.push([url, init.headers["X-Requested-With"], init.credentials]);
  if (url.includes("/pull/404/")) return { ok: false, status: 404 };
  return { ok: true, text: async () => card("State State--merged", "git-merge") };
};
B.setStore({});
const hc = await B.ghStatus({ urls: [`${R}/pull/5`, `${R}/pull/404`] });
eq("hc request shape", hcCalls[0], [`${R}/pull/5/hovercard`, "XMLHttpRequest", "include"]);
eq("hc merged via session", hc.statuses[`${R}/pull/5`].state, "MERGED");
eq("hc 404 -> null", hc.statuses[`${R}/pull/404`], null);
globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
eq("hc network down -> not ok", (await B.ghStatus({ urls: [`${R}/pull/6`] })).ok, false);
eq("hc network down not cached", B.ghCache.has(`${R}/pull/6`), false);
B.setStore({ ghToken: "t" });
B.ghCache.clear();
globalThis.fetch = gqlFetch;
const urls = Array.from({ length: 60 }, (_, i) => `${R}/pull/${i}`);
const r = await B.ghStatus({ urls: [...urls, urls[0], "https://evil.example/pull/1"] });
eq("60 urls = 2 requests", calls.length, 2);
eq("dedup + non-github dropped", Object.keys(r.statuses).length, 60);
eq("missing alias -> null", r.statuses[`${R}/pull/1`], null);
await B.ghStatus({ urls });
eq("cache hit = no new request", calls.length, 2);

// --- live (optional): the real GraphQL endpoint, public fixtures
if (process.env.GH_TOKEN) {
  globalThis.fetch = realFetch;
  B.ghCache.clear();
  B.setStore({ ghToken: process.env.GH_TOKEN });
  const L = {
    archivedDone: "https://github.com/fregante/github-issue-link-status/issues/1",
    merged: "https://github.com/cli/cli/pull/1",
    nope: "https://github.com/acme-does-not-exist/x/pull/1",
  };
  const live = await B.ghStatus({ urls: Object.values(L) });
  eq("live ok", live.ok, true);
  eq("live archived issue", pick(C.ghView(live.statuses[L.archivedDone])), ["merged", "issueDone", "merged+a"]);
  eq("live merged pr", C.ghView(live.statuses[L.merged])?.state, "merged");
  eq("live missing repo", live.statuses[L.nope], null);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall passed");
