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

const HANDLERS = {
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
