// Basecamp Enhancer — background service worker.
// The ONLY place that talks to the local HQ server (Thmanyah mission control).
// Content scripts are CORS-bound to the page origin, so they can't fetch
// http://127.0.0.1:8377 directly; the service worker can, because the hosts
// are declared in host_permissions (extension contexts bypass CORS for those).
// Keeping every HQ call here is deliberate: HQ has no auth, so the extension
// being the sole caller (never the page) is the security boundary.

const HQ_DEFAULT = "http://127.0.0.1:8377";

// HQ may run locally or on the thmanyah-dev VM (reached over an ssh tunnel, or
// directly at its LAN address). The base is user-configurable in the popup;
// the default keeps the historical loopback behaviour.
async function hqBase() {
  try {
    const { hqBase } = await chrome.storage.sync.get({ hqBase: HQ_DEFAULT });
    return String(hqBase || HQ_DEFAULT).replace(/\/+$/, "");
  } catch (e) {
    return HQ_DEFAULT;
  }
}

async function hqCall(path, init) {
  const base = await hqBase();
  let res;
  try {
    res = await fetch(base + path, init);
  } catch (e) {
    // TypeError: Failed to fetch => HQ not running / connection refused
    return { ok: false, error: `HQ unreachable at ${base} — is it running?` };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && (data.detail || data.error);
    return { ok: false, error: detail ? String(detail) : `HQ HTTP ${res.status}` };
  }
  return Object.assign({ ok: true }, data);
}

// GitHub link status. Default path needs NO setup: GitHub's own hovercard
// endpoint (`<pr-or-issue-url>/hovercard`, ~4 KB, needs X-Requested-With)
// fetched with the user's github.com session cookies — which is why
// https://github.com/* is a host permission. If the user pasted a token
// (chrome.storage.local.ghToken) we use one GraphQL request per batch instead
// (`resource(url:)` aliases; also tells us if the repo is archived — the
// hovercard doesn't). Either way content.js only sends URLs and gets nodes back.
// Results are cached per URL for GH_TTL so many tabs/sweeps cost one request.
const GH_TTL = 5 * 60 * 1000;
const GH_BATCH = 50;
const GH_FIELDS = "__typename ... on PullRequest{state isDraft title repository{isArchived}}"
  + " ... on Issue{state stateReason title repository{isArchived}}";
const ghCache = new Map(); // url -> {t, v}: v = GraphQL node, or null (missing / no access)

// hovercard state octicon -> the same node shape GraphQL returns
const GH_OCTICON = {
  "git-merge": { __typename: "PullRequest", state: "MERGED" },
  "git-pull-request": { __typename: "PullRequest", state: "OPEN" },
  "git-pull-request-draft": { __typename: "PullRequest", state: "OPEN", isDraft: true },
  "git-pull-request-closed": { __typename: "PullRequest", state: "CLOSED" },
  "issue-opened": { __typename: "Issue", state: "OPEN" },
  "issue-draft": { __typename: "Issue", state: "OPEN" },
  "issue-closed": { __typename: "Issue", state: "CLOSED", stateReason: "COMPLETED" },
  "skip": { __typename: "Issue", state: "CLOSED", stateReason: "NOT_PLANNED" },
};

// The state badge is the first `class="State …"` element; its svg names the state.
function ghParseHovercard(html) {
  const m = html.match(/class="State\b[^"]*"[^>]*>\s*<svg[^>]*class="octicon octicon-([a-z-]+)/);
  return (m && GH_OCTICON[m[1]]) || null;
}

async function ghHovercard(url) {
  try {
    const res = await fetch(url + "/hovercard", { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
    return res.ok ? ghParseHovercard(await res.text()) : null; // 404 = no access / gone
  } catch (e) {
    return undefined; // network: don't cache
  }
}

async function ghStatus(msg) {
  const { ghToken } = await chrome.storage.local.get({ ghToken: "" });
  const now = Date.now();
  const urls = [...new Set(msg.urls || [])].filter((u) => /^https:\/\/github\.com\//.test(u));
  const miss = urls.filter((u) => !(ghCache.get(u)?.t > now - GH_TTL));
  if (!ghToken) {
    for (let i = 0; i < miss.length; i += 6) { // a few at a time, not a burst
      const chunk = miss.slice(i, i + 6);
      const vs = await Promise.all(chunk.map(ghHovercard));
      chunk.forEach((u, j) => { if (vs[j] !== undefined) ghCache.set(u, { t: now, v: vs[j] }); });
    }
    if (miss.some((u) => !ghCache.has(u))) return { ok: false, error: "github.com unreachable" };
    return { ok: true, statuses: Object.fromEntries(urls.map((u) => [u, ghCache.get(u).v])) };
  }
  for (let i = 0; i < miss.length; i += GH_BATCH) {
    const chunk = miss.slice(i, i + GH_BATCH);
    const query = `query{${chunk.map((u, j) => `r${j}:resource(url:${JSON.stringify(u)}){${GH_FIELDS}}`).join(" ")}}`;
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${ghToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { ok: false, error: `GitHub HTTP ${res.status}` };
    const { data } = await res.json();
    // per-alias errors (no access, SSO not authorized) come back as null nodes
    chunk.forEach((u, j) => ghCache.set(u, { t: now, v: (data && data[`r${j}`]) || null }));
  }
  return { ok: true, statuses: Object.fromEntries(urls.map((u) => [u, ghCache.get(u).v])) };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ghToken) ghCache.clear(); // new token ⇒ new visibility
});

const HANDLERS = {
  // GitHub PR/issue states for a batch of canonical URLs ({ok, statuses:{url: node|null}})
  ghStatus,
  // Launch a Claude Code worker: HQ spawns `claude` in a fresh hq-* tmux
  // session and returns {ok, session, title, workdir} synchronously.
  hqSpawn: (msg) => hqCall("/api/workers/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "spawn",
      title: msg.title,
      prompt: msg.prompt,
      workdir: msg.workdir,
    }),
  }),
  // Live worker list: {ok, workers:[{session,title,status,tail,web_url,...}], claims:[...]}
  hqWorkers: () => hqCall("/api/workers"),
  // Suggested replies: the pending drafts on HQ's runway ({ok, runway:[...]})
  hqRunway: () => hqCall("/api/runway"),
  // "✍️ Draft a reply" on a thread with no draft: HQ spawns a draft-only worker
  // for this thread URL ({ok, session, reused}). Only the URL is sent.
  hqDraft: (msg) => hqCall("/api/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: String(msg.url || "") }),
  }),
  // A runway button: {action: send|edit|revise|reject, file, body?, instruction?}.
  // Only these four — the extension never gets HQ's job/autosend controls.
  hqAction: (msg) => {
    const p = msg.payload || {};
    if (!["send", "edit", "revise", "reject"].includes(p.action)) {
      return Promise.resolve({ ok: false, error: "action not allowed from the page" });
    }
    return hqCall("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: p.action, file: p.file, body: p.body, instruction: p.instruction }),
    });
  },
  // Kill a worker (HQ refuses non-hq-* sessions server-side)
  hqKill: (msg) => hqCall("/api/workers/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "kill", session: msg.session }),
  }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return; // not one of ours
  handler(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true; // keep the channel open for the async sendResponse
});
