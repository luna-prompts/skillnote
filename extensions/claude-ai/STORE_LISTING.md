# Chrome Web Store + Firefox AMO Listing Copy

Use the copy below when submitting to the Chrome Web Store and Firefox
Add-ons. The text is intentionally explicit about cookie usage because
the `cookies` permission triggers extra reviewer scrutiny.

## Listing title

```
SkillNote — Sync skills to claude.ai
```

## Short description (132 char max — Chrome Web Store summary)

```
Sync your self-hosted SkillNote skills with your claude.ai account. Open-source, runs locally in your browser.
```

## Detailed description

```
SkillNote keeps your self-hosted skill registry in sync with your
claude.ai account.

When you publish a skill in SkillNote, it appears in your claude.ai
Customize → Skills section automatically. When you author a skill
directly in claude.ai, it flows back into SkillNote. No copy-pasting
ZIPs, no manual uploads.

How it works
─────────────
1. Install this extension.
2. Paste your SkillNote URL into the extension's settings.
3. Approve the pairing code on your SkillNote page.
4. Sign in to claude.ai (the extension reads the existing session
   cookies your browser already has).

That's it. Sync runs every minute while you're logged into claude.ai.

Why the `cookies` permission?
─────────────────────────────
claude.ai's skill upload UI uses session cookies for authentication, and
Anthropic does not currently offer a public API for personal-account
skills. This extension uses Chrome's `cookies` permission to attach your
existing claude.ai session to the same internal endpoints the web UI
itself calls. Cookies are NEVER sent anywhere except to claude.ai.

The extension is open source — you can verify exactly what it does:
https://github.com/luna-prompts/skillnote/tree/main/extensions/claude-ai

Privacy
───────
- Skill content flows between YOUR self-hosted SkillNote and YOUR
  claude.ai account.
- The SkillNote project (the open-source maintainers) never sees your
  data.
- No analytics, no fingerprinting, no third-party trackers.
- Full privacy policy:
  https://github.com/luna-prompts/skillnote/blob/main/extensions/claude-ai/PRIVACY.md

Requirements
────────────
- A self-hosted SkillNote instance reachable from your browser.
  Get SkillNote at https://github.com/luna-prompts/skillnote
- A paid claude.ai account (Pro, Max, Team, or Enterprise) for
  org/personal skills to be available.

Support
───────
Open an issue: https://github.com/luna-prompts/skillnote/issues
```

## Category

- Chrome Web Store: **Developer Tools** → **Productivity**
- Firefox AMO: **Productivity**

## Tags / search terms

```
claude, claude.ai, skills, anthropic, skillnote, sync, AI tools,
developer, productivity
```

## Permissions justification (Chrome Web Store reviewer questionnaire)

### `cookies`

> The extension reads the user's existing claude.ai session cookies in
> order to authenticate API calls to claude.ai's skill management
> endpoints on the user's behalf. The same cookies are already set by
> claude.ai when the user logs in normally. The extension never sends
> cookies anywhere except as part of HTTPS requests to claude.ai itself.
> This is functionally equivalent to the user clicking buttons in
> claude.ai's UI manually, just automated.

### `storage`

> Persists the user's configuration (their SkillNote URL, their
> extension token from pairing, and pairing handshake state). Stored
> locally in `chrome.storage.local`; never synced cross-device.

### `alarms`

> Schedules the sync loop (default every 60 seconds while claude.ai is
> reachable). Required by Manifest V3 because service workers can't use
> `setTimeout` for long-lived schedules.

### `notifications`

> Surfaces critical sync issues (session expired, endpoint changed)
> when the user isn't actively viewing the panel.

### `sidePanel`

> The extension's entire UI is a side panel (opened from the toolbar
> icon) rather than a popup — a persistent, full-height surface that
> stays visible beside claude.ai while the user works. No data access;
> it only controls where the extension's own page renders.

### `scripting`

> Two narrow uses, both on origins the user already granted host access
> to (claude.ai and the user's own SkillNote URL): (1) inject a small
> content script that relays a "sync now" signal from the SkillNote web
> app and reports the page's light/dark theme so the panel can match it;
> (2) read the active page's rendered background color to detect that
> theme. No remote code is ever executed — only the extension's own
> bundled `content.js`.

### `host_permissions: https://claude.ai/*`

> Required for the extension to call claude.ai's API endpoints. Without
> this, `fetch` to claude.ai paths is cross-origin-blocked.

### `optional_host_permissions: http://*/*, https://*/*`

> Requested at pair-time when the user pastes their SkillNote URL,
> scoped to that specific origin. The blanket `<all_urls>` is the
> Chrome optional-permission API's way of letting us prompt per-host;
> we never actually use it for any host other than the user's
> SkillNote URL.

## Screenshots required (Chrome Web Store: at least 1, 1280×800)

1. **Hero shot** — the side panel **Connected**, showing the "This week
   on claude.ai" usage card + the live collections. A standalone render
   is in `docs/screenshots/claude-ai-connector.png`; for the store,
   capture it docked beside claude.ai at 1280×800.
2. **Pairing** — the side panel showing the 6-char code, next to the
   SkillNote notifications-bell approval popover.
3. **In claude.ai** — claude.ai's **Customize → Plugins** with the
   "SkillNote: <collection>" plugin group synced from SkillNote.
4. **Collection sync** — a SkillNote collection's **Sync ▾ → claude.ai**
   toggle (where the user chooses what syncs).
5. **Settings** — the panel's in-panel Settings view (connection health
   + disconnect).

Recommended 1280×800 PNG, no transparent background. Item 1's standalone
render is committed; the rest are TODO (need a live claude.ai session).

## Promotional images (Chrome Web Store optional but recommended)

- Small tile: 440×280 PNG
- Marquee: 1400×560 PNG

Same visual language as the SkillNote main product to anchor brand
recognition.

## Pricing

Free.

## Submission checklist

- [ ] All TODOs above resolved (real Chrome Web Store URL in
      `backend/app/api/setup.py`, real Firefox AMO URL, real
      screenshots, real privacy policy email)
- [ ] Source-code repository link works
- [ ] Privacy policy URL works
- [ ] `version` in manifest matches the tag we publish from
- [ ] All builds pass typecheck + vite build clean
- [ ] Real icons (not placeholders) at 16/48/128 (and 256 for marquee)
