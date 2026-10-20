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

// GitHub link status: one GraphQL request resolves a whole batch of PR/issue
// URLs (`resource(url:)` aliases). The token lives in chrome.storage.local and
// never leaves this worker — content.js only sends URLs and gets states back.
// No host permission needed: api.github.com answers CORS for any origin.
// Results are cached per URL for GH_TTL so many tabs/sweeps cost one request.
const GH_TTL = 5 * 60 * 1000;
const GH_BATCH = 50;
const GH_FIELDS = "__typename ... on PullRequest{state isDraft title repository{isArchived}}"
  + " ... on Issue{state stateReason title repository{isArchived}}";
const ghCache = new Map(); // url -> {t, v}: v = GraphQL node, or null (missing / no access)

async function ghStatus(msg) {
  const { ghToken } = await chrome.storage.local.get({ ghToken: "" });
  if (!ghToken) return { ok: false, error: "no-token" };
  const now = Date.now();
  const urls = [...new Set(msg.urls || [])].filter((u) => /^https:\/\/github\.com\//.test(u));
  const miss = urls.filter((u) => !(ghCache.get(u)?.t > now - GH_TTL));
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
