# SkillNote Browser Extension — Privacy Policy

**Effective**: 2026-05-24

## What this extension does

The SkillNote browser extension keeps your self-hosted SkillNote instance
in sync with your claude.ai account. It runs entirely in your browser and
on the servers you control. The SkillNote project does not operate any
service that handles your data.

## What we access

| Data | Where it comes from | Where it goes | Purpose |
|---|---|---|---|
| Your claude.ai session cookies | Your browser (via Chrome's `cookies` permission) | Only attached to requests sent to `https://claude.ai` (never anywhere else) | Authenticate API calls to claude.ai's internal skill endpoints, on your behalf, using your existing login |
| Your SkillNote URL | You type it into the extension's settings | Stored in `chrome.storage.local` | The extension contacts only this URL for skill data |
| Your SkillNote extension token | Issued by your SkillNote backend after you approve the pairing | Stored in `chrome.storage.local`; sent only to your SkillNote URL | Authenticate requests back to your SkillNote |
| Skill content (SKILL.md + bundled files) | Your SkillNote backend | Pushed to your claude.ai account | Sync skills you've created in SkillNote into claude.ai |
| Skill content (read direction) | Your claude.ai account | Pushed back to your SkillNote backend | Reverse-sync: skills authored in claude.ai become available in SkillNote |

**The SkillNote project (the maintainers of this open-source extension)
never receives any of the above data.** All requests go between your
browser, your self-hosted SkillNote instance, and Anthropic's claude.ai
servers — full stop.

## What we do NOT access

- We do not read claude.ai conversation content or chat history.
- We do not access cookies for any domain other than `claude.ai` and
  `claude.com`.
- We do not run analytics, fingerprinting, or telemetry by default.
  Optional anonymous failure reporting can be enabled in the extension's
  settings; when enabled, reports go to **your** SkillNote backend (not
  the SkillNote project).
- We do not sell, share, or transfer your data to third parties.

## How sessions work

When you sign in to claude.ai, your browser stores a session cookie that
claude.ai uses to identify you. This extension uses Chrome's `cookies`
permission to read that cookie and attach it to API requests sent **to
claude.ai only**. The cookie never leaves your browser except as part of
a request to claude.ai (which already received it when you logged in).

When you sign out of claude.ai, the extension detects the cookie removal
and pauses sync. You can also disconnect the extension at any time from
its options page — this revokes the extension's token at your SkillNote
backend and clears all locally stored state.

## Open source

The extension's source code is published under MIT at:
<https://github.com/luna-prompts/skillnote/tree/main/extensions/claude-ai>

You can build it yourself and verify that the code matches what's
distributed via the Chrome Web Store and Firefox Add-ons.

## Contact

Questions or concerns: open an issue at
<https://github.com/luna-prompts/skillnote/issues> or email
privacy@skillnote.dev (TODO: set up if not already).

## Changes

If we materially change how this extension handles data, we'll update
this document and bump the extension version. The change history is
visible in the extension's GitHub repository commit log.
