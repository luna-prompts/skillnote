# SkillNote 0.5.3

A polish and positioning release. Nothing dramatic on the API side, no new commands, no breaking changes, but every part of the front door got a careful pass. The sidebar information architecture is cleaner, the README leads with the problem Claude Code users actually feel, and the install paths now include Homebrew alongside npm.

## Homebrew is in

You can now install SkillNote with Homebrew on macOS or Linux:

```bash
brew install luna-prompts/tap/skillnote
skillnote start
```

The formula pulls the same `skillnote` package from npm but lets `brew` manage the binary. Node 20+ comes in as a Homebrew dependency, so you don't need a pre-existing Node install.

Other install paths are unchanged: `npx skillnote start`, raw Docker Compose, or `clawhub install skillnote` for the OpenClaw side.

## The sidebar got fixed

Two complaints we'd been hearing:

- Analytics felt buried under Connect, when it's really a view of your skill data, not part of the agent setup flow.
- The Connect group label was repeating its only item ("CONNECT > Connect").

Both are fixed. The sidebar is now:

```
WORKSPACE                INTEGRATIONS
  Skills                   Connect
  Collections
  Analytics
  Marketplace
```

Analytics and Marketplace live with the rest of your skill-management surface. The agent wire-up page sits in its own clearly-named INTEGRATIONS group. No more orphan items between the two sections.

## The README leads with the problem

The README has been fully rewritten. It now opens with the **8,000-character Claude Code skill truncation** issue (the pain new SkillNote users actually feel) instead of a feature tour. Down from 659 to ~495 lines.

Two new pieces worth pointing out:

1. **Five community skill registries are linked one click away.** `anthropics/skills`, `ComposioHQ/awesome-claude-skills` (800+ skills), `alirezarezvani/claude-skills` (600+), `garrytan/gstack` (50+), `obra/superpowers`. New installs aren't staring at an empty Skills page anymore. They have a clear next step.

2. **Four LLM-search-friendly FAQ entries** sit at the top of the FAQ: *"What is SkillNote?"*, *"How is SkillNote different from MCP?"*, *"How do I share Claude Code skills across my team?"*, *"Is SkillNote free?"*. Phrased the way people actually ask ChatGPT or Claude about a project, so SkillNote is more likely to surface when someone asks an AI assistant for help.

## PWA dock icon is finally black

If you'd installed SkillNote as a PWA on macOS or Android, you were seeing a teal frame around the black LP logo. That was a bug in the maskable icon PNG, not the manifest theme color (the manifest was already correct after 0.5.2). Fixed in 0.5.3.

**Existing PWA users:** browsers cache the dock icon. To pick up the new all-black icon, uninstall the SkillNote PWA from your dock or home screen, then reinstall it via Chrome's address bar ("Install SkillNote") or `⋮ → Cast/Save/Share → Install SkillNote`.

## Upgrading

If you're on the npm path:

```bash
npx skillnote restart
```

That pulls the new images. No data migration. No config changes. The Postgres volume is preserved across the restart.

If you're on the raw Docker Compose path:

```bash
curl -fsSL https://raw.githubusercontent.com/luna-prompts/skillnote/cli-v0.5.3/deploy/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

The OpenClaw skill bundle gets updated automatically on the next `sync.sh` run, which happens every 60 seconds and on each Claude session start.

## What's next

A few items already in motion for the next minor release:

- **Phase 2C deprecation** of the legacy v0.4 file-push commands (`login`, `add`, `update`, `remove`, `check`, `doctor`) in favor of the lifecycle CLI. Tracked in issue [#40](https://github.com/luna-prompts/skillnote/issues/40).
- **API authentication** for non-localhost deployments. Currently the API is open to anything that can reach `:8082`. The roadmap is a pluggable auth layer so SkillNote is safe behind a reverse proxy without bolt-on hacks.
- **Cursor and Codex CLI native plugins.** OpenHands and Antigravity are further out. Open an issue if you'd like to help with any of them.

---

**Links:** Full changelog in [`CHANGELOG.md`](CHANGELOG.md) · GitHub Release [`cli-v0.5.3`](https://github.com/luna-prompts/skillnote/releases/tag/cli-v0.5.3) · npm: `skillnote@0.5.3` · Docker: `ghcr.io/luna-prompts/skillnote-{api,web}:0.5.3` · clawhub: `skillnote@0.5.3`

**Help wanted:** join us on [Discord](https://discord.gg/GazU4amU6H) or [open an issue](https://github.com/luna-prompts/skillnote/issues).
