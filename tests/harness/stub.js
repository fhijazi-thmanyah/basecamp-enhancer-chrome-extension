// Chrome reports background/occluded tabs as hidden; the runway must still render (v1.25.1)
Object.defineProperty(document, "hidden", { get: () => true });
Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
window.__log = [];
const drafts = [
  { file: "a.md", kind: "comment", target: "https://app.basecamp.com/4149173/buckets/1/messages/222#__recording_333", project: null, age: "2h",
    body: "هلا محمود، تمام نمشي بحل Databricks + Metabase\n\n- الجدول جاهز\n- باقي الداشبورد" },
  { file: "b.md", kind: "chat", target: "10184496423", project: "48437449", age: "3d", body: "هلا محمد، رح اخلص قبل نهاية المهلة ان شاء الله" },
  { file: "c.md", kind: "comment", target: "https://app.basecamp.com/4149173/buckets/9/card_tables/cards/777", project: null, age: "5d", body: "unrelated card reply" },
];
const ph = new Proxy(function () {}, { get: () => ph, apply: () => ph });
window.posthog = ph;
window.chrome = {
  runtime: {
    id: "stub",
    getManifest: () => ({ version: "test" }),
    getURL: (p) => "/ext/" + p,
    sendMessage: async (msg) => {
      window.__log.push(msg);
      if (msg.type === "hqRunway") return { ok: true, runway: drafts };
      if (msg.type === "ghStatus") {
        // one fixture per state the GitHub-link-status icon can show (keyed by PR/issue number)
        const N = (n) => ({ __typename: n.t || "PullRequest", isDraft: false, stateReason: null, title: "fixture", repository: { isArchived: false }, ...n });
        const fx = { 1: N({ state: "OPEN" }), 2: N({ state: "OPEN", isDraft: true }), 3: N({ state: "MERGED" }), 4: N({ state: "CLOSED" }),
          5: N({ t: "Issue", state: "OPEN" }), 6: N({ t: "Issue", state: "CLOSED", stateReason: "COMPLETED" }),
          7: N({ t: "Issue", state: "CLOSED", stateReason: "NOT_PLANNED" }), 8: N({ state: "MERGED", repository: { isArchived: true } }) };
        return { ok: true, statuses: Object.fromEntries(msg.urls.map((u) => [u, fx[u.split("/").pop()] || null])) };
      }
      if (msg.type === "hqDraft") {
        // HQ's worker "parks" a draft for this thread a moment later
        setTimeout(() => drafts.push({ file: "d.md", kind: "comment", target: "https://app.basecamp.com/4149173/buckets/1/messages/222", project: null, age: "0m", body: "مسودة جديدة" }), 1000);
        return { ok: true, session: "hq-draft-reply-messages-222-1", reused: false };
      }
      if (msg.type === "hqAction") {
        const p = msg.payload;
        if (p.action === "send" || p.action === "reject") { const i = drafts.findIndex((d) => d.file === p.file); drafts.splice(i, 1); }
        return { ok: true, body: p.action === "edit" ? p.body : "revised: " + p.instruction };
      }
      return { ok: true, workers: [] };
    },
  },
  storage: {
    sync: { get: (d, cb) => cb(typeof d === "object" ? d : {}), set: () => {} },
    local: { get: (k, cb) => cb({ bceCcFlags: { launcher: true, hqLink: true }, ccSessions: [] }), set: () => {} },
    onChanged: { addListener: () => {} },
  },
};
