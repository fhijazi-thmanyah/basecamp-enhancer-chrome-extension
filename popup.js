// Popup: reflect stored settings and write changes back. The content script
// listens on chrome.storage.onChanged and applies/reverts each feature live.

// Feature gate — keep in sync with content.js. The Claude Code launcher is a
// personal, unpublished feature; false hides its toggle row so the published
// build never surfaces it. The `cc-launcher` branch flips this to true.
const CC_ENABLED = false;

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
  ccLaunch: true,
  reactionEmojis: DEFAULT_EMOJIS,
  menuItems: DEFAULT_MENU_ITEMS,
};
const TOGGLES = ["timeLabels", "rtl", "inlineReactions", "inlineMenus", "ccLaunch"];

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
  document.getElementById("ccRow").hidden = !CC_ENABLED; // personal feature; hidden in the published build
  for (const key of TOGGLES) document.getElementById(key).checked = settings[key];
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
    if (key === "inlineReactions") emojiEditor.classList.toggle("disabled", !e.target.checked);
    if (key === "inlineMenus") menuEditor.classList.toggle("disabled", !e.target.checked);
  });
}

// Save emoji as the user edits (debounced so we don't thrash storage.sync).
let saveTimer;
emojiInput.addEventListener("input", () => {
  const emojis = parseEmojis(emojiInput.value);
  showCount(emojis.length);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.sync.set({ reactionEmojis: emojis }), 300);
});

document.getElementById("resetEmojis").addEventListener("click", () => {
  emojiInput.value = DEFAULT_EMOJIS.join(" ");
  showCount(DEFAULT_EMOJIS.length);
  chrome.storage.sync.set({ reactionEmojis: DEFAULT_EMOJIS });
});
