// Popup: reflect stored toggles and write changes back. The content script
// listens on chrome.storage.onChanged and applies/reverts each feature live.

const DEFAULTS = { timeLabels: true, rtl: true };
const KEYS = Object.keys(DEFAULTS);

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const key of KEYS) {
    document.getElementById(key).checked = settings[key];
  }
});

for (const key of KEYS) {
  document.getElementById(key).addEventListener("change", (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
  });
}
