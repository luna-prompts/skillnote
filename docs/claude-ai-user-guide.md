# Claude.ai Sync — User Guide

SkillNote can keep your skills in sync with your [claude.ai](https://claude.ai)
account so a skill you publish in SkillNote shows up in claude.ai's
**Customize → Skills** section automatically, and a skill you author
directly on claude.ai flows back into SkillNote.

This guide walks you through setup. **One-time, ~60 seconds.**

> **Requirements**
>
> - A self-hosted SkillNote instance reachable from your browser.
> - A paid claude.ai account (Pro, Max, Team, or Enterprise).
> - Chrome, Edge, Brave, Arc, or any Chromium browser (Firefox AMO version
>   in beta).

## Setup in three steps

### 1. Install the SkillNote browser extension

- **Chrome / Edge / Brave / Arc** —
  [Chrome Web Store listing](https://chrome.google.com/webstore/category/extensions)
  *(replace with real URL after submission)*
- **Firefox** —
  [Firefox Add-ons listing](https://addons.mozilla.org/) *(beta)*
- **Local dev** — clone the repo, run `npm run build` in
  `extensions/claude-ai/`, then load `dist/` as an unpacked extension at
  `chrome://extensions`.

### 2. Connect the extension to your SkillNote

1. Click the SkillNote extension icon in your browser toolbar.
2. Click **Open settings** if it's not your first time, or just paste
   directly: your SkillNote URL (e.g. `https://skillnote.acme.com`).
3. The extension prompts for permission to talk to that URL — click
   **Allow**.
4. Click **Connect**.

A new tab opens showing a 6-character pairing code.

### 3. Approve the pairing in SkillNote

The pairing page in SkillNote shows the same 6-character code that the
extension displayed.

**Verify the codes match**, then click **Approve**.

Within a second, the extension is connected. The new tab redirects you
to the claude.ai connector settings page, where you'll see your browser
listed under **Connected browsers**.

## What happens next

- Skills you publish or edit in SkillNote now appear in your
  claude.ai **Customize → Skills** section within a minute.
- Skills you author directly in claude.ai are pulled back into SkillNote
  on the next reverse-sync cycle (every ~15 minutes when claude.ai is
  open in your browser).
- The extension reads your existing claude.ai session cookies — it
  never asks for a separate API key.

## Granular control

### Per-skill sync toggle

Some skills are dev-only or contain sensitive content you don't want on
claude.ai. On any skill's detail page, look for the
**Syncing to claude.ai** badge in the header. Click to toggle off — that
skill stops syncing immediately. Skills already pushed to claude.ai stay
there until you delete them; future updates simply stop firing.

### Conflict resolution

If you edit the same skill on both sides since the last sync, the
connector marks it **diverged** instead of guessing which version wins.
You'll see a **Conflicts** section on the connector settings page with
three options per skill:

- **Keep SkillNote** — overwrites claude.ai with your SkillNote version.
- **Keep claude.ai** — overwrites SkillNote with the claude.ai version.
- **Skip** — clear the warning; you can resolve manually later.

### Activity feed

Every action the connector takes (pairings, pushes, imports, conflicts,
errors) is logged. Visit **Settings → claude.ai → View all activity** to
see the full history with search and filter.

## Common issues

### "Sign in to claude.ai to keep syncing"

The extension lost your claude.ai session. Open
[claude.ai](https://claude.ai), sign back in, and the extension picks up
the new cookies automatically. No re-pairing needed.

### Connection status shows "Error"

Check the **Last error** message on the connector settings page. The most
common causes:

- **claude.ai endpoint changed** — Anthropic redesigned an internal
  endpoint. The extension auto-updates via the Chrome Web Store; if
  Auto-update is disabled, manually update from
  `chrome://extensions` → SkillNote → "Update."
- **SkillNote unreachable** — verify the URL in the extension's options
  matches your SkillNote backend.

### "Pairing code has expired"

Pairing codes are valid for 10 minutes. Restart the pairing flow from
the extension's settings.

### Disconnecting

On the connector settings page, click **Disconnect** next to a browser.
This revokes the extension's bearer token. Skills already synced to
claude.ai stay there until you delete them individually — disconnect
does *not* sweep claude.ai's side.

## Privacy

The extension uses your browser's existing claude.ai session cookies
to authenticate requests **to claude.ai only**. Cookies never leave your
browser except as part of normal claude.ai requests. The SkillNote
project never sees your skill content — data flows
**your SkillNote → your browser → your claude.ai**, end to end.

Full policy: [`extensions/claude-ai/PRIVACY.md`](../extensions/claude-ai/PRIVACY.md).

## Architecture reference (for the curious)

See [`docs/claude-ai-integration.md`](claude-ai-integration.md) for the
full design rationale: data model, sync queue, pairing handshake,
conflict detection, audit log, and rate limits.

## Support

Open an issue: <https://github.com/luna-prompts/skillnote/issues>.
