// Popup: reflect stored settings and write changes back. The content script
// listens on chrome.storage.onChanged and applies/reverts each feature live.

// Feature gate: the Claude Code launcher toggle row is shown only for users
// whose PostHog `cc-launcher` flag is on. The popup never loads flags itself —
// content.js resolves them and caches into chrome.storage.local.bceCcFlags.

const DEFAULT_EMOJIS = ["👍", "👏", "🙌", "❤️", "😂", "😊", "🎉", "🚀"];
// keep in sync with content.js DEFAULT_MENU_ITEMS
const DEFAULT_MENU_ITEMS = [
  { key: "reply", label: "Reply", on: true },
  { key: "edit", label: "Edit", on: true },
  { key: "bookmark", label: "Bookmark", on: true },
  { key: "bubble up", label: "Bubble up", on: true },
  { key: "copy link", label: "Copy link", on: true },
  { key: "download", label: "Download attachments", on: true },
  { key: "notified", label: "Notified…", on: true },
  { key: "delete", label: "Delete", on: true },
  { key: "put in the trash", label: "Put in the trash", on: true },
];
const DEFAULTS = {
  timeLabels: true,
  rtl: true,
  inlineReactions: true,
  inlineMenus: true,
  bcFont: "plex", // "" = original | plex | sans | seriftext | serifdisplay (keep in sync with content.js)
  fullWidth: false,
  ccLaunch: true,
  telemetry: true,
  reactionEmojis: DEFAULT_EMOJIS,
  menuItems: DEFAULT_MENU_ITEMS,
};
const TOGGLES = ["timeLabels", "rtl", "fullWidth", "inlineReactions", "inlineMenus", "ccLaunch", "telemetry"];

// setting_changed telemetry. Sent from HERE because the popup is the single
// writer of settings — every open tab hears storage.onChanged, so capturing
// there would duplicate the event per tab. Uses the same bundled posthog SDK
// as content.js (vendor/posthog.js, loaded by popup.html); identity comes
// from the bceWho cache content.js maintains (Basecamp email/person id).
// Keep PH_KEY/PH_HOST in sync with content.js; empty key = no telemetry.
const PH_KEY = "phc_zNZ5vwprEnyTuy5wGYf9WgutaV4GZZaBmp9tubfykmoZ";
// Our reverse proxy to PostHog Cloud (see content.js PH_HOST comment)
const PH_HOST = "https://posthog.fhijazi.com";

let phStarted = false;
if (PH_KEY && typeof posthog !== "undefined") {
  phStarted = true;
  posthog.init(PH_KEY, {
    api_host: PH_HOST,
    defaults: "2026-05-30", // versioned SDK defaults (per PostHog's snippet)
    persistence: "localStorage", // the popup page's own localStorage
    capture_pageview: false, // popup opens aren't page visits
    autocapture: false,
    disable_session_recording: true,
    advanced_disable_decide: true,
    advanced_disable_feature_flags: true,
    opt_out_capturing_by_default: true, // opted in below iff the toggle is on
  });
  posthog.register({ version: chrome.runtime.getManifest().version });
  chrome.storage.sync.get({ telemetry: true }, ({ telemetry }) => {
    if (telemetry) posthog.opt_in_capturing({ captureEventName: null });
  });
  chrome.storage.local.get("bceWho", ({ bceWho }) => {
    const who = bceWho || {};
    if (who.email || who.id) {
      posthog.identify(who.email || "bc:" + who.id, {
        email: who.email || undefined, name: who.name || undefined,
        basecamp_person_id: who.id || undefined,
      });
    }
  });
}

function tele(setting, value) {
  if (!phStarted) return;
  // flip the SDK's opt state FIRST so turning off is silent (capture below
  // no-ops once opted out) and turning on reports itself
  if (setting === "telemetry") {
    if (value) posthog.opt_in_capturing({ captureEventName: null });
    else posthog.opt_out_capturing();
  }
  posthog.capture("setting_changed", {
    setting, value: Array.isArray(value) ? value.length + " items" : value,
  });
}

// Split a string into emoji, honoring multi-codepoint graphemes (ZWJ, flags,
// skin tones) and ignoring whitespace/commas — so "👍👏 🙌, 🎉" all work.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function parseEmojis(str) {
  const out = [];
  for (const { segment } of segmenter.segment(str)) {
    if (segment.trim() && segment !== ",") out.push(segment);
  }
  return out;
}

const emojiInput = document.getElementById("reactionEmojis");
const reactCount = document.getElementById("reactCount");
const emojiEditor = document.getElementById("emojiEditor");

function showCount(n) { reactCount.textContent = n + " emoji"; }

// --- inline-menu item editor: tick to show, drag to reorder ---

const menuEditor = document.getElementById("menuEditor");
const menuList = document.getElementById("menuList");

function renderMenuItems(items) {
  menuList.textContent = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.key = it.key;
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "⠿";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = it.on !== false;
    cb.addEventListener("change", saveMenuItems);
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = it.label;
    li.append(grip, cb, lab);
    menuList.appendChild(li);
  }
}

function saveMenuItems() {
  const items = [...menuList.children].map((li) => ({
    key: li.dataset.key,
    label: li.querySelector(".label").textContent,
    on: li.querySelector("input").checked,
  }));
  chrome.storage.sync.set({ menuItems: items });
  tele("menuItems", items);
}

let dragEl = null;
menuList.addEventListener("dragstart", (e) => {
  dragEl = e.target.closest("li");
  dragEl.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragEl.dataset.key); // required by some UAs
});
menuList.addEventListener("dragover", (e) => {
  e.preventDefault(); // allow drop
  const over = e.target.closest("li");
  if (!dragEl || !over || over === dragEl) return;
  const r = over.getBoundingClientRect();
  over.parentNode.insertBefore(dragEl, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
});
menuList.addEventListener("dragend", () => {
  if (!dragEl) return;
  dragEl.classList.remove("dragging");
  dragEl = null;
  saveMenuItems();
});

document.getElementById("resetMenu").addEventListener("click", () => {
  renderMenuItems(DEFAULT_MENU_ITEMS);
  chrome.storage.sync.set({ menuItems: DEFAULT_MENU_ITEMS });
});

chrome.storage.sync.get(DEFAULTS, (settings) => {
  // personal feature; the row stays hidden unless the cc-launcher flag is on
  chrome.storage.local.get("bceCcFlags", (st) => {
    document.getElementById("ccRow").hidden = !(st && st.bceCcFlags && st.bceCcFlags.launcher);
  });
  for (const key of TOGGLES) document.getElementById(key).checked = settings[key];
  document.getElementById("bcFont").value = settings.bcFont ?? "plex";
  const emojis = settings.reactionEmojis || DEFAULT_EMOJIS;
  emojiInput.value = emojis.join(" ");
  showCount(emojis.length);
  emojiEditor.classList.toggle("disabled", !settings.inlineReactions);
  renderMenuItems(settings.menuItems && settings.menuItems.length ? settings.menuItems : DEFAULT_MENU_ITEMS);
  menuEditor.classList.toggle("disabled", !settings.inlineMenus);
});

for (const key of TOGGLES) {
  document.getElementById(key).addEventListener("change", (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
    tele(key, e.target.checked);
    if (key === "inlineReactions") emojiEditor.classList.toggle("disabled", !e.target.checked);
    if (key === "inlineMenus") menuEditor.classList.toggle("disabled", !e.target.checked);
  });
}

document.getElementById("bcFont").addEventListener("change", (e) => {
  chrome.storage.sync.set({ bcFont: e.target.value });
  tele("bcFont", e.target.value);
});

// Save emoji as the user edits (debounced so we don't thrash storage.sync).
let saveTimer;
emojiInput.addEventListener("input", () => {
  const emojis = parseEmojis(emojiInput.value);
  showCount(emojis.length);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set({ reactionEmojis: emojis });
    tele("reactionEmojis", emojis);
  }, 300);
});

document.getElementById("resetEmojis").addEventListener("click", () => {
  emojiInput.value = DEFAULT_EMOJIS.join(" ");
  showCount(DEFAULT_EMOJIS.length);
  chrome.storage.sync.set({ reactionEmojis: DEFAULT_EMOJIS });
});


// --- HQ servers --------------------------------------------------------
// Several HQs exist in practice: a local one, the thmanyah VM over an ssh
// tunnel (loopback), and the VM's LAN/tailnet address. Keeping a LIST and
// switching between them beats retyping a URL, which is what the single input
// forced. `hqBase` stays the one value background.js and content.js read, so
// the rest of the extension is unchanged.
const HQ_DEFAULT = "http://127.0.0.1:8377";
const HQ_SEED = [HQ_DEFAULT, "http://192.168.0.43:8377"];

const hqPick = document.getElementById("hqPick");
const hqInput = document.getElementById("hqBase");
const hqNote = document.getElementById("hqBaseNote");
const hqAdd = document.getElementById("hqAdd");
const hqDel = document.getElementById("hqDel");
const hqTest = document.getElementById("hqTest");

const hqClean = (u) => String(u || "").trim().replace(/\/+$/, "");
const hqOrigin = (u) => new URL(u).origin + "/*";   // throws on a bad URL

function hqNoteFor(url) {
  if (url === HQ_DEFAULT) return "loopback: a local HQ, or the ssh tunnel to the VM";
  return "custom host";
}

function hqRender(list, active) {
  hqPick.textContent = "";
  for (const u of list) {
    const o = document.createElement("option");
    o.value = u;
    o.textContent = u;
    if (u === active) o.selected = true;
    hqPick.appendChild(o);
  }
  hqDel.disabled = list.length < 2;
  hqNote.textContent = hqNoteFor(active);
}

function hqLoad(cb) {
  chrome.storage.sync.get({ hqBase: HQ_DEFAULT, hqBases: null }, ({ hqBase, hqBases }) => {
    const active = hqClean(hqBase) || HQ_DEFAULT;
    // Migration: a profile that only ever had the single `hqBase` gets a list
    // seeded from it plus the known addresses.
    const list = Array.isArray(hqBases) && hqBases.length
      ? hqBases.map(hqClean).filter(Boolean)
      : [...new Set([active, ...HQ_SEED])];
    if (!list.includes(active)) list.unshift(active);
    cb(list, active);
  });
}

function hqSave(list, active) {
  chrome.storage.sync.set({ hqBases: list, hqBase: active }, () => hqRender(list, active));
}

hqLoad((list, active) => {
  hqRender(list, active);
  hqInput.value = "";
});

// Switching the active server is one click and needs no permission prompt: the
// origin was already granted when it was added.
hqPick.addEventListener("change", () => {
  hqLoad((list) => hqSave(list, hqClean(hqPick.value)));
});

// Adding runs from a real click, NOT from a debounced input handler. Chrome
// only grants chrome.permissions.request inside a user gesture, and the old
// code asked from inside a setTimeout, so adding any custom host always failed.
hqAdd.addEventListener("click", () => {
  const raw = hqClean(hqInput.value);
  if (!raw) { hqNote.textContent = "type a URL first"; return; }
  let origin;
  try { origin = hqOrigin(raw); }
  catch (e) { hqNote.textContent = "not a valid URL"; return; }
  const commit = () => hqLoad((list) => {
    hqSave([...new Set([raw, ...list])], raw);
    hqInput.value = "";
  });
  chrome.permissions.contains({ origins: [origin] }, (has) => {
    if (has) return commit();
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      if (granted) commit();
      else hqNote.textContent = "permission denied for " + origin;
    });
  });
});

hqDel.addEventListener("click", () => {
  hqLoad((list, active) => {
    const gone = hqClean(hqPick.value);
    const kept = list.filter((u) => u !== gone);
    if (!kept.length) { hqNote.textContent = "keep at least one server"; return; }
    hqSave(kept, gone === active ? kept[0] : active);
  });
});

// "test" answers the only question that matters: is this HQ actually reachable
// from this browser right now. The service worker does the fetch, because it
// holds the host permissions.
hqTest.addEventListener("click", () => {
  const target = hqClean(hqPick.value);
  hqNote.textContent = "checking " + target + " ...";
  chrome.storage.sync.get({ hqBase: HQ_DEFAULT }, ({ hqBase }) => {
    const restore = hqClean(hqBase);
    const ask = () => chrome.runtime.sendMessage({ type: "hqWorkers" }, (r) => {
      if (chrome.runtime.lastError) { hqNote.textContent = "no answer from the extension"; return; }
      if (!r || !r.ok) hqNote.textContent = "unreachable: " + ((r && r.error) || "unknown");
      else hqNote.textContent = `reachable, ${(r.workers || []).length} worker(s)`;
      if (restore !== target) chrome.storage.sync.set({ hqBase: restore });
    });
    // hqWorkers always uses the stored base, so point it at the row under test.
    if (restore !== target) chrome.storage.sync.set({ hqBase: target }, ask);
    else ask();
  });
});
