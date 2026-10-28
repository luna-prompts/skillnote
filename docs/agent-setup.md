# Luna multi-agent setup and rollout plan

Baseline: **1.0.0**. Repository: **skillnote**. Branch base: **master**, commit `7ea2fc7a8435af64d1c080d8765c0eabba1121ea`.

## Plan and included changes

1. Preserve repository architecture, commands, domain skills, and tool settings; make `AGENTS.md` the instruction entry point and `CLAUDE.md` its wrapper.
2. Enable project-scoped Claude Code, Codex, and Cursor from `.agents/agents.json` using `@agents-dev/cli@0.9.2`. Commit generated configuration so clones can inspect it immediately.
3. Install the versioned review/debug workflows; add API-contract review only to the relevant application repos and the shared skills source.
4. Document actual component validation commands in [agent-repository.md](agent-repository.md). No application dependencies or runtime code are changed.
5. Gate agent-configuration changes in CI: regenerate, check idempotency, and reject tracked or untracked configuration drift. No production credentials are used.
6. Maintain canonical workflow sources in `luna-prompts/skills` under `skills/engineering/luna-*`; export a versioned Agent Plugin there and distribute deliberate updates through reviewed branches/PRs. `agents sync` does not fetch changes from other repositories.

## Onboarding

Requires Node >=20.12 and npm (Node 22 in CI). From the checkout:

```sh
sh scripts/luna-agents.sh sync
sh scripts/luna-agents.sh sync --check
sh scripts/luna-agents.sh doctor
```

The wrapper pins the CLI without changing application dependencies. The first invocation downloads it through npm; it does not install coding-tool clients. Choose/trust the project in each coding tool yourself. Cursor auto-approval and global integration sync are disabled. No global config installation is part of this rollout.

## Sources versus generated files

Edit `AGENTS.md`, `.agents/agents.json`, and selected `.agents/skills/` sources, then sync. Review generated `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, skill bridges, and `CLAUDE.md` alongside the source. Preserve unrelated tool settings. Existing physical `.claude/skills` directories are retained; baseline skills have individual relative links there. Upstream may report that the whole existing directory is unmanaged; that preservation warning is expected.

On Windows, enable Git symlink support/Developer Mode before checkout, or materialize skill links as local directory copies. Verify discovery in the actual client; config generation alone does not prove client behavior.

## MCP and secrets

Only existing project-relevant servers are migrated. Other repositories start with no MCP servers; shell/git/file tools do not need duplicate MCP registrations. Existing shadcn package arguments are retained in frontend repos. The backend's formerly unscoped Supabase entry is replaced with explicitly named Community/Enterprise endpoints carrying `project_ref` and `read_only=true`. Each developer authenticates with their own account; do not remove read-only or project scoping.

Never commit tokens or `.agents/local.json`. Store credential values locally or in environment variables and use placeholders in shared configuration. `.agents/generated/`, local overrides, plugin data, and migration backups are ignored. Existing checked-in application environment files are not modified or propagated by this work. Do not run integration tests against production by accident.

## CI semantics

`agents sync --check` expects local generated state, which is ignored. Therefore a fresh CI checkout runs `sync` first, then `sync --check`, and also checks Git for changes to all managed paths. The Git comparison is essential: sync-then-check alone would silently accept stale committed output. Doctor can report missing optional local overrides, missing client binaries/project trust, and pre-existing skill issues; it is diagnostic, not the drift gate. The skills marketplace uses a top-level `version` field for versioning; CLI 0.9.2 warns that this field is outside its strict Agent Skills schema. This compatibility warning does not prevent discovery, sync, or plugin validation.

## Updating the shared baseline

Change the canonical skill source in the skills repository, bump its version and changelog, validate it, and re-export `plugins/luna-engineering`. Copy only the selected workflow sources into each consuming repo, update `.agents/luna-baseline.json` version/hashes, sync, validate, and propose a branch/PR. Do not bulk-import every marketplace skill or overwrite existing domain skill trees. The baseline manifest records SHA-256 content fingerprints; no implicit background updates are enabled.

## Rollout and rollback

Review the luna-enterprise/luna-service pair first, then remaining repositories. Smoke-test skill discovery and instruction loading with installed Claude/Codex/Cursor clients before merging. Application tests remain specific to the changed application surface. No merge, deployment, service restart, database write, or client runtime verification is implied by generating these files. Roll back by reverting the baseline commit; keep local credentials out of Git.
