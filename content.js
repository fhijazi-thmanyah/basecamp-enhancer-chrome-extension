// Basecamp Enhancer — content script
// 1. Append a "(X ago)" relative-time label to <time> elements.
// 2. Fix RTL: auto-detect text direction on content + input fields.
// Both features are individually toggleable from the toolbar popup and are
// applied/reverted live via chrome.storage; with both off it's normal Basecamp.

(() => {
  "use strict";

  const DEFAULTS = { timeLabels: true, rtl: true };
  let settings = { ...DEFAULTS };

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });

  // Largest-fitting unit, e.g. 3 days ago instead of 72 hours ago.
  const UNITS = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  function relativeLabel(date) {
    const diffSeconds = (date.getTime() - Date.now()) / 1000; // negative = past
    const abs = Math.abs(diffSeconds);
    for (const [unit, secondsPerUnit] of UNITS) {
      if (abs >= secondsPerUnit || unit === "second") {
        return rtf.format(Math.round(diffSeconds / secondsPerUnit), unit);
      }
    }
    return rtf.format(0, "second");
  }

  // ---- Feature 1: relative time on <time> elements ----------------------

  function parseDate(el) {
    const raw = el.getAttribute("datetime") || el.dateTime;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // Calendar-day distance from today (negative = past). Basecamp already shows
  // yesterday/today/tomorrow (±1 day) as a relative word — often as a sibling
  // <time> sharing the same datetime (e.g. "yesterday" + "Jun 7") — so a
  // "(X ago)" badge there is redundant. We skip the whole ±1-day range.
  function calendarDayDiff(date) {
    const a = new Date(date); a.setHours(0, 0, 0, 0);
    const b = new Date(); b.setHours(0, 0, 0, 0);
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  // Basecamp emits two <time> per timestamp (e.g. "Tuesday" + "Jun 2") as
  // siblings sharing one datetime. Badge only the last so we never show the
  // label twice; the earlier sibling(s) are left as plain Basecamp text.
  function hasLaterTimeSibling(el) {
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
      if (n.tagName === "TIME") return true;
    }
    return false;
  }

  function decorateTime(el) {
    const date = parseDate(el);
    if (!date) return;

    const existing = el.querySelector(":scope > .bce-ago");
    // Skip ±1 day (Basecamp shows yesterday/today/tomorrow as a word) and any
    // <time> that has a later sibling <time> (only the last one gets a badge).
    if (Math.abs(calendarDayDiff(date)) <= 1 || hasLaterTimeSibling(el)) {
      if (existing) existing.remove(); // drop a stale badge if conditions changed
      return;
    }

    const badge = existing || document.createElement("span");
    if (!existing) {
      badge.className = "bce-ago";
      el.appendChild(badge);
    }
    badge.textContent = ` (${relativeLabel(date)})`;
  }

  function decorateAllTimes(root = document) {
    if (root.querySelectorAll) root.querySelectorAll("time").forEach(decorateTime);
    // The observer may hand us a node that *is* a <time> — querySelectorAll
    // only matches descendants, so decorate the root itself too.
    if (root.nodeType === 1 && root.tagName === "TIME") decorateTime(root);
  }

  function removeTimeLabels() {
    document.querySelectorAll(".bce-ago").forEach((b) => b.remove());
  }

  // ---- Feature 2: RTL auto-direction ------------------------------------

  // dir="auto" makes the browser pick direction from the first strong
  // character — the correct fix for mixed Arabic/English content, and it works
  // live as the user types in textareas / inputs / rich-text editors.
  const RTL_SELECTORS = [
    // rendered content
    ".formatted_content", // messages, comments, card descriptions
    ".trix-content",
    "[data-behavior~='message_content']",
    ".message__content",
    ".comment__content",
    ".bucket-view__content",
    ".todo__content",
    ".rich-text",
    // editable / input fields
    "trix-editor",
    "textarea",
    "input[type='text']",
    "input[type='search']",
    "[contenteditable='true']",
    "[contenteditable='']",
  ].join(",");

  // Only set dir when the element doesn't already declare one (Basecamp content
  // ships without it), and tag what we touched so we can cleanly revert.
  function setAutoDir(el) {
    if (!el.hasAttribute("dir")) {
      el.setAttribute("dir", "auto");
      el.setAttribute("data-bce-dir", "1");
    }
  }

  function applyAutoDir(root = document) {
    if (root.querySelectorAll) root.querySelectorAll(RTL_SELECTORS).forEach(setAutoDir);
    if (root.nodeType === 1 && root.matches && root.matches(RTL_SELECTORS)) setAutoDir(root);
  }

  function removeAutoDir() {
    document.querySelectorAll("[data-bce-dir]").forEach((el) => {
      el.removeAttribute("dir");
      el.removeAttribute("data-bce-dir");
    });
  }

  // ---- Wiring -----------------------------------------------------------

  // Enhance a freshly added subtree, honoring current settings.
  function enhance(root = document) {
    // Skip our own badges to avoid needless re-work from observer feedback.
    if (root.nodeType === 1 && root.classList && root.classList.contains("bce-ago")) return;
    if (settings.timeLabels) decorateAllTimes(root);
    if (settings.rtl) applyAutoDir(root);
  }

  // Apply or revert each feature across the whole page to match settings.
  function reconcile() {
    if (settings.timeLabels) decorateAllTimes(); else removeTimeLabels();
    if (settings.rtl) applyAutoDir(); else removeAutoDir();
  }

  // Run as early as possible (document_start): the observer below catches most
  // content as it streams in. enhance() uses DEFAULTS until storage resolves;
  // reconcile() then corrects anything a disabled feature shouldn't have done.
  enhance();

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    reconcile();
  });

  // Toolbar toggles write to storage; apply/revert live without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key in changes) settings[key] = changes[key].newValue;
    reconcile();
  });

  // Basecamp is navigation-heavy (Turbo) and streams DOM updates, so watch for
  // new nodes and enhance only the added subtrees — continuously.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) enhance(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Full sweeps at the usual readiness milestones.
  document.addEventListener("DOMContentLoaded", () => enhance(), { once: true });
  window.addEventListener("load", () => enhance(), { once: true });

  // Keep relative labels fresh (e.g. "1 minute ago" -> "2 minutes ago").
  setInterval(() => { if (settings.timeLabels) decorateAllTimes(); }, 60 * 1000);
})();
