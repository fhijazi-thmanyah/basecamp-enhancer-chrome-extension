# Chrome Web Store submission pack

Everything the Developer Dashboard asks for, ready to paste. Build the upload zip
with `./scripts/build.sh` (it validates first and refuses to build a package the
store would reject), then upload it at
<https://chrome.google.com/webstore/devconsole>.

Current package: **v1.21.1** · distribution **Unlisted** (a private link; not
searchable in the store).

---

## 1. Store listing tab

**Item name:** `Basecamp Enhancer`

**Summary** (taken from `manifest.json` → `description`, max 132 chars):

> Quality-of-life for Basecamp: relative timestamps, an Arabic RTL fix, one-click emoji reactions and a hover action bar.

**Category:** Workflow & Planning · **Language:** English

**Description** (paste as-is):

```
Basecamp Enhancer adds six small quality-of-life features to the Basecamp web app. Each one is an independent toggle in the extension popup, applies instantly to open tabs, and turning them all off leaves Basecamp exactly as it was.

• Relative timestamps — every date gets a "(6 days ago)" label next to it, so you can tell at a glance how old a message or todo is.

• Force RTL — Arabic text lays out right-to-left even when the line starts with an English word, a number or a link, in both rendered content and while you type. Basecamp's own dir="auto" gets this wrong for mixed Arabic/English writing; this decides direction by which script actually dominates the paragraph.

• One-click emoji reactions — react without opening the "…" menu. You choose the emoji set and its order in the popup.

• Hover action bar — a Google-Chat-style bar appears above a message on hover with your reaction emoji plus the whole action menu (reply, edit, bookmark, copy link, delete…), so common actions are one click instead of three. You can hide and reorder the menu items.

• Font picker — switch Basecamp's typeface to IBM Plex Sans Arabic (bundled) or one of three other bundled families, for readable Arabic.

• Usage analytics toggle — analytics and error reporting are on by default and can be switched off in one click. See the privacy policy for exactly what is collected.

Works on app.basecamp.com and 3.basecamp.com. No account, no sign-up, no configuration.

Open source: https://github.com/fhijazi-thmanyah/basecamp-enhancer-chrome-extension
Privacy policy: https://github.com/fhijazi-thmanyah/basecamp-enhancer-chrome-extension/blob/master/docs/PRIVACY.md
```

**Graphics**

| Asset | Requirement | Status |
|---|---|---|
| Store icon | 128×128 PNG | `icons/icon128.png` |
| Screenshots | 1280×800 (or 640×400), JPEG or **24-bit PNG with no alpha**, 1–5, **at least one required** | `docs/store-assets/screenshot-1-settings.png` + `screenshot-2-customize.png`, both 1280×800 TrueColor 8-bit. Regenerate with `./scripts/screenshot-popup.sh` (it fails rather than emit a wrong size or an alpha channel). |
| Small promo tile | 440×280, optional (unlisted items don't need it) | not provided |

The animated GIFs in `docs/media/` are README material, **not** store assets: the
store takes PNG/JPEG only, and those frames show a real colleague's name, face and
message content. Never upload a screenshot with real Basecamp content in it.

---

## 2. Privacy tab

**Single purpose** (paste):

```
Basecamp Enhancer has one purpose: improving the usability of the Basecamp web app for the signed-in user. Every feature is a UI enhancement rendered on top of Basecamp pages — relative-time labels, right-to-left layout for Arabic, quick emoji reactions, a hover action bar that reuses Basecamp's own action menu, and a font picker. The extension runs only on Basecamp domains and does nothing on any other site.
```

**Permission justifications** (one field each; paste verbatim):

`storage`
```
Stores the user's own settings so they persist between sessions and across their devices: which of the six features are enabled, the selected font, their chosen reaction emoji and the order these render in, and which action-menu items to show and in what order. It also caches the user's feature-flag values so the popup renders correctly on open. Nothing else is stored and none of it is transmitted to the developer — Chrome syncs it to the user's own account.
```

Host permissions (one field covers all of them)
```
app.basecamp.com and 3.basecamp.com: this is where the extension does its work. The content script reads the page's timestamps to append relative-time labels, reads paragraph text to decide whether it should be laid out right-to-left, inserts the reaction and action bars into Basecamp's own message elements, and — when the user clicks an emoji — posts that reaction to Basecamp's own endpoint on the user's behalf.

http://127.0.0.1:8377 and http://localhost:8377: for an optional companion feature that is off by default and hidden unless enabled for the account. It talks to a small server the user installs and runs on their own computer to start a local automation agent for the Basecamp conversation they are reading. These requests never leave the user's machine, and only the extension's service worker makes them — the local server has no authentication, so it must not be reachable from web page code.
```

**Remote code:** answer **"No, I am not using remote code"** — the dashboard still
requires a justification:

```
No remote code is used. All JavaScript, CSS and fonts the extension executes or loads ship inside the package. The bundled analytics library (vendor/posthog.js) is deliberately the "no-external" build, which inlines every dependency and never fetches additional scripts at runtime.
```

**Data usage — check these boxes** (all of them apply only while the user leaves
the "Usage analytics" toggle on; it is one click to turn off):

- [x] **Personally identifiable information** — the signed-in user's Basecamp email address and display name, used to attribute an error report to a person.
- [x] **Personal communications** — session replays of Basecamp pages can include the chat and message text on screen.
- [x] **User activity** — page views, clicks, dead clicks and heatmap data on Basecamp pages.
- [x] **Website content** — session replay records the rendered Basecamp page.
- [ ] Health · Financial and payment · Authentication information · Location · Web history — none collected.

**Certifications** (all three are true and must be ticked):

- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the item's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:**
`https://github.com/fhijazi-thmanyah/basecamp-enhancer-chrome-extension/blob/master/docs/PRIVACY.md`

---

## 3. Distribution tab

Visibility **Unlisted**. Unlisted keeps the item reachable only by direct link, which
is what the localhost host-permission and the identified analytics assume. Switching
to Public is a real change of posture — re-read the privacy disclosures above first.

---

## 4. Review-risk notes

Things a reviewer is most likely to question, and the honest answer:

1. **Localhost host permission.** Inert unless a server-side feature flag turns the
   launcher on. It is in the manifest because a manifest cannot be feature-flagged.
2. **Session recording of a third-party workplace app.** Disclosed in the privacy
   policy, in the listing description, and in the extension's own popup; opt-out is
   a single toggle and takes effect immediately.
3. **Bundled 543 KB analytics SDK.** The `array.full.no-external` build, chosen
   specifically because it never fetches code at runtime (MV3 forbids remote code).
4. **Bundled fonts.** IBM Plex Sans Arabic ships under the OFL with its `OFL.txt`;
   the three Thmanyah families are the publisher's own brand fonts.

## 5. Release checklist

1. `./scripts/build.sh` — syntax, tests, store limits, then `dist/basecamp-enhancer-<version>.zip`.
2. Bump `version` in `manifest.json` for every upload (the store rejects a duplicate version).
3. Upload the zip → Package tab; update the listing/privacy fields above only if they changed.
4. Submit for review. Unlisted items still go through review; expect same-day to a few days.
5. Tag the release: `git tag v<version> && git push --tags`.
