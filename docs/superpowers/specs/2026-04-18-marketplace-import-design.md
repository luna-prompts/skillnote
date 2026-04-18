# Marketplace Import — Design Spec

**Date:** 2026-04-18
**Branch:** `master-0.3.3`
**Target version:** v1 (0.3.3) — web UI + publish-back
**Deferred to v1.1 (0.3.4):** terminal picker Browse tab

---

## Problem

SkillNote users need to import skills from public git repos (Claude Code marketplaces like `wshobson/agents`, `anthropics/skills`) into their SkillNote instance. Today, the only way to get skills into SkillNote is to create them manually in the web UI or push them via the plugin. We want:

1. A **paste-URL import flow** that handles every input format Claude Code accepts.
2. A **`Browse` surface** that's discoverable for non-technical users and powerful for experienced ones.
3. A **publish-back endpoint** that exposes SkillNote collections as Claude-Code-compatible marketplaces — making SkillNote a two-way hub.

## Goals

- Let a user paste `wshobson/agents` (or similar) and have its skills imported into SkillNote in < 30 seconds.
- Make the feature discoverable within 30 seconds of first opening the app (mom-user test).
- Match Claude Code's input parsing and manifest semantics exactly so imports are predictable.
- Expose every (imported-skill) SkillNote collection as a real Claude Code marketplace at `GET /marketplace/{slug}.json`.
- Ship in one focused release (v1 = web UI; v1.1 = terminal picker tabs).

## Non-Goals

- Scheduled background sync (deferred to v2; v1 uses visit-triggered HEAD probes).
- Private-repo import with server-stored tokens (v1 uses localStorage PATs only).
- Shell-block / prompt-injection content scanning (deferred to v1.1).
- Featured/curated registry (deferred to v2 — "Browse library" button stays disabled with "Coming soon" tooltip).
- Publish-back for user-authored skills (v1 only round-trips imported skills; user-authored skills get a `⊙ local only` chip).
- Terminal picker Browse tab (deferred to v1.1).

## Architecture

### Module split

```
backend/app/api/
  imports.py                    # HTTP routes
  marketplace.py                # publish-back route

backend/app/services/imports/
  __init__.py
  input_parser.py               # pure: ports parseMarketplaceInput.ts
  inspector.py                  # read-only fetch + detect kind
  importer.py                   # transactional apply
  refresher.py                  # cheap HEAD probe + diff
  publisher.py                  # collection → marketplace.json
  manifest_schema.py            # Pydantic manifest models

backend/app/db/models/
  import_source.py              # new model
  skill.py                      # extended with source FK + hash

backend/alembic/versions/
  0013_import_sources.py
```

**Boundary philosophy:** `input_parser` is pure. `inspector` does I/O but no writes. `importer` is the only write path. `refresher` reads + updates status columns only. `publisher` is read-only. Each module is testable in isolation with no mocking gymnastics.

### Data model (migration 0013)

**New table `import_sources`:**

```python
class ImportSource(Base):
    __tablename__ = "import_sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)

    source_type: Mapped[SourceType] = mapped_column(
        Enum("github", "git", "url", "git_subdir", "file", "directory",
             name="import_source_type"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    host: Mapped[Optional[str]]
    owner: Mapped[Optional[str]]
    repo: Mapped[Optional[str]]
    subpath: Mapped[Optional[str]]
    ref: Mapped[Optional[str]]

    kind: Mapped[ImportKind] = mapped_column(
        Enum("marketplace", "plugin", "skill_bundle", "single_skill",
             name="import_source_kind"), nullable=False)

    collection_name: Mapped[str] = mapped_column(
        Text, ForeignKey("collections.name", ondelete="CASCADE"), nullable=False)

    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    imported_at_sha: Mapped[Optional[str]] = mapped_column(String(40))
    upstream_sha: Mapped[Optional[str]] = mapped_column(String(40))
    last_checked_at: Mapped[Optional[datetime]]
    last_synced_at: Mapped[Optional[datetime]]
    status: Mapped[ImportStatus] = mapped_column(
        Enum("up_to_date", "drift", "unreachable", "error",
             name="import_source_status"),
        nullable=False, default="up_to_date")
    last_error: Mapped[Optional[str]] = mapped_column(Text)

    created_at, updated_at  # server-side defaults

    __table_args__ = (
        UniqueConstraint("url", "ref", "subpath", name="uq_import_sources_canonical"),
        Index("ix_import_sources_status_checked", "status", "last_checked_at"),
        Index("ix_import_sources_collection", "collection_name"),
    )
```

**Skill table additions:**

```python
import_source_id: Optional[uuid.UUID]      # FK(import_sources.id) ON DELETE SET NULL
source_path: Optional[str]                 # path inside upstream repo
source_sha: Optional[str]                  # SHA at import time
source_content_hash: Optional[str]         # SHA-256 of SKILL.md at import
forked_from_source: bool DEFAULT FALSE     # set TRUE on user edit

Index("ix_skills_import_source", "import_source_id")
```

**Decisions:**

- `collection_name` not `collection_id` — the `collections` table uses `name` as PK (confirmed in 0.3.2 audit); FK targets `collections.name` with CASCADE.
- Enums over string literals — cheaper indexes, compile-enforced values.
- `host`/`owner`/`repo` denormalized — redundant with `url` but enables fast filtering without per-query URL parsing.
- `UNIQUE(url, ref, subpath)` — enforces Q8 decision (idempotent re-import merges into same row).
- `status` denormalized — `/browse` drift badge is one SELECT.
- `forked_from_source` as explicit flag — set by skill-update endpoint when imported skill is edited. Enables fast "all forked skills" queries.
- `ON DELETE SET NULL` on skill FK — unlinking a source retains skills by default; UI has explicit "also delete skills" confirm.

### No changes to collections table

The namespaced import collection is just a regular collection with `name = slugify(owner + '-' + repo)`. No `type` column needed — presence of `import_sources` rows pointing to it is sufficient signal.

## User Flow

### Primary discovery: sidebar `Browse`

Sidebar structure (new):

```
── WORKSPACE ──
   Skills
   Tags
   Collections
── DISCOVER ──
   Browse            ← new top-level
── UTILITIES ──
   Settings
```

Three groups max (NNG Menu-Design Checklist). `Browse` beats `Integrations` for mom-user discoverability (research-backed). Drift badge appears when any source has `status='drift'`: `Browse (3)`.

### Secondary discovery: collection page nudge

`/collections` page has a bottom inline nudge: *"Looking for more? Browse the community →"* (links to `/browse`). Double-surface so first-time users don't miss the feature.

### ImportSheet flow (paste URL)

Two-pane drawer with a draggable divider (shadcn/ui `Resizable` over `react-resizable-panels`).

**State machine:**

```
idle → typing → inspecting → (preview | inspect_failed)
                              preview → applying → (success | apply_failed)
                              success → toast + navigate to collection
```

- `typing → inspecting` fires on blur (not per-keystroke) OR explicit `Inspect` button click.
- `inspect_failed` keeps URL editable — no drawer teardown.
- `preview → inspecting` when user edits URL (triggers fresh inspect).
- `success` shows a momentary green check before transition.

**Layout:**

```
┌─ Import skills from a repository ──────────────────────────────── × ─┐
│  Repository or URL                                                   │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │ wshobson/agents                                           │     │
│  └───────────────────────────────────────────────────────────┘     │
│  ✓ Detected: GitHub repo · main · abc1234 · 12 skills · MIT         │
│                                                                     │
│  Advanced ▾  (subpath, ref override, private token — collapsed)     │
│                                                                     │
│  Import into:  [ Auto-create `wshobson-agents` ▼ ]  [ Edit ]        │
│                You can move skills into other collections after     │
│                import.                                              │
│                                                                     │
│  ──────────────────────────────────────────────────────────         │
│                                                                     │
│  Skills to import                    │    python-expert             │
│  [ 11 / 12 ]  filter…                │    ─────────────             │
│                                      │                              │
│  ☑ python-expert                     │    # Python Expert           │
│    Python code-review heuristics     │                              │
│                                      │    Use this skill when       │
│  ☑ react-tuner                       │    reviewing Python code     │
│    React perf optimization hints     │    for common heuristics…    │
│                                      │                              │
│  ☑ ⚠ code-review-checklist           │    (rendered SKILL.md)       │
│    Will rename to -2                 │                              │
│                                      │                              │
│  ☐ deprecated-helper                 │                              │
│    Deprecated: kept for history      │                              │
│                                      │                              │
│  … (all 12 visible, no collapse)   ↕ │                              │
│                                                                     │
│  Select all · Deselect all · Clear conflicts                        │
│                                                                     │
│  ────────────────────────────────────────────────────               │
│                        [ Cancel ]    [ Import 11 skills ]           │
└──────────────────────────────────────────────────────────────────────┘
```

**Divider:** 1px line (`bg-border`), accents to `bg-ring` on hover (200ms delay), 11px mouse hit area / 22px touch. Default 35% left / 65% right. Double-click resets. Keyboard: arrow keys resize, Shift+arrow = 50px, Home/End = min/max. Persists to `localStorage[react-resizable-panels:skillnote:import-drawer-split]`.

**Skill list behavior:**

- All skills visible (no collapse regardless of count).
- Search filter appears when > 15 skills.
- Live `[ selected / total ]` counter.
- Keyboard: ↑/↓ move focus + load preview, space toggles checkbox, Enter does NOT submit (prevents accidents).
- Conflict rows show `⚠` + inline message + per-row action dropdown `Rename (default) / Skip / Replace`.
- Mobile (< 900px): panes stack; preview becomes modal-over-modal on row click.

**"Import into" popover:**

Three radio options:
1. Auto-create new collection (default, derived from `owner-repo`)
2. Custom collection name (validated live against rules from 0.3.2)
3. Add to existing collection (dropdown of user's collections)

Inline tip: *"You can always move or copy skills to other collections after import."*

### Post-import feedback

Toast: `✓ Imported 11 skills from wshobson/agents — View collection →`

Navigation to `/collections/{slug}` shows:
- Top banner: `Imported from github.com/wshobson/agents · Tracking main · abc1234 · [Manage source]`
- Skills listed with small `Imported` chip per row
- All existing collection actions (move, remove, rename) work normally

### `/browse` page (sources list)

After first import:

```
┌─────────────────────────────────────────────────────────────────┐
│  Browse                                      [ + Add source ]   │
├─────────────────────────────────────────────────────────────────┤
│  [ All ] [ From GitHub ] [ From URL ]        ┌──────────────┐   │
│                                              │ 🔍 search    │   │
│                                              └──────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [GH]  wshobson/agents                      18 skills    │   │
│  │       main · synced 2m ago · abc1234              🔴 3  │   │
│  │                                            Resync   ⋯   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [GH]  anthropics/skills                    7 skills     │   │
│  │       main · synced 1d ago · def5678       up to date   │   │
│  │                                            Resync   ⋯   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Status pills: `up to date` (muted grey), `3 new · 1 changed` (amber with count), `unreachable` (red).

Card `⋯` menu: `Pin to this commit` / `Unpin` / `Change tracked ref` / `Unlink source`. Unlink opens confirm modal: *"Also remove the 18 skills from this source? [Remove all / Keep them as mine / Cancel]"*.

### Empty state

```
┌─────────────────────────────────────────────────────────┐
│ Browse                                  + Add source    │
├─────────────────────────────────────────────────────────┤
│              [ ⬡ icon ]                                 │
│                                                         │
│    Pull in skills from the community.                   │
│  Browse curated collections, or paste a GitHub URL      │
│              to import your own.                        │
│                                                         │
│   ┌───────────────────┐   ┌───────────────────┐        │
│   │ Browse library    │   │   Paste a URL     │        │
│   │ (Coming soon)     │   │    (primary)      │        │
│   └───────────────────┘   └───────────────────┘        │
│                                                         │
│                 What are skills? →                      │
└─────────────────────────────────────────────────────────┘
```

### Drift / refresh flow

On `/browse` page load:
- For each source where `last_checked_at` is > 10 min old AND `pinned=false`, backend issues one GitHub `GET /repos/{owner}/{repo}/commits/{ref}` (returns HEAD SHA in one round-trip).
- If SHA differs from `upstream_sha` → `status='drift'`, `upstream_sha` updated.
- In-memory LRU cache keyed on `(url, ref)` with 10-min TTL.
- User never waits on these — runs async as they land on page.

Click amber pill → `DiffDrawer`:

```
┌─ Updates for wshobson/agents ────────────────────── × ─┐
│  From main                                             │
│  abc1234  →  def5678                                   │
│                                                        │
│  ─── New (3) ─────────────────────────────────         │
│  ☑ python-expert                                       │
│    Add Python code-review heuristics.                  │
│                                                        │
│  ☑ react-tuner                                         │
│    React performance optimization hints.               │
│                                                        │
│  ─── Changed (1) ─────────────────────────────         │
│  ☐ code-review-checklist  ⚠ locally edited             │
│    Importing will overwrite your local changes.        │
│                                                        │
│  ─── Removed (0) ─────────────────────────────         │
│    No skills removed upstream.                         │
│                                                        │
│                    [ Cancel ]  [ Apply 3 changes ]    │
└────────────────────────────────────────────────────────┘
```

- Forked skills default unchecked (user must explicitly opt in to overwrite).
- Apply button count updates live.
- Pinned sources skip drift checks entirely.
- Sources in `unreachable` state > 7 days show `⚠ stale` chip — never auto-unlink.

### Fork-on-edit

Editing an imported skill prompts:
> *"Edit will fork this skill off its source. You'll keep your changes even when upstream updates. Continue? [Fork & edit / Cancel]"*

On confirm:
- Skill content saved.
- `forked_from_source = TRUE`.
- Source-chip replaces with `⊙ forked from wshobson-agents`.
- Next drift refresh shows the skill in `changed` with warning.

### Conflict handling

Per Q2 decision: default rename (`name-2`), user notified with per-row dropdown (`Rename / Skip / Replace`). Repeat imports from same source are idempotent (Q8): merge into existing namespaced collection, skills with unchanged content are no-ops.

### Publish-back

`GET /marketplace/{collection_slug}.json` is publicly readable. Serializes the collection to a Claude-Code-compatible manifest.

**Example response:**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "wshobson-agents",
  "owner": {
    "name": "SkillNote — wshobson-agents",
    "email": "noreply@skillnote.local"
  },
  "metadata": {
    "description": "Imported from github.com/wshobson/agents, re-hosted via SkillNote",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "python-expert",
      "description": "Python code-review heuristics.",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/wshobson/agents",
        "path": "plugins/python-expert/skills/python-expert",
        "ref": "main",
        "sha": "abc1234..."
      },
      "license": "MIT"
    }
  ]
}
```

User-authored skills (with `import_source_id IS NULL`) get a `⊙ local only` chip and are excluded from the manifest. Collection header shows: `12 skills · 10 publishable`.

**Claude Code user installs with:**

```
/plugin marketplace add https://skillnote.example.com/marketplace/wshobson-agents.json
```

**Response headers:**
- `ETag: "<sha256-of-serialized>"` — cheap 304 on repeat
- `Cache-Control: public, max-age=60, must-revalidate`

## API Surface

All routes under `/v1/import/*`; publish-back at `/marketplace/*`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/import/inspect` | Preview without writes |
| `POST` | `/v1/import/apply` | Commit the import (transactional) |
| `GET` | `/v1/import/sources` | List + drift badges (also triggers HEAD probe) |
| `POST` | `/v1/import/sources/{id}/refresh` | Preview mode / apply mode |
| `DELETE` | `/v1/import/sources/{id}` | Unlink (with `?remove_skills=bool`) |
| `GET` | `/marketplace/{slug}.json` | Publish-back (public, ETagged, rate-limited) |

All errors use the `{error: {code, message}}` envelope from 0.3.2.

### Error codes

```python
class ImportErrorCode:
    INPUT_UNPARSEABLE = "INPUT_UNPARSEABLE"
    URL_SCHEME_FORBIDDEN = "URL_SCHEME_FORBIDDEN"
    HOST_NOT_ALLOWED = "HOST_NOT_ALLOWED"
    REPO_NOT_FOUND = "REPO_NOT_FOUND"
    REPO_PRIVATE = "REPO_PRIVATE"
    REPO_TOO_LARGE = "REPO_TOO_LARGE"
    RATE_LIMITED = "RATE_LIMITED"
    MANIFEST_INVALID = "MANIFEST_INVALID"
    UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT"
    IMPORT_TOO_LARGE = "IMPORT_TOO_LARGE"
    SKILL_CONFLICT = "SKILL_CONFLICT"
    COLLECTION_NAME_INVALID = "COLLECTION_NAME_INVALID"  # reused from 0.3.2
```

## UI Surface (new files)

```
src/app/(app)/browse/
  page.tsx                            # /browse — empty state or sources list
  [sourceId]/page.tsx                 # source detail (link-only)

src/components/browse/
  BrowseEmptyState.tsx                # hero + two CTAs
  BrowseSourcesList.tsx               # cards grid
  BrowseSourceCard.tsx                # one source row
  ImportSheet.tsx                     # drawer: URL input + inspect + preview + confirm
  InspectPreview.tsx                  # detection result
  SkillSelectionList.tsx              # checkbox list (left pane)
  SkillPreviewPane.tsx                # read-only Markdown viewer (right pane)
  CollectionTargetPicker.tsx          # "Import into" popover
  DiffDrawer.tsx                      # drift drawer
  LocalOnlyChip.tsx                   # ⊙ chip for user-authored skills
  SourceBadge.tsx                     # "Imported from X" chip on skill detail

src/lib/api/imports.ts                # fetch wrappers
src/lib/api/marketplace.ts            # publish-back preview helper
src/lib/parse-marketplace-input.ts    # port of Claude Code's parser (client-side detection hint)
```

Install shadcn/ui Resizable component: `npx shadcn@latest add resizable`.

Sidebar modification (`src/components/layout/sidebar.tsx`): add `Browse` top-level item with drift badge.

Existing-file touches:
- `src/components/skills/skill-detail.tsx` → `SourceBadge` next to version pill
- `src/components/skills/tabs/SkillEditTab.tsx` → fork-confirm prompt
- `src/app/(app)/collections/page.tsx` → bottom nudge "Browse the community →"
- `src/app/(app)/collections/[slug]/page.tsx` → top banner when source present

## Validation Rules & Security

### Input checks (before clone)

| Check | Rule | Error code |
|---|---|---|
| Parse | `input_parser.parse()` returns valid ParsedSource | `INPUT_UNPARSEABLE` |
| Scheme allowlist | http, https, git, SSH-form only | `URL_SCHEME_FORBIDDEN` |
| Host allowlist | Optional env `SKILLNOTE_IMPORT_ALLOWED_HOSTS`; unset = all public | `HOST_NOT_ALLOWED` |
| Rate limit | 10 req/min per client IP | `RATE_LIMITED` |
| Private IP / metadata endpoint block | No 169.254.169.254, 10.x, 192.168.x, localhost | `URL_SCHEME_FORBIDDEN` |
| Redirect chain check | Each hop revalidated against private-IP block | `URL_SCHEME_FORBIDDEN` |

### Clone / fetch checks

- Shallow: `--depth=1 --single-branch`
- No submodules: `--no-recurse-submodules`
- Size cap: 50 MB — abort clone if exceeded
- Timeout: 30s inspect / 60s apply
- Pinned-IP: resolve once, reuse for clone duration (DNS rebinding protection)

### Manifest validation (Pydantic ports of Claude Code schemas)

- Parse errors → `MANIFEST_INVALID` with line/column
- Required fields missing → specific field paths
- Type mismatches → expected types shown
- SKILL.md frontmatter bad → skill skipped, not whole import
- Malicious payloads (prototype pollution, billion-laughs YAML, >5MB manifest) → safe-load rejects

### Per-skill checks

| Check | Rule |
|---|---|
| Name | `^[a-z0-9-]+$`, 1-64 chars, no reserved words (from 0.3.2) |
| Description length | ≤ 1024 chars (truncate + warn if longer) |
| SKILL.md size | ≤ 256 KB |
| Per-asset size | ≤ 4 MB |
| Total bundle size | ≤ 20 MB across all skills |
| File-type allowlist | `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp` |
| Path traversal | Reject `..`, absolute paths, symlinks (reuses `bundle_validator.py`) |

### Deferred to v1.1

- Shell-block scanning (`rm -rf`, `curl | sh`, `eval`)
- External URL listing in preview
- Prompt-injection sentinel detection
- Terminal picker `Browse` tab

### Error UX contract

Four presentation classes:

1. **Pre-inspect input errors** → inline red border + message below URL input
2. **Inspect-time errors** → banner in preview area, URL stays editable
3. **Per-skill validation warnings** → inline `⚠` rows in SkillSelectionList; disabled checkboxes
4. **Apply-time errors** → toast (atomic) or banner in sheet (partial); idempotent retry safe

Specific copy mapping:

- `REPO_NOT_FOUND` → "Repo not found. Check the spelling or try a different ref."
- `REPO_PRIVATE` → "This is a private repo. Add a GitHub token in Advanced → Token to continue."
- `REPO_TOO_LARGE` → "Repo is too large (over 50 MB). Try a subpath under Advanced."
- `MANIFEST_INVALID` → numbered list of problems with field paths
- `RATE_LIMITED` → "GitHub rate-limited this request. Add a token for 5000/hr, or retry in X minutes."
- `UPSTREAM_TIMEOUT` → "Took too long to respond. Retry, or check if the repo is reachable."
- `IMPORT_TOO_LARGE` → "Selected skills total 22 MB — max is 20 MB. Deselect some."

### Apply transaction atomicity

`importer.apply()` is one SQLAlchemy transaction:
1. UPSERT `import_sources` by `(url, ref, subpath)`
2. Create / find collection by target slug
3. For each skill: resolve final name, INSERT with source FK
4. Commit

Any failure → full rollback. Retry safe via UNIQUE + ON CONFLICT DO NOTHING.

### Publish-back security

- Slug validated with 0.3.2 rules → invalid = 404 (not 400, prevents enumeration)
- ETag-based caching (SHA-256 of serialized manifest)
- 60 req/min per IP rate limit
- No skill bytes served from SkillNote — Claude Code clones directly from upstream via the round-tripped `git-subdir` source

## Testing

Full test matrix — every Claude Code failure category covered, adversarial security scenarios exercised, and user-journey E2E written from real scripts.

### A. Unit tests

**`test_input_parser.py`** — pure-function parser, mirrors `parseMarketplaceInput.ts` line-for-line. Parametrized across ~40 positive + ~25 negative inputs including:
- Standard shorthand: `owner/repo`, `owner/repo@tag`, `owner/repo#ref`
- HTTPS/SSH URLs including GitHub Enterprise SSH certs, self-hosted IPs, custom SSH usernames
- Azure DevOps `/_git/` special case
- Edge cases: empty, whitespace, unicode, null bytes, command injection in ref, 4000-char slugs
- Property-based fuzzing via Hypothesis: 1000 random inputs, never crashes

**`test_manifest_schema.py`** — adversarial manifest structures. Fixtures in `backend/tests/fixtures/manifests/`:
- Real-world: `anthropics-marketplace.json` (144 plugins), `wshobson-agents.json`
- Synthetic malformed: missing fields, type mismatches, nested invalidity, prototype pollution, billion-laughs YAML
- Boundary: exactly 128-char names, exactly 1024-char descriptions, 10000-plugin manifests

**`test_publisher_serialization.py`** — collection → marketplace.json roundtrip. Asserts:
- User-authored skills (no source) omitted
- Imported skills serialize to `git-subdir`/`github` sources with preserved SHA
- Output validates against Python port of Claude Code's `PluginSourceSchema`
- ETag stable for identical content, changes on modification

### B. Integration tests

All hit a live backend (urllib pattern from 0.3.2). Skip if unreachable.

**`test_imports_inspect.py`** — every code path of `/v1/import/inspect`:
- Happy: real public repos (`anthropics/skills`, `wshobson/agents`), subpath scoping, ref/tag forms, cache hit timing
- Negative: 8-category Claude Code failure taxonomy (dns_or_refused, timeout, conn_reset, auth, not_found, tls, invalid_schema, other), non-existent ref, non-existent subpath, no SKILL.md files
- Concurrency: 10 parallel inspects of different and same repos

**`test_imports_apply.py`** — full transaction semantics:
- Happy: first import, re-import (idempotent merge), different refs (separate sources), subset selection, custom collection target
- Conflicts: rename default, rename collision chain (`-2`, `-3`), skip, replace, all-conflicts no-op
- Rollback: injected failure mid-apply, connection drop, concurrent apply (row locking)
- Size limits: 21 MB bundle → 413, 1000-skill stress test

**`test_imports_sources.py`** — lifecycle:
- Drift detection with mocked HEAD SHA changes, cache behavior, pin/unpin
- Refresh preview + apply with forked-skill handling
- DELETE with remove_skills true/false
- Cascade behavior on collection delete

**`test_marketplace_endpoint.py`** — publish-back:
- Valid + empty + user-authored-only collections
- ETag + 304 behavior
- Rate limiting
- Cross-schema validation via Python port of Claude Code's Zod schemas
- Round-trip: import → publish → re-import into fresh SkillNote → identical skill set

**`test_migration_0013_imports.py`** — schema safety:
- Apply + idempotency
- Downgrade (safe when no import_sources rows; error with clear message when data present)
- Cascade behavior (FK tests)
- Compatibility with 0.3.2 existing data

### C. Security (adversarial) tests

**`test_imports_security_attacks.py`**:

| Attack | Expected behavior |
|---|---|
| Path traversal (`../../../etc/passwd`) | Rejected before FS touch |
| Symlink attack (repo contains `evil -> /etc/passwd`) | Detected, import aborted |
| Zip bomb (10k nested dirs) | Aborted at 50 MB size limit |
| Recursive submodules (5 levels) | `--no-recurse-submodules` prevents |
| Malicious git hooks | Never executed (shallow clone, disabled) |
| 500 MB SKILL.md (streaming) | Rejected at 256 KB without reading full file |
| Billion-laughs YAML frontmatter | Safe-load rejects |
| XXE (not applicable to JSON, verified) | N/A |
| SSRF to AWS metadata `169.254.169.254` | Scheme + private-IP block |
| Localhost targeting | Private-IP block |
| DNS rebinding | Pinned IP for clone duration |
| Redirect chain to private IP | Revalidated each hop |
| Reserved-word name (`claude-helper`) | Rejected with clear message |
| Unicode homoglyph (`pythοn-expert`) | Regex `^[a-z0-9-]+$` rejects |
| Null-byte injection | Parser regex rejects |
| Command injection in ref | Parser regex rejects |
| Oversized Authorization header | Rejected before processing |

### D. Performance + scale

**`test_imports_perf.py`** — p95 benchmarks:

| Scenario | Target |
|---|---|
| Inspect 10-skill repo (cold) | < 3s |
| Inspect 10-skill repo (cached) | < 50ms |
| Inspect 200-skill marketplace (cold) | < 15s |
| Apply 10-skill import | < 2s |
| Apply 200-skill import | < 30s |
| Refresh 200-skill (no drift) | < 1s |
| GET /marketplace 10-skill | < 100ms |
| GET /marketplace 500-skill | < 500ms |
| GET /marketplace 304 | < 20ms |

Concurrency: 50 parallel inspects, 20 parallel applies, 100 parallel publish-back requests. No 5xx errors, no connection pool exhaustion, rate limits kick in cleanly at configured thresholds.

### E. User-journey E2E (Playwright)

Each test reads like a real-user script. A teammate reads it out loud and it sounds natural.

1. **`journey-first-time-user.spec.ts`** — empty state discovery, paste URL, inspect, preview, divider drag, import, navigate to collection
2. **`journey-upstream-change.spec.ts`** — returning user with drift, pill click, diff drawer, selective apply
3. **`journey-conflict-rename.spec.ts`** — user with existing skill, imports conflicting repo, per-row dropdown → skip selected one
4. **`journey-fork-warning.spec.ts`** — edit imported skill, fork-confirm modal, verify `forked_from_source=TRUE`, drift refresh shows local-edit warning
5. **`journey-unlink-keep-skills.spec.ts`** — unlink source with "keep skills" → verify skills retained as detached
6. **`journey-private-repo.spec.ts`** — 401 flow → add PAT in Advanced → retry → localStorage persists
7. **`journey-publish-back.spec.ts`** — imported skills + user-authored skills → verify `⊙ local only` chips + publish URL validates

### F. Accessibility

**`test_a11y_import_sheet.spec.ts`** + **`test_a11y_browse.spec.ts`**:
- Tab-order matches visual order
- All interactive elements have accessible names
- Divider is `role="separator"` with ARIA value attributes
- Arrow-key resize works
- Focus-visible rings everywhere
- Escape closes from any focus position
- axe-core: 0 violations on `/browse`, ImportSheet, DiffDrawer
- Screen-reader output captured for 5 critical states
- Color contrast meets WCAG AA (amber drift pill tested)

### G. Visual regression (Playwright screenshots)

Diff threshold 0.1%. States captured in light + dark mode:
- `/browse` empty state
- `/browse` 1 source up-to-date
- `/browse` 3 sources mixed statuses
- ImportSheet idle
- ImportSheet inspecting (skeleton)
- ImportSheet preview
- ImportSheet with conflicts
- ImportSheet error banner
- DiffDrawer
- Source card `⋯` menu open
- Sidebar with/without drift badge

### H. Chaos / fault injection

**`test_imports_chaos.py`**:
- 20% packet loss during inspect → retries + clear final error
- 5s latency on every request → progress indicated, no hangs
- Postgres connection drop mid-transaction → clean rollback
- FastAPI process OOM during large apply → container restart, DB consistent
- GitHub rate-limit mid-inspect of 200-skill marketplace → partial preview + retry option
- Disk full during clone → clean error, no half-written state
- Clock skew (server 2h off) → ETag + caches still work (content hashes, not timestamps)

### I. Test infrastructure

- **Mock git server** (`backend/tests/fixtures/mock_git_server.py`) — Flask app serving configurable repos at `/owner/repo.git`, `/repos/{owner}/{repo}/commits/{ref}`, with failure-mode switches (404, 403, timeout via delay, 500, reset)
- **Manifest fixtures** (`backend/tests/fixtures/manifests/`) — ~15 real-world + synthetic manifests
- **Claude Code schema port** (`backend/tests/fixtures/claude_schemas.py`) — minimum Pydantic port of `PluginSourceSchema` and `MarketplaceSchema`
- **Test data factory** (`backend/tests/factories.py`) — pytest fixtures
- **Hypothesis strategies** — property-based tests
- **Playwright fixture with PAT pre-loaded** — reusable auth state

### J. Coverage gates (merge-blocking)

| Layer | Target |
|---|---|
| `input_parser.py` | 100% branch |
| `manifest_schema.py` | 100% branch |
| `publisher.py` | 100% branch |
| `inspector.py` | ≥ 90% |
| `importer.py` | ≥ 95% |
| `refresher.py` | ≥ 90% |
| API routes | Every endpoint × happy + ≥ 3 error paths |
| Migration | Apply + downgrade + idempotency + partial failure |
| User journeys E2E | All 7 pass |
| Visual regression | 11 screenshots × 2 modes match |
| Security attacks | All 17+ scenarios pass |
| Failure taxonomy | All 8 Claude Code categories covered |
| a11y | 0 axe-core violations |
| Perf | No regression > 20% on nightly |

CI pipeline: unit (30s) → integration + migration (2m) → E2E + visual (5m) → security + chaos (3m). Perf nightly.

## Rollout Plan

### v1 (0.3.3) — this spec

Everything above except terminal picker tabs.

### v1.1 (0.3.4) — terminal picker

- Claude-Code-native Tabs in curses picker (`[Collections] · Browse` with `←/→` switching, `Ctrl+M` hotkey)
- Paste-URL input in Browse tab; recent imports list
- Shell-block scanning on import
- External URL listing in preview

### v2 (later)

- Featured/curated registry (`Browse library` button enabled)
- Scheduled background sync
- Private-repo server-stored PATs
- Git-http-backend for publishing user-authored skills
- `/skillnote:import` slash command

## Success Criteria

- User pastes `wshobson/agents` on `/browse` and successfully imports 12 skills in < 30 seconds.
- Mom-user test: non-technical teammate discovers the Browse sidebar item within 30 seconds of first opening SkillNote.
- `GET /marketplace/wshobson-agents.json` returned by our endpoint passes `PluginSourceSchema` validation.
- User edits an imported skill — fork-on-edit modal appears, `forked_from_source` flips, next drift refresh warns before overwrite.
- All 7 user-journey E2E tests pass in CI.
- All 8 Claude Code failure categories covered in integration tests.
- All 17+ adversarial security attacks blocked in security tests.
- Zero regression in 0.3.2 tests (collections, validation, migration 0012).

## Open Questions

None — all six design questions resolved during brainstorming.

## Decisions Log

| # | Decision |
|---|---|
| v1 scope | Option B from research: paste-URL web flow + publish-back. Picker deferred to v1.1. |
| Detection | Mirror Claude Code's `parseMarketplaceInput.ts` exactly |
| Conflict | Rename (`name-2`) default, per-row dropdown with Skip/Replace options |
| Edit behavior | Fork-on-edit with confirm modal |
| Namespace | `owner-repo` default, customizable via popover |
| Re-import | Idempotent merge into existing namespaced collection |
| PAT storage | User-local only (`localStorage`) |
| Publish-back visibility | Everything public — per-collection endpoint, no toggle |
| Publish-back v1 scope | Imported skills only; user-authored get `⊙ local only` chip |
| Primary entry | Top-level sidebar `Browse` (research-backed; beats `Integrations` for non-technical discovery) |
| Sync model | Hybrid: cheap HEAD probe on visit (10-min cache) → amber pill → diff drawer on click |
| Divider | shadcn `Resizable` / `react-resizable-panels`, 35/65 default, invisible-until-hover pattern |
| Testing | Mandatory: 8 failure categories, 17+ attacks, 7 user journeys, performance benchmarks, a11y, visual regression, chaos |
