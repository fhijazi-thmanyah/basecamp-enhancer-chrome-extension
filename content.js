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
  // Inline-menu items in display order. `key` is matched (prefix, lowercase)
  // against the lifted item's text, so "notified" catches "Notified 3 people".
  // Items Basecamp adds that we don't know about render last, enabled.
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
  let settings = { ...DEFAULTS };

  // A "record" = a hoverable message: a chat line/ping or a comment. Both get
  // the unified hover bar (reactions + action menu), and their standalone
  // reaction bars are suppressed in favor of it. NOT the comment composer —
  // Basecamp marks the "Add your comment…" editor as a thread-entry.recording
  // too (thread-entry--form), and a draft must never grow reactions/menus.
  const RECORD_SEL = "turbo-frame.chat-line, article.thread-entry.recording:not(.thread-entry--form)";

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
  // Looked up lazily on every use: we run at document_start, before <head>
  // exists — capturing the meta once would pin it to null forever.
  const meId = () => document.querySelector('meta[name="current-person-id"]')?.content;
  let captureReadyAt = Date.now() + 2000;
  function captureRecentBoosts(root) {
    const me = meId();
    if (!me || Date.now() < captureReadyAt || !root.querySelectorAll) return;
    const sel = `.boost[data-creator-id="${me}"]`;
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
      if (rec.matches("turbo-frame.chat-line") && meId())
        bar.dataset.mine = String(rec.getAttribute("data-creator-id") === meId());
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
        // drop the native reaction row, menu dividers, mobile-app-only dupes,
        // and informational rows ("The window to edit… closed") — noise inline
        if (n.nodeType === 1 && n.matches(".chat-line-reactions, .action-sheet__divider, .app-ios__show, .app-android__show, .action-sheet__action--info")) continue;
        menu.appendChild(n); // keep controllers (copy-to-clipboard/bookmarks/bubble-up) intact
      }
      // popup-positioning targets belong to the un-cloned parent sheet — drop them
      menu.querySelectorAll("[data-orientation-target], [data-horizontal-offset-target]").forEach((n) => {
        n.removeAttribute("data-orientation-target");
        n.removeAttribute("data-horizontal-offset-target");
      });
      applyMenuPrefs(menu);
      bar.appendChild(menu);
      bar.dataset.menu = "1";
    } catch (e) {
      delete bar.dataset.menu; // let it retry on the next pass
    }
  }

  // Apply the user's configured item set/order (settings.menuItems) to a
  // lifted menu: hide items toggled off (data-bce-hidden — an attribute, since
  // our display:inline-flex !important would beat an inline style), and order
  // the rest via flex `order` (the wrappers ARE the bar's flex items thanks to
  // display:contents on .bce-menu; reactions keep the default order 0).
  function menuItemKey(child) {
    const act = child.matches(".action-sheet__action") ? child : child.querySelector(".action-sheet__action");
    return ((act || child).textContent || "").trim().toLowerCase();
  }
  function applyMenuPrefs(menu) {
    const prefs = settings.menuItems || [];
    for (const child of menu.children) {
      const key = menuItemKey(child);
      const idx = prefs.findIndex((p) => key.startsWith(p.key));
      child.toggleAttribute("data-bce-hidden", idx >= 0 && !prefs[idx].on);
      child.style.order = String(idx >= 0 ? idx + 1 : prefs.length + 1); // unknown → last
      // items render icon-only (label hidden by CSS) — expose the label as a
      // native tooltip. Use the clean prefs label; re-set if a lazy turbo-frame
      // (Bookmark/Notified) re-rendered and dropped it. `title` on the action.
      const act = child.matches(".action-sheet__action") ? child : child.querySelector(".action-sheet__action");
      if (act && !act.title) act.title = idx >= 0 ? prefs[idx].label : key;
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

  // Exactly ONE bar may be open at a time, managed in JS instead of CSS
  // :hover — pure :hover sometimes sticks (a stream re-render under the
  // pointer swallows the mouseleave) and lets a second bar coexist. Every
  // mouseover re-derives which record is hovered and closes all other bars,
  // so any stuck state self-heals on the next pointer move.
  let openRec = null;
  function setOpenRec(rec) {
    if (rec === openRec && (!rec || rec.querySelector(".bce-hoverbar.bce-open"))) return;
    document.querySelectorAll(".bce-hoverbar.bce-open").forEach((b) => b.classList.remove("bce-open"));
    document.querySelectorAll(".bce-sub-open").forEach((s) => s.classList.remove("bce-sub-open"));
    openRec = rec;
    const bar = rec && rec.querySelector(".bce-hoverbar");
    if (bar) bar.classList.add("bce-open");
  }
  // Trigger off the `.bce-anchor` (the bubble for chat, the record for
  // comments) — NOT the whole record. A chat-line turbo-frame spans the full
  // row width, so keying off it opened the bar whenever the pointer was at the
  // bubble's Y even out in the empty margin. The bar is a descendant of the
  // anchor, so hovering the bar (which overlaps above the bubble) still counts.
  document.addEventListener("mouseover", (e) => {
    const t = e.target;
    const anchor = t instanceof Element ? t.closest(".bce-anchor") : null;
    setOpenRec(anchor ? anchor.closest("[data-bce-rec]") : null);
  }, true);
  document.documentElement.addEventListener("mouseleave", () => setOpenRec(null));

  // The bubble-up sub-menu's closed state is OURS (display:none — see
  // styles.css: Basecamp's collapse can't survive our display overrides, and
  // an opacity-hidden clone left invisible-but-clickable schedule buttons).
  // Toggle .bce-sub-open around Basecamp's own Stimulus click handling.
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const sheet = t && t.closest(".bce-hoverbar .action-sheet--bubble-up");
    document.querySelectorAll(".bce-sub-open").forEach((s) => {
      if (s !== sheet) s.classList.remove("bce-sub-open");
    });
    if (!sheet) return;
    if (t.closest(".action-sheet__content")) sheet.classList.remove("bce-sub-open"); // preset chosen → collapse
    else sheet.classList.toggle("bce-sub-open"); // the trigger
  }, true);

  // Build/refresh hover bars across a subtree: reactions (if enabled, leading)
  // plus a lazily-loaded menu (if enabled). Each part is gated by its own toggle.
  function applyHoverBars(root = document) {
    // enforce the invariant: anything tagged as a record that no longer
    // matches RECORD_SEL (e.g. the comment composer, which older versions
    // tagged) loses its bar and markers
    document.querySelectorAll("[data-bce-rec]").forEach((r) => {
      if (r.matches(RECORD_SEL)) return;
      r.removeAttribute("data-bce-rec");
      r.querySelectorAll(".bce-hoverbar").forEach((b) => b.remove());
      r.querySelectorAll(".bce-anchor").forEach((a) => a.classList.remove("bce-anchor"));
      if (r.classList) r.classList.remove("bce-anchor");
    });
    const recs = [];
    if (root.matches && root.matches(RECORD_SEL)) recs.push(root);
    if (root.querySelectorAll) recs.push(...root.querySelectorAll(RECORD_SEL));
    for (const rec of recs) {
      const bar = hoverBarFor(rec);
      if (settings.inlineReactions) setReactionBar(bar, true);
      else { const rx = bar.querySelector(":scope > .bce-reactions"); if (rx) rx.remove(); }
      if (settings.inlineMenus) menuObserver.observe(rec);
      const m = bar.querySelector(":scope > .bce-menu");
      if (m) applyMenuPrefs(m); // reconcile picks up menuItems changes live
      if (rec === openRec) bar.classList.add("bce-open"); // survive re-renders
    }
  }

  function removeHoverBars() {
    setOpenRec(null);
    document.querySelectorAll(".bce-hoverbar").forEach((b) => b.remove());
    document.querySelectorAll("[data-bce-rec]").forEach((r) => r.removeAttribute("data-bce-rec"));
    document.querySelectorAll(".bce-anchor").forEach((a) => a.classList.remove("bce-anchor"));
  }

  // Strip only the menu portion (the reactions toggle stays independent).
  function removeHoverMenus() {
    document.querySelectorAll(".bce-hoverbar .bce-menu").forEach((m) => m.remove());
    document.querySelectorAll(".bce-hoverbar[data-menu]").forEach((b) => b.removeAttribute("data-menu"));
  }

  // ---- Feature 5: Claude Code launcher (HQ workers) ----------------------

  // A launcher button pinned bottom-left of EACH open conversation pane (main
  // record view + every chat/ping window — separate buttons, separate URLs)
  // that spawns a Claude Code worker on the local HQ server to handle/watch
  // that conversation. All HQ traffic goes through the background
  // service worker (see background.js — content scripts are CORS-bound to the
  // page origin). HQ's spawn returns the tmux session name synchronously, but
  // a 200 only means tmux accepted the command — claude is typed into a
  // surviving shell, so we must poll /api/workers afterwards to confirm the
  // worker actually came up (and to show live status in the tray).

  const CC_WORKDIR = "~/Projects/thmanyah.d/career-coach";
  const CC_LOOPS = [
    { key: "oneshot", label: "One-shot" },
    { key: "15min", label: "15 min" },
    { key: "60min", label: "60 min" },
  ];
  const CC_SESSIONS_MAX = 10;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Only the typed prompt + the pane's URL + our fixed template go to the
  // worker — never text scraped from the page (it runs unattended with
  // --dangerously-skip-permissions; page content is untrusted).
  function ccPrompt(typed, loop, url, replyWhenDone) {
    const watch = loop === "oneshot"
      ? "Handle it once — do NOT set up a watch loop."
      : `Then /loop ${loop} — keep watching this thread and respond as needed.`;
    const reply = replyWhenDone
      ? ` When the task is done, reply to the thread and @-mention the people relevant/related to the task.`
      : "";
    return (
      `${typed.trim()}\n\n` +
      `Basecamp thread: ${url}\n\n` +
      `Use /basecamp to read this thread. ${watch}${reply} ` +
      `If you have no idea what to do, or you're afraid of making a mistake, ` +
      `send Faris a macOS notification (osascript -e 'display notification "…" with title "CC worker"') and hold off.`
    );
  }

  function hqSend(msg) {
    return chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  }

  // Two URLs point at the same conversation if they differ only by fragment
  // (main-view URLs can carry #__recording_… anchors).
  const sameConvo = (a, b) => String(a).split("#")[0] === String(b).split("#")[0];

  // Launched-session tray, persisted so it survives navigations/reloads.
  function loadCcSessions() {
    return new Promise((r) => chrome.storage.local.get({ ccSessions: [] }, (v) => r(v.ccSessions)));
  }
  function saveCcSessions(list) {
    chrome.storage.local.set({ ccSessions: list.slice(0, CC_SESSIONS_MAX) });
  }

  // Confirm a just-spawned worker really started: claude should take over the
  // pane within a few seconds (status becomes working/waiting). A pane still
  // at the shell ("done") after the grace period, or a vanished session, means
  // the launch failed — surface HQ's pane tail so the error is visible.
  async function ccConfirmLaunch(session) {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      await sleep(2500);
      const r = await hqSend({ type: "hqWorkers" });
      if (!r.ok) return { ok: false, reason: r.error };
      const w = (r.workers || []).find((x) => x.session === session);
      if (!w) return { ok: false, reason: "session disappeared — launch failed" };
      // Any live-claude status counts as launched — a fast worker can already
      // be idle (finished thinking) by the first poll. Only "done" (pane back
      // at a bare shell) means claude isn't running.
      if (w.status === "working" || w.status === "waiting" || w.status === "idle") return { ok: true, worker: w };
      // "done" = pane is a bare shell; normal in the first seconds before
      // claude starts, a failed launch if it persists past the grace period.
      if (w.status === "done" && Date.now() - started > 8000) {
        return { ok: false, reason: "claude exited immediately", tail: w.tail };
      }
    }
    return { ok: false, reason: "worker never became active (timeout)" };
  }

  // --- UI ---

  // One launcher button PER OPEN CONVERSATION, pinned bottom-left of its pane
  // (doesn't scroll with the messages): every chat/ping window anchors to the
  // wrapper around its `.chat__lines` scroller (covers the full-page room AND
  // each sidebar ping), while the main record view (card/todo/message — the
  // window itself scrolls) pins to the viewport. Each button carries ITS
  // pane's URL, so a sidebar ping and the main card launch independently.

  function ccPaneUrl(host) {
    const tf = host.closest("turbo-frame[src]");
    // sidebar frames use /my/sidebar/circles/<id>, which 302s to the canonical
    // /circles/<id> — hand workers the canonical form directly
    if (tf) return new URL(tf.getAttribute("src"), location.href).href.replace("/my/sidebar/", "/");
    const a = host.querySelector('a[href*="/circles/"], a[href*="/chats/"]');
    if (a && a.href) return a.href;
    return location.href;
  }

  function ccPanes() {
    const panes = [];
    document.querySelectorAll(".chat__lines").forEach((sc) => {
      const host = sc.parentElement;
      if (host) panes.push({ host, mode: "pane", url: ccPaneUrl(host) });
    });
    // the main record view — unless this page IS the chat (covered above)
    const main = document.querySelector("main");
    if (main && !main.querySelector(".chat__lines")) {
      panes.push({ host: main, mode: "main", url: location.href });
    }
    return panes;
  }

  function ccEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  let ccPollTimer = null;
  let ccBusyTimer = null;

  // Spin the launcher icon while a worker launched from that conversation is
  // actively working — tracked ccSessions matched to buttons by URL.
  async function ccSyncBusy() {
    const btns = document.querySelectorAll(".bce-cc-btn");
    if (!btns.length) return;
    const sessions = await loadCcSessions();
    const busy = new Set();
    if (sessions.length) {
      const r = await hqSend({ type: "hqWorkers" });
      if (r.ok) {
        for (const w of r.workers || []) {
          const s = w.status === "working" && sessions.find((x) => x.session === w.session);
          if (s) busy.add(s.url);
        }
      }
    }
    btns.forEach((b) => {
      if ([...busy].some((u) => sameConvo(u, b.dataset.url))) b.dataset.busy = "1";
      else delete b.dataset.busy;
    });
  }

  function ccBuildPopover(url) {
    const pop = ccEl("div", "bce-ccpop");

    const head = ccEl("div", "bce-ccpop__head", "Launch Claude Code on this conversation");
    pop.appendChild(head);

    const ta = ccEl("textarea", "bce-ccpop__prompt");
    ta.placeholder = "What should Claude do here?  (Enter to launch · Shift+Enter = new line)";
    ta.rows = 3;
    pop.appendChild(ta);

    // "Watch ⏱️" — how often the worker re-checks the thread (or just once)
    const watchRow = ccEl("div", "bce-ccpop__watch");
    watchRow.appendChild(ccEl("span", "bce-ccpop__watchlabel", "Watch ⏱️"));
    const seg = ccEl("div", "bce-ccpop__seg");
    for (const { key, label } of CC_LOOPS) {
      const b = ccEl("button", "bce-ccpop__segbtn", label);
      b.type = "button";
      b.dataset.loop = key;
      if (key === "15min") b.dataset.on = "1"; // default
      b.addEventListener("click", () => {
        seg.querySelectorAll("[data-on]").forEach((x) => delete x.dataset.on);
        b.dataset.on = "1";
      });
      seg.appendChild(b);
    }
    watchRow.appendChild(seg);
    pop.appendChild(watchRow);

    // "Reply when done" — appends an instruction to reply + @-mention people
    const replyRow = ccEl("label", "bce-ccpop__reply");
    const replyCb = ccEl("input");
    replyCb.type = "checkbox";
    replyRow.appendChild(replyCb);
    replyRow.appendChild(ccEl("span", null, "Reply when done (@-mention relevant people)"));
    pop.appendChild(replyRow);

    const launch = ccEl("button", "bce-ccpop__launch", "Launch");
    launch.type = "button";
    pop.appendChild(launch);

    const status = ccEl("div", "bce-ccpop__status");
    pop.appendChild(status);

    const tray = ccEl("div", "bce-ccpop__tray");
    pop.appendChild(tray);

    function setStatus(kind, text, tail) {
      status.dataset.kind = kind || "";
      status.textContent = text || "";
      if (tail) {
        const pre = ccEl("pre", "bce-ccpop__tail", tail);
        status.appendChild(pre);
      }
    }

    // Enter launches, Shift+Enter inserts a newline (⌘/Ctrl+Enter also works);
    // Escape closes (Esc works anywhere in the popover)
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); launch.click(); }
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); ccClosePopover(); }
    });

    launch.addEventListener("click", async () => {
      const typed = ta.value.trim();
      if (!typed) { setStatus("err", "Write a prompt first."); ta.focus(); return; }
      const loop = seg.querySelector("[data-on]").dataset.loop;
      launch.disabled = true;
      setStatus("busy", "Spawning worker…");
      const title = "bc " + typed.slice(0, 40);
      const r = await hqSend({ type: "hqSpawn", title, prompt: ccPrompt(typed, loop, url, replyCb.checked), workdir: CC_WORKDIR });
      if (!r.ok) { setStatus("err", "Launch failed: " + r.error); launch.disabled = false; return; }
      const sessions = await loadCcSessions();
      sessions.unshift({ session: r.session, title, url, ts: Date.now() });
      saveCcSessions(sessions);
      renderTray();
      setStatus("busy", `${r.session} spawned — confirming claude started…`);
      const verdict = await ccConfirmLaunch(r.session);
      if (verdict.ok) {
        setStatus("ok", `${r.session} is ${verdict.worker.status} — follow it in HQ or below.`);
        ta.value = "";
      } else {
        setStatus("err", `${r.session} FAILED to start: ${verdict.reason}`, verdict.tail);
      }
      launch.disabled = false;
    });

    // --- tray: sessions launched on THIS conversation, with live status ---

    async function renderTray() {
      const sessions = (await loadCcSessions()).filter((s) => sameConvo(s.url, url));
      tray.textContent = "";
      if (!sessions.length) return;
      const head2 = ccEl("div", "bce-ccpop__trayhead");
      head2.appendChild(ccEl("span", null, "Sessions on this conversation"));
      const hqLink = ccEl("a", "bce-ccpop__hqlink", "Open HQ ↗");
      hqLink.href = "http://127.0.0.1:8377";
      hqLink.target = "_blank";
      head2.appendChild(hqLink);
      tray.appendChild(head2);
      for (const s of sessions) {
        const row = ccEl("div", "bce-cc-sess");
        row.dataset.session = s.session;
        const dot = ccEl("span", "bce-cc-dot");
        dot.dataset.status = "unknown";
        row.appendChild(dot);
        const info = ccEl("span", "bce-cc-info");
        // the session name itself becomes the claude.ai link once the
        // remote-control bridge connects (pollTray sets href from web_url)
        const name = ccEl("a", "bce-cc-name");
        name.appendChild(ccEl("code", null, s.session));
        info.appendChild(name);
        info.appendChild(ccEl("small", null, s.title));
        row.appendChild(info);
        // per-session HQ deep link → scrolls to & flashes THIS worker's card
        const hq = ccEl("a", "bce-cc-hq", "HQ ↗");
        hq.href = "http://127.0.0.1:8377/#w-" + encodeURIComponent(s.session);
        hq.target = "_blank";
        hq.title = "Open this session in the HQ dashboard";
        row.appendChild(hq);
        const x = ccEl("button", "bce-cc-x", "✕");
        x.type = "button";
        x.title = "Kill this session (tmux + claude) and remove it";
        x.addEventListener("click", async () => {
          x.disabled = true;
          x.textContent = "…";
          const r = await hqSend({ type: "hqKill", session: s.session });
          // "refusing/not found" etc. means it's already gone — safe to drop;
          // but if HQ is unreachable the worker may still be RUNNING: keep the
          // row so the user knows, and flag it.
          if (!r.ok && /unreachable/i.test(r.error || "")) {
            x.disabled = false;
            x.textContent = "✕";
            const dot = row.querySelector(".bce-cc-dot");
            dot.dataset.status = "unreachable";
            dot.title = "Kill failed: " + r.error;
            return;
          }
          saveCcSessions((await loadCcSessions()).filter((v) => v.session !== s.session));
          row.remove();
        });
        row.appendChild(x);
        tray.appendChild(row);
      }
      pollTray();
    }

    async function pollTray() {
      const rows = [...tray.querySelectorAll(".bce-cc-sess")];
      if (!rows.length) return;
      const r = await hqSend({ type: "hqWorkers" });
      for (const row of rows) {
        const dot = row.querySelector(".bce-cc-dot");
        if (!r.ok) { dot.dataset.status = "unreachable"; dot.title = r.error; continue; }
        const w = (r.workers || []).find((x) => x.session === row.dataset.session);
        dot.dataset.status = w ? w.status : "gone";
        dot.title = w ? `${w.status}${w.tail ? "\n\n" + w.tail : ""}` : "session no longer exists";
        // once the worker's remote-control bridge connects, HQ exposes its
        // claude.ai URL — the session name becomes the link
        const name = row.querySelector(".bce-cc-name");
        if (w && w.web_url && name && !name.href) {
          name.href = w.web_url;
          name.target = "_blank";
          name.title = "Open this session in claude.ai Claude Code";
        }
      }
    }

    pop.renderTray = renderTray;
    pop.pollTray = pollTray;
    return pop;
  }

  function ccClosePopover() {
    const pop = document.getElementById("bce-cc-pop");
    if (pop) pop.remove();
    clearInterval(ccPollTimer);
    ccPollTimer = null;
  }

  function ccTogglePopover(btn) {
    const open = document.getElementById("bce-cc-pop");
    const wasOwn = open && open.dataset.owner === btn.dataset.url;
    ccClosePopover();
    if (wasOwn) return; // same button ⇒ plain toggle-closed
    const pop = ccBuildPopover(btn.dataset.url);
    pop.id = "bce-cc-pop";
    pop.dataset.owner = btn.dataset.url;
    document.body.appendChild(pop);
    // open just above the button, growing rightward (button is bottom-left)
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 356)) + "px";
    pop.style.bottom = (window.innerHeight - r.top + 8) + "px";
    pop.renderTray();
    ccPollTimer = setInterval(() => pop.pollTray(), 5000);
    pop.querySelector(".bce-ccpop__prompt").focus();
  }

  // Click anywhere outside the popover (and not on a launcher button, which
  // has its own toggle semantics) closes it. Capturing, so Basecamp can't
  // swallow the event first.
  document.addEventListener("pointerdown", (e) => {
    const pop = document.getElementById("bce-cc-pop");
    const t = e.target;
    if (pop && !pop.contains(t) && !(t.closest && t.closest(".bce-cc-btn"))) ccClosePopover();
  }, true);

  function applyCcLaunchers() {
    if (!document.body) return;
    for (const pane of ccPanes()) {
      let btn = pane.host.querySelector(".bce-cc-btn");
      if (!btn) {
        pane.host.classList.add("bce-cc-host");
        btn = ccEl("button", "bce-cc-btn");
        btn.type = "button";
        btn.title = "Launch Claude Code on this conversation";
        const img = document.createElement("img");
        img.src = chrome.runtime.getURL("icons/claudecode.png");
        img.alt = "Claude Code";
        btn.appendChild(img);
        btn.addEventListener("click", () => ccTogglePopover(btn));
        // chat/ping panes: mount as the last icon in the composer's tool row
        // (emoji/attach/mic/format) — collision-proof in both the sidebar and
        // the maximized room, where `.chat__tools` floats over the input's
        // right edge and an absolute button would overlap the format button.
        // Fallbacks: the input's `.relative` gutter, then the pane host.
        const tools = pane.mode === "pane" && pane.host.querySelector(".chat__footer .chat__tools");
        const slot = !tools && pane.mode === "pane" && pane.host.querySelector(".chat__footer form.chat__form > .relative");
        if (tools) {
          tools.appendChild(btn);
        } else if (slot) {
          slot.closest("form").classList.add("bce-cc-beside");
          slot.appendChild(btn);
        } else {
          // main record view: a bookmark-style tab in the left gutter. It's
          // `position:fixed` with its `top` set by ccPositionMain on scroll so
          // it follows the pane's title then clamps to the top (sticky doesn't
          // paint here — an ancestor in the scroll chain breaks it).
          pane.host.appendChild(btn);
        }
      }
      // keep fresh — Turbo navigations reuse panes with new content
      btn.dataset.mode = pane.mode;
      btn.dataset.url = pane.url;
    }
    ccPositionMain();
    if (!ccBusyTimer) {
      ccBusyTimer = setInterval(ccSyncBusy, 10000);
      ccSyncBusy();
    }
  }

  // Position the main-view button: fixed in the left gutter, its `top` tracking
  // the pane's title until it would scroll off, then clamped to CC_MAIN_CLAMP —
  // "follows then clamps" like a sticky tab, but painted reliably (sticky fails
  // to paint inside Basecamp's scroll container).
  const CC_MAIN_CLAMP = 76;
  let ccMainRAF = 0;
  function ccPositionMain() {
    ccMainRAF = 0;
    const btn = document.querySelector('.bce-cc-btn[data-mode="main"]');
    const main = btn && (btn.closest("main") || document.querySelector("main"));
    if (!btn || !main) return;
    const m = main.getBoundingClientRect();
    btn.style.left = Math.max(6, Math.round(m.left) - 46) + "px";
    btn.style.top = Math.max(CC_MAIN_CLAMP, Math.round(m.top) + 40) + "px";
  }
  function ccQueueMain() { if (!ccMainRAF) ccMainRAF = requestAnimationFrame(ccPositionMain); }
  window.addEventListener("scroll", ccQueueMain, { passive: true });
  window.addEventListener("resize", ccQueueMain);

  function removeCcLaunchers() {
    document.querySelectorAll(".bce-cc-btn").forEach((b) => b.remove());
    document.querySelectorAll(".bce-cc-beside").forEach((f) => f.classList.remove("bce-cc-beside"));
    document.querySelectorAll(".bce-cc-host").forEach((h) => h.classList.remove("bce-cc-host"));
    clearInterval(ccBusyTimer);
    ccBusyTimer = null;
    ccClosePopover();
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
    // a newly opened ping window is a new pane — give it its button right away
    if (settings.ccLaunch) applyCcLaunchers();
  }

  // Theme: our overlays can't use Canvas/CanvasText (Dark Reader can't rewrite
  // system colors) OR hardcoded light colors (Basecamp's native dark theme
  // keeps its menu items' light text → light-on-white). So detect the page's
  // REAL background luminance at runtime — it reflects whatever produced it
  // (Basecamp dark theme, Dark Reader, anything) — and flip .bce-dark on
  // <html> to select the overlay palette.
  function pageIsDark() {
    let el = document.body || document.documentElement;
    let bg = "";
    while (el) {
      bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) break;
      el = el.parentElement;
    }
    const m = bg && bg.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return false;
    const [r, g, b] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  }

  function syncTheme() {
    document.documentElement.classList.toggle("bce-dark", pageIsDark());
  }

  // Apply or revert each feature across the whole page to match settings.
  function reconcile() {
    syncTheme();
    if (settings.timeLabels) decorateAllTimes(); else removeTimeLabels();
    if (settings.rtl) applyAutoDir(); else removeAutoDir();
    if (settings.inlineReactions) applyInlineReactions(); else removeReactionBars();
    if (settings.inlineReactions || settings.inlineMenus) applyHoverBars(); else removeHoverBars();
    if (!settings.inlineMenus) removeHoverMenus();
    // Launcher buttons are per-pane; Turbo body swaps drop them, and the
    // turbo:* → reconcile listeners bring them right back.
    if (settings.ccLaunch) applyCcLaunchers(); else removeCcLaunchers();
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
