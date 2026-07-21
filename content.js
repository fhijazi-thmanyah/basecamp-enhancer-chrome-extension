// Basecamp Enhancer — content script
// 1. Append a "(X ago)" relative-time label to <time> elements.
// 2. Fix RTL: auto-detect text direction on content + input fields.
// 3. Inline reactions: a row of quick-boost emoji on every reactable item,
//    so you react in one click without opening the "…" menu.
// All features are individually toggleable from the toolbar popup and are
// applied/reverted live via chrome.storage; with all off it's normal Basecamp.

(() => {
  "use strict";

  const DEFAULT_EMOJIS = ["👍", "👏", "🙌", "❤️", "😂", "😊", "🎉", "🚀"];
  const DEFAULTS = {
    timeLabels: true,
    rtl: true,
    inlineReactions: true,
    inlineMenus: true,
    reactionEmojis: DEFAULT_EMOJIS,
  };
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

  // ---- Feature 3: inline reactions (quick boosts) -----------------------

  // Every reactable Basecamp item (card, comment, message, chat line, ping)
  // renders a `.boosts` container holding a `.boosts__new-boost` "+" link whose
  // href encodes the record's boostable_gid. That single, uniform anchor is all
  // we need to post a boost — no "…" menu, no popover.

  // The bar shows your most-recently-used reaction emoji, newest first. Any
  // reaction you make — through our bar OR Basecamp's own picker — bubbles that
  // emoji to the front (`reactionEmojis` doubles as the MRU cache, capped here).
  const MRU_MAX = 8;
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  function recordEmojiUse(emoji) {
    const cur = settings.reactionEmojis;
    if (!emoji || cur[0] === emoji) return; // already newest → nothing to reorder
    const next = [emoji, ...cur.filter((e) => e !== emoji)].slice(0, MRU_MAX);
    settings.reactionEmojis = next;
    chrome.storage.sync.set({ reactionEmojis: next }); // → onChanged → bars rebuild
  }

  // The leading grapheme of a boost's text is its content; keep it only if it's
  // an emoji (skip text boosts, which don't belong in an emoji bar).
  function boostEmoji(boostEl) {
    for (const { segment } of graphemes.segment(boostEl.textContent.trim())) {
      return /\p{Extended_Pictographic}/u.test(segment) ? segment : null;
    }
    return null;
  }

  // Learn from reactions *you* make via Basecamp's native picker: when one of
  // your boosts is added to the DOM, promote its emoji. Gated to a moment after
  // each (Turbo) load so the boosts already on the page — and page-to-page
  // navigations — don't flood the MRU with old history.
  const me = document.querySelector('meta[name="current-person-id"]');
  let captureReadyAt = Date.now() + 2000;
  function captureRecentBoosts(root) {
    if (!me || Date.now() < captureReadyAt || !root.querySelectorAll) return;
    const sel = `.boost[data-creator-id="${me.content}"]`;
    if (root.matches && root.matches(sel)) recordEmojiUse(boostEmoji(root));
    root.querySelectorAll(sel).forEach((b) => recordEmojiUse(boostEmoji(b)));
  }

  // Derive the POST endpoint + gid from the "+" link's href. The href is
  //   /<acct>/buckets/<bucket>/boosts/new?boost[boostable_gid]=<base64 gid>
  // so the create endpoint is the same path without "/new", and the gid is the
  // base64-decoded query param. Returns null when the container isn't ready.
  function boostTarget(container) {
    const link = container.querySelector(".boosts__new-boost");
    if (!link) return null;
    const url = new URL(link.href);
    const encoded = url.searchParams.get("boost[boostable_gid]");
    if (!encoded) return null;
    return { postUrl: url.pathname.replace(/\/new$/, ""), gid: atob(encoded) };
  }

  function injectReactionBar(container) {
    if (!container.querySelector(".boosts__new-boost")) return; // not reactable yet

    const sig = settings.reactionEmojis.join(" ");
    let bar = container.querySelector(":scope > .bce-reactions");
    if (bar && bar.dataset.sig === sig) return; // already up to date
    if (bar) bar.remove(); // emoji set changed → rebuild

    bar = document.createElement("span");
    bar.className = "bce-reactions";
    bar.dataset.sig = sig;
    for (const emoji of settings.reactionEmojis) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bce-react-btn";
      btn.dataset.emoji = emoji;
      btn.textContent = emoji;
      btn.setAttribute("aria-label", "React " + emoji);
      bar.appendChild(btn);
    }
    container.appendChild(bar);
  }

  function applyInlineReactions(root = document) {
    if (root.querySelectorAll) root.querySelectorAll(".boosts").forEach(injectReactionBar);
    if (root.nodeType === 1 && root.matches && root.matches(".boosts")) injectReactionBar(root);
  }

  function removeReactionBars() {
    document.querySelectorAll(".bce-reactions").forEach((b) => b.remove());
  }

  // Apply the boost-create response. Basecamp returns the refreshed
  // <turbo-frame id="boosts_recording_…"> (or turbo-stream(s)); swap it in so
  // the new reaction shows without a page reload. Our sibling .bce-reactions bar
  // is untouched.
  function applyBoostResponse(html) {
    if (/<turbo-stream[\s>]/i.test(html)) return window.Turbo && window.Turbo.renderStreamMessage(html);
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    const incoming = tpl.content.querySelector("turbo-frame");
    const existing = incoming && document.getElementById(incoming.id);
    if (existing) existing.replaceWith(incoming);
  }

  async function sendBoost(container, emoji, btn) {
    const token = document.querySelector('meta[name="csrf-token"]');
    const target = boostTarget(container);
    if (!token || !target) return;
    btn.disabled = true;
    try {
      const res = await fetch(target.postUrl, {
        method: "POST",
        headers: { "Accept": "text/vnd.turbo-stream.html, text/html", "X-CSRF-Token": token.content },
        body: new URLSearchParams({
          authenticity_token: token.content,
          "boost[boostable_gid]": target.gid,
          "boost[content]": emoji,
        }),
      });
      if (res.ok) {
        applyBoostResponse(await res.text());
        recordEmojiUse(emoji);
      }
    } catch (e) {
      /* network hiccup — the button re-enables and the user can retry */
    } finally {
      btn.disabled = false;
    }
  }

  // One delegated, capturing click handler for all reaction buttons: survives
  // Basecamp cloning nodes, adds no per-button listeners, and intercepts the
  // click before Basecamp's own handlers.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".bce-react-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const container = btn.closest(".boosts");
    if (container) sendBoost(container, btn.dataset.emoji, btn);
  }, true);

  // ---- Feature 4: inline the full message menu (chat lines) -------------

  // Each chat line's "…" kebab is an `action-sheet` whose menu (Edit / Reply /
  // Bookmark / Bubble up / Copy link / Delete) is lazily fetched from the line's
  // `/…/lines/<id>/options` endpoint (the toggle's href). We fetch it once (as
  // the line scrolls into view), lift the real `.action-sheet__content` inline
  // beside the bubble, and let Basecamp's Stimulus reconnect its controllers so
  // every action still fires natively — the chat-room actions (Edit/Reply/
  // Delete) resolve against the live room ancestor; the self-contained ones
  // (Bookmark/Copy link/Bubble up) come with the cloned content. No kebab click.

  async function injectLineMenu(line) {
    if (line.dataset.bceMenu) return; // once per line ("loading"/"1")
    const toggle = line.querySelector(".action-sheet__expansion-toggle");
    const bubble = line.querySelector(".chat-line__bubble");
    if (!toggle || !bubble) return;
    line.dataset.bceMenu = "loading";
    try {
      const html = await fetch(toggle.getAttribute("href"), {
        headers: { "Accept": "text/html", "Turbo-Frame": "options" },
      }).then((r) => r.text());
      const content = new DOMParser().parseFromString(html, "text/html")
        .querySelector(".action-sheet--for-chat-line .action-sheet__content");
      if (!content) { delete line.dataset.bceMenu; return; }
      const menu = content.cloneNode(true);
      menu.querySelectorAll(".chat-line-reactions").forEach((n) => n.remove()); // we have our own emoji bar
      // Popup-positioning targets belong to the (un-cloned) parent sheet's
      // controllers; drop them + any inline offset so it lays out inline, static.
      menu.removeAttribute("data-orientation-target");
      menu.removeAttribute("data-horizontal-offset-target");
      menu.removeAttribute("style");
      const host = document.createElement("div");
      host.className = "bce-linemenu";
      host.dataset.mine = String(line.getAttribute("data-creator-id") === (me && me.content));
      host.appendChild(menu);
      bubble.appendChild(host);
      line.dataset.bceMenu = "1";
    } catch (e) {
      delete line.dataset.bceMenu; // let it retry on the next pass
    }
  }

  // Fetch is per-line, so load lazily: only when a line nears the viewport.
  const menuObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      menuObserver.unobserve(e.target);
      injectLineMenu(e.target);
    }
  }, { rootMargin: "300px" });

  function applyInlineMenus(root = document) {
    if (root.matches && root.matches("turbo-frame.chat-line")) menuObserver.observe(root);
    if (root.querySelectorAll) root.querySelectorAll("turbo-frame.chat-line").forEach((l) => menuObserver.observe(l));
  }

  function removeLineMenus() {
    document.querySelectorAll(".bce-linemenu").forEach((m) => m.remove());
    document.querySelectorAll("turbo-frame.chat-line[data-bce-menu]").forEach((l) => delete l.dataset.bceMenu);
  }

  // ---- Wiring -----------------------------------------------------------

  // Enhance a freshly added subtree, honoring current settings.
  function enhance(root = document) {
    // Skip our own badges to avoid needless re-work from observer feedback.
    if (root.nodeType === 1 && root.classList && root.classList.contains("bce-ago")) return;
    if (settings.timeLabels) decorateAllTimes(root);
    if (settings.rtl) applyAutoDir(root);
    if (settings.inlineReactions) applyInlineReactions(root);
    if (settings.inlineMenus) applyInlineMenus(root);
  }

  // Apply or revert each feature across the whole page to match settings.
  function reconcile() {
    if (settings.timeLabels) decorateAllTimes(); else removeTimeLabels();
    if (settings.rtl) applyAutoDir(); else removeAutoDir();
    if (settings.inlineReactions) applyInlineReactions(); else removeReactionBars();
    if (settings.inlineMenus) applyInlineMenus(); else removeLineMenus();
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
        if (node.nodeType !== 1) continue;
        enhance(node);
        if (settings.inlineReactions) captureRecentBoosts(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Turbo re-renders (cable-stream updates, morph refreshes, frame loads) can
  // strip our badges/bars from *inside* an element that stays put — the
  // observer only sees added nodes, so those wouldn't be restored until the
  // interval below. Re-reconcile on the next frame after any Turbo render so
  // they come back instantly instead of "appearing and reappearing".
  let restoreQueued = false;
  function scheduleRestore() {
    if (restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(() => { restoreQueued = false; reconcile(); });
  }
  ["turbo:load", "turbo:render", "turbo:frame-render", "turbo:before-stream-render"]
    .forEach((ev) => document.addEventListener(ev, scheduleRestore, true));

  // Each navigation renders a fresh page of existing boosts — re-arm the MRU
  // capture gate so that history doesn't count as "recently used".
  document.addEventListener("turbo:load", () => { captureReadyAt = Date.now() + 2000; }, true);

  // Full sweeps at the usual readiness milestones.
  document.addEventListener("DOMContentLoaded", () => enhance(), { once: true });
  window.addEventListener("load", () => enhance(), { once: true });

  // Keep relative labels fresh (e.g. "1 minute ago" -> "2 minutes ago").
  setInterval(() => { if (settings.timeLabels) decorateAllTimes(); }, 60 * 1000);
})();
