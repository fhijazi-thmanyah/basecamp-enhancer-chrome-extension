// Popup: reflect stored settings and write changes back. The content script
// listens on chrome.storage.onChanged and applies/reverts each feature live.

const DEFAULT_EMOJIS = ["👍", "👏", "🙌", "❤️", "😂", "😊", "🎉", "🚀"];
const DEFAULTS = {
  timeLabels: true,
  rtl: true,
  inlineReactions: true,
  inlineMenus: true,
  reactionEmojis: DEFAULT_EMOJIS,
};
const TOGGLES = ["timeLabels", "rtl", "inlineReactions", "inlineMenus"];

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

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const key of TOGGLES) document.getElementById(key).checked = settings[key];
  const emojis = settings.reactionEmojis || DEFAULT_EMOJIS;
  emojiInput.value = emojis.join(" ");
  showCount(emojis.length);
  emojiEditor.classList.toggle("disabled", !settings.inlineReactions);
});

for (const key of TOGGLES) {
  document.getElementById(key).addEventListener("change", (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
    if (key === "inlineReactions") emojiEditor.classList.toggle("disabled", !e.target.checked);
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
