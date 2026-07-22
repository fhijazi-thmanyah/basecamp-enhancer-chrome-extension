// Basecamp Enhancer — content script
// 1. Append a "(X ago)" relative-time label to <time> elements.
// 2. Fix RTL: auto-detect text direction on content + input fields.
// 3. Quick reactions: a row of one-click boost emoji (recently-used rotation).
// 4. Hover bar: a Google-Chat–style pill floated at each message's top-right on
//    hover, holding the quick-react emoji plus the record's full "…" action menu
//    (Edit / Reply / Bookmark / Bubble up / Copy link / Delete / …).
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

  // A "record" = a hoverable message: a chat line/ping or a comment. Both get
  // the unified hover bar (reactions + action menu), and their standalone
  // reaction bars are suppressed in favor of it.
  const RECORD_SEL = "turbo-frame.chat-line, article.thread-entry.recording";

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

  const reactionsSig = () => settings.reactionEmojis.join(" ");

  // A .bce-reactions span of quick-boost buttons for the current emoji set.
  function buildReactionBar() {
    const bar = document.createElement("span");
    bar.className = "bce-reactions";
    bar.dataset.sig = reactionsSig();
    for (const emoji of settings.reactionEmojis) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bce-react-btn";
      btn.dataset.emoji = emoji;
      btn.textContent = emoji;
      btn.setAttribute("aria-label", "React " + emoji);
      bar.appendChild(btn);
    }
    return bar;
  }

  // Add/refresh a reaction bar as a direct child of `parent`, reusing the
  // existing one unless the emoji set changed. `lead` inserts it first.
  function setReactionBar(parent, lead) {
    let bar = parent.querySelector(":scope > .bce-reactions");
    if (bar && bar.dataset.sig === reactionsSig()) return; // already up to date
    if (bar) bar.remove(); // emoji set changed → rebuild
    bar = buildReactionBar();
    if (lead) parent.insertBefore(bar, parent.firstChild); else parent.appendChild(bar);
  }

  // Inline reactions on standalone boost bars (the main card/message/todo
  // detail). Records (chat lines / comments) instead get their reactions inside
  // the hover bar, so skip those here to avoid a duplicate.
  function injectReactionBar(container) {
    if (container.closest(RECORD_SEL)) return;
    if (!container.querySelector(".boosts__new-boost")) return; // not reactable yet
    setReactionBar(container, false);
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
    // Hover-bar buttons sit outside `.boosts`; resolve it via the record.
    const rec = btn.closest("[data-bce-rec]");
    const container = (rec && rec.querySelector(".boosts")) || btn.closest(".boosts");
    if (container) sendBoost(container, btn.dataset.emoji, btn);
  }, true);

  // ---- Feature 4: hover bar (reactions + full action menu) --------------

  // Google-Chat–style: on hover, one pill floats at a record's top-right holding
  // your quick-react emoji plus the record's real "…" menu (Edit / Reply /
  // Bookmark / Bubble up / Copy link / Delete / …). The menu items are
  // Basecamp's own nodes, lifted in so their Stimulus controllers reconnect and
  // every action fires natively — chat-room actions (Edit/Reply/Delete) resolve
  // against the live room ancestor; self-contained ones (Bookmark/Copy link/
  // Bubble up) ride along in the clone. Floating means it never disturbs
  // Basecamp's layout — no overflow to juggle. The menu is lazily fetched from
  // the record's `/…/options` endpoint as the record nears the viewport (so it's
  // ready before you hover). Reactions post via the boost gid (see sendBoost).

  // The options URL + turbo-frame id: comments expose it as a lazy-options frame
  // `src`; chat lines as the kebab toggle's `href`.
  function menuSource(el) {
    const lazy = el.querySelector("turbo-frame.action-sheet__lazy-options[src]");
    if (lazy) return { url: lazy.getAttribute("src"), fid: lazy.id };
    const toggle = el.querySelector(".action-sheet__expansion-toggle[href]");
    return toggle ? { url: toggle.getAttribute("href"), fid: "options" } : null;
  }

  // The menu items in the fetched frame: chat lines nest them in
  // `.action-sheet__content`; comments put them straight in the frame.
  function menuRoot(doc, fid) {
    return doc.querySelector(".action-sheet--for-chat-line .action-sheet__content")
        || doc.getElementById(fid)
        || doc.querySelector("turbo-frame");
  }

  // Ensure the record carries its floating hover bar; return it. Idempotent.
  // The bar anchors to the message bubble (chat) or the record itself
  // (comments) so it floats at *that* element's top-right, snug to the message —
  // near where Basecamp's "…" sits. `data-bce-rec` (on the whole record) is the
  // hover trigger; `.bce-anchor` is the positioned parent.
  function hoverBarFor(rec) {
    const anchor = rec.querySelector(".chat-line__bubble") || rec;
    let bar = anchor.querySelector(":scope > .bce-hoverbar");
    if (!bar) {
      rec.setAttribute("data-bce-rec", "");
      anchor.classList.add("bce-anchor");
      bar = document.createElement("div");
      bar.className = "bce-hoverbar";
      // Chat bubbles align by sender (mine right, others left), so mirror the bar
      // to the bubble's outer-top corner — it grows inward instead of running off
      // the edge. Comments are full-width; they stay top-right (no attr).
      if (rec.matches("turbo-frame.chat-line") && me)
        bar.dataset.mine = String(rec.getAttribute("data-creator-id") === me.content);
      anchor.appendChild(bar);
    }
    return bar;
  }

  // Lift the record's real "…" menu into its hover bar — once per record.
  async function fillHoverMenu(rec, bar) {
    if (bar.dataset.menu) return;
    const src = menuSource(rec);
    if (!src) return;
    bar.dataset.menu = "loading";
    try {
      const html = await fetch(src.url, { headers: { "Accept": "text/html", "Turbo-Frame": src.fid } }).then((r) => r.text());
      const root = menuRoot(new DOMParser().parseFromString(html, "text/html"), src.fid);
      if (!root) { delete bar.dataset.menu; return; }
      const menu = document.createElement("span");
      menu.className = "bce-menu";
      for (const n of [...root.cloneNode(true).childNodes]) {
        // drop the native reaction row, menu dividers, and mobile-app-only dupes
        if (n.nodeType === 1 && n.matches(".chat-line-reactions, .action-sheet__divider, .app-ios__show, .app-android__show")) continue;
        menu.appendChild(n); // keep controllers (copy-to-clipboard/bookmarks/bubble-up) intact
      }
      // popup-positioning targets belong to the un-cloned parent sheet — drop them
      menu.querySelectorAll("[data-orientation-target], [data-horizontal-offset-target]").forEach((n) => {
        n.removeAttribute("data-orientation-target");
        n.removeAttribute("data-horizontal-offset-target");
      });
      bar.appendChild(menu);
      bar.dataset.menu = "1";
    } catch (e) {
      delete bar.dataset.menu; // let it retry on the next pass
    }
  }

  // Menu fetch is per-record, so load lazily: only as a record nears the viewport.
  const menuObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      menuObserver.unobserve(e.target);
      fillHoverMenu(e.target, hoverBarFor(e.target));
    }
  }, { rootMargin: "300px" });

  // Build/refresh hover bars across a subtree: reactions (if enabled, leading)
  // plus a lazily-loaded menu (if enabled). Each part is gated by its own toggle.
  function applyHoverBars(root = document) {
    const recs = [];
    if (root.matches && root.matches(RECORD_SEL)) recs.push(root);
    if (root.querySelectorAll) recs.push(...root.querySelectorAll(RECORD_SEL));
    for (const rec of recs) {
      const bar = hoverBarFor(rec);
      if (settings.inlineReactions) setReactionBar(bar, true);
      else { const rx = bar.querySelector(":scope > .bce-reactions"); if (rx) rx.remove(); }
      if (settings.inlineMenus) menuObserver.observe(rec);
    }
  }

  function removeHoverBars() {
    document.querySelectorAll(".bce-hoverbar").forEach((b) => b.remove());
    document.querySelectorAll("[data-bce-rec]").forEach((r) => r.removeAttribute("data-bce-rec"));
    document.querySelectorAll(".bce-anchor").forEach((a) => a.classList.remove("bce-anchor"));
  }

  // Strip only the menu portion (the reactions toggle stays independent).
  function removeHoverMenus() {
    document.querySelectorAll(".bce-hoverbar .bce-menu").forEach((m) => m.remove());
    document.querySelectorAll(".bce-hoverbar[data-menu]").forEach((b) => b.removeAttribute("data-menu"));
  }

  // ---- Wiring -----------------------------------------------------------

  // Enhance a freshly added subtree, honoring current settings.
  function enhance(root = document) {
    // Skip our own badges to avoid needless re-work from observer feedback.
    if (root.nodeType === 1 && root.classList && root.classList.contains("bce-ago")) return;
    if (settings.timeLabels) decorateAllTimes(root);
    if (settings.rtl) applyAutoDir(root);
    if (settings.inlineReactions) applyInlineReactions(root); // standalone boost bars
    if (settings.inlineReactions || settings.inlineMenus) applyHoverBars(root); // records
  }

  // Apply or revert each feature across the whole page to match settings.
  function reconcile() {
    if (settings.timeLabels) decorateAllTimes(); else removeTimeLabels();
    if (settings.rtl) applyAutoDir(); else removeAutoDir();
    if (settings.inlineReactions) applyInlineReactions(); else removeReactionBars();
    if (settings.inlineReactions || settings.inlineMenus) applyHoverBars(); else removeHoverBars();
    if (!settings.inlineMenus) removeHoverMenus();
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
