# Phase 2 Plan — Skill Ownership, Access Control, and Live Release Governance

## Status
Planned for **Phase 2** (after current milestone completion).

## Why
Current access model is token-grant based and functional for v1, but we need richer controls so:
- skill authors/owners can manage collaborators,
- edit rights and go-live rights are separated,
- admin retains full override.

---

## Phase 2 Objectives

1. Introduce **skill ownership**.
2. Add **granular collaborator permissions**.
3. Separate **edit permissions** from **publish-live permissions**.
4. Let owner/admin control who can:
   - edit,
   - publish live,
   - manage access.
5. Keep admin as global superuser.

---

## Permission Model (Proposed)

Permissions are per-skill grants:
- `can_view` — can list/read/download where applicable.
- `can_edit` — can create/update draft versions and metadata.
- `can_publish_live` — can promote a version to live/active.
- `can_manage_access` — can add/revoke other grants for that skill.

### Special roles
- **Admin**: full access across all skills (bypass checks).
- **Owner**: full access for owned skill (equivalent to all flags true on that skill).
- **Collaborator**: rights based on granted flags.

---

## Version Lifecycle (Proposed)

Skill versions should support:
- `draft`
- `staged`
- `active` (live)
- `deprecated`
- `disabled`

### Governance rules
- Creating/editing versions requires `can_edit` (or owner/admin).
- Transition to `active` requires `can_publish_live` (or owner/admin).
- Access-grant changes require `can_manage_access` (or owner/admin).

---

## Data Model Changes (Phase 2)

### `skills` additions
- `owner_subject_type` (`user|team|org|token`)
- `owner_subject_id`

### Replace/extend grants table
Current: `token_skill_grants` (coarse)

Phase 2 target (example): `skill_access_grants`
- `id`
- `skill_id`
- `subject_type` (`token|user|team|org`)
- `subject_id`
- `can_view` (bool)
- `can_edit` (bool)
- `can_publish_live` (bool)
- `can_manage_access` (bool)
- `created_at`
- `created_by`

(Keep migration path from token-only grants to subject-based grants.)

---

## API Additions (Phase 2)

### Access management
- `GET /v1/skills/{skill}/access`
- `POST /v1/skills/{skill}/access`
- `DELETE /v1/skills/{skill}/access/{grantId}`

### Release governance
- `POST /v1/skills/{skill}/{version}/promote-live`
- `POST /v1/skills/{skill}/{version}/deprecate`
- `POST /v1/skills/{skill}/{version}/disable`

### Publish flow updates
- Publish creates `draft`/`staged` by default unless explicitly promoted by authorized actor.

---

## Policy Rules

1. Admin can always perform any action.
2. Owner can always perform any action on owned skill.
3. Non-owner/non-admin can only act within explicit grant flags.
4. Publish-live (`active`) is a distinct permission and never implied by `can_edit`.
5. Access management should be auditable (actor + timestamp + change details).

---

## Testing Requirements for Phase 2

Add regression tests for:
- owner can edit + publish + manage access,
- editor can edit but cannot publish live,
- publisher can publish live but cannot manage access unless granted,
- viewer cannot edit/publish,
- admin override behavior,
- unauthorized access denial paths,
- lifecycle transitions and invalid transitions.

---

## Rollout Notes

- Implement after current milestone track is complete.
- Add migration compatibility for existing token grants.
- Keep current endpoints stable where possible; introduce additive endpoints for Phase 2.
