# SkillNote — Browser Extension

Sync your [SkillNote](https://github.com/luna-prompts/skillnote) skills to
your [claude.ai](https://claude.ai) account.

## What it does

- Watches your self-hosted SkillNote backend for skill changes.
- Pushes new and updated skills to claude.ai's Customize → Skills section,
  using your existing claude.ai login (no separate API key needed).
- Pulls claude.ai-authored skills back into SkillNote, so both surfaces
  stay in sync.

## Privacy

This extension uses Chrome's `cookies` permission to read your claude.ai
session cookies. It never sends those cookies anywhere — they stay in your
browser and authenticate requests to `claude.ai` only. Skill content flows
**from your SkillNote → your browser → claude.ai**. The SkillNote project
never sees your data.

The extension's source is open: see `extensions/claude-ai/` in the
SkillNote monorepo.

## Building

```
cd extensions/claude-ai
npm install
npm run build
# loadable unpacked extension lives in dist/
```

To load in Chrome:

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `extensions/claude-ai/dist`

To package for the Chrome Web Store:

```
npm run package
# produces skillnote-extension.zip
```

## Architecture

- **`src/background.ts`** — Manifest V3 service worker. Runs the sync loop,
  handles the pairing handshake, dispatches operations to claude.ai.
- **`src/lib/claude-ai-client.ts`** — claude.ai internal-endpoint client.
  Uses `credentials: "include"` so the user's session cookies (read via the
  `cookies` permission) authenticate every request.
- **`src/lib/skillnote-client.ts`** — SkillNote backend REST client. Uses
  the extension token issued at pairing time.
- **`src/popup.{html,ts}`** — toolbar status panel.
- **`src/options.{html,ts}`** — full-page settings: pair / disconnect.

See `docs/claude-ai-integration.md` and `docs/claude-ai-endpoints.md` in
the SkillNote repo for the full architectural rationale.

## License

MIT.
