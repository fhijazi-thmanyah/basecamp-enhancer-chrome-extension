# Privacy Policy — Basecamp Enhancer

**Last updated:** 2026-08-18 · Applies to the Chrome extension "Basecamp Enhancer" (Chrome Web Store, all versions from 1.21.1).

Basecamp Enhancer is a small Chrome extension that improves the Basecamp web UI. It runs **only** on `app.basecamp.com` and `3.basecamp.com` — it has no access to any other site you visit.

## What the extension collects

### Usage analytics and error reports (ON by default, one-click opt-out)

When the **Usage analytics** toggle in the extension popup is on, the extension sends the following to the developer's [PostHog](https://posthog.com) analytics project so that breakage can be found and fixed:

| Category | What exactly |
|---|---|
| **Identity** | Your Basecamp email address, display name, and Basecamp person id. The email is read once from your own Basecamp profile page and is used to attribute an error report to a person so we can follow up. |
| **Product usage** | Page views of Basecamp URLs, clicks on the Basecamp UI (autocapture), "dead" clicks, heatmap coordinates. |
| **Session recordings** | Replays of your Basecamp browsing session (page content and interactions), limited to Basecamp domains. **This can include the text of Basecamp projects, messages and chats you have open.** |
| **Extension events** | Which feature toggles you change, when a quick reaction is sent (and the emoji), when the Claude Code launcher is used, and crash/error reports **originating in this extension's own code** (Basecamp's own script errors are filtered out and never sent). |
| **Automatic technical data** | IP address (used by PostHog to derive an approximate location, then discarded from display), browser and operating system, device type, extension version, timestamps. |

**Turning it off:** open the extension popup and switch **Usage analytics** off. This takes effect immediately, in every open tab, with no reload — no further events and no session recording are captured.

Analytics are sent to `https://posthog.fhijazi.com`, a reverse proxy operated by the developer that forwards to **PostHog Cloud (US)**, operated by PostHog Inc. as our data processor. The developer does not keep a separate copy; data lives in that PostHog project and is deleted according to the project's retention settings.

### Settings and local state (never sent anywhere)

* Your feature toggles, chosen font, emoji set and menu order are stored in `chrome.storage.sync` — i.e. by Chrome itself, in your own Google account, so they follow you between machines.
* Your cached Basecamp identity, feature-flag values and launcher session list are stored in `chrome.storage.local` on your machine only.

Neither is transmitted to the developer.

### Claude Code launcher (hidden and disabled for almost everyone)

An experimental feature, gated behind a server-side feature flag and invisible unless it is enabled for your account, can start a local automation agent for a Basecamp conversation. When used, the **text you type** plus the **URL of the conversation** are sent to a server **running on your own computer** (`http://127.0.0.1:8377`, which you must install and start yourself). Nothing about this feature is sent to the developer or any third party, and the extension never scrapes Basecamp page content into it.

## What the extension never does

* It never runs on, reads, or collects anything from any site other than Basecamp.
* It never collects passwords, credentials, payment or financial information, health information, or authentication cookies.
* It never sells or rents your data, never transfers it for advertising, credit, or lending purposes, and never shares it with anyone other than the analytics processor named above.
* It never uses your data for any purpose other than operating, debugging and improving this extension.
* It loads no remote code — the analytics library is bundled inside the extension package.

## Your choices and rights

* **Opt out of all analytics** at any time from the popup toggle (see above).
* **Ask for deletion** of the analytics data associated with you by emailing the contact below; identify yourself with the Basecamp email address you use.
* **Remove everything** by uninstalling the extension — Chrome deletes its stored settings with it.

## Contact

Faris Hijazi — faris.hijazi@thmanyah.com
Source code and issue tracker: <https://github.com/fhijazi-thmanyah/basecamp-enhancer-chrome-extension>

Changes to this policy will be published at this URL with a new "Last updated" date.
