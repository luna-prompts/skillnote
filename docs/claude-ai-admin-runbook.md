# Claude.ai Connector — Admin Runbook

Operational reference for SkillNote administrators running the claude.ai
connector in production.

## Health check

`GET /v1/integrations/claude-ai/health` returns the connector's
operational metrics:

```json
{
  "integrations_active": 12,
  "integrations_with_errors": 0,
  "pending_ops_total": 3,
  "failed_ops_total": 0,
  "diverged_links_total": 1,
  "last_audit_at": "2026-05-24T11:30:00Z",
  "schema_version": "0020_claude_ai_polish"
}
```

The same data renders on the **Settings → claude.ai** page's
**Connector health** card.

### What to monitor

| Metric | Healthy | Warning | Bad |
|---|---|---|---|
| `integrations_with_errors` | 0 | — | ≥1 |
| `failed_ops_total` | 0 | — | ≥1 |
| `pending_ops_total` | <10 | 10–50 | >50 |
| `diverged_links_total` | 0 | ≥1 | — |
| `schema_version` | matches deployed code's expected head | drift | drift |

Wire `health` into your existing observability stack (Prometheus
exporter, periodic curl + alerting) the same way you'd watch any other
SkillNote endpoint.

## Activity feed (audit log)

Every load-bearing event lands in `claude_ai_audit_log`. Query via:

- **In-product** — Settings → claude.ai → View all activity.
- **API** — `GET /v1/integrations/claude-ai/activity?integration_id=…&event=…&limit=…`
- **SQL** — direct queries against `claude_ai_audit_log`.

Event types (mirrored from `0020_claude_ai_polish.py`):

| Event | Trigger | Detail payload |
|---|---|---|
| `pair_started` | `POST /extension/pair` | `{ browser_label }` |
| `pair_approved` | `POST /pair/approve` | `{}` |
| `pair_redeemed` | first `/pair/status` poll after approval | `{}` |
| `pair_expired` | (reserved — not yet emitted; scheduled cleanup) | `{}` |
| `integration_disconnected` | `DELETE /integrations/{id}` | `{ browser_label }` |
| `integration_updated` | `PATCH /integrations/{id}` (reserved) | `{}` |
| `skill_pushed` | extension reports successful upload/update op | `{ op_kind, result }` |
| `skill_imported` | extension reports successful list/import op | `{ op_kind, result }` |
| `skill_delete_pushed` | extension reports successful delete op | `{ op_kind, result }` |
| `op_failed` | op exhausted retry budget | `{ op_kind, attempts, error }` |
| `conflict_detected` | (reserved — Phase 4b conflict auto-detection) | `{}` |
| `conflict_resolved` | (reserved — `/conflicts/{id}/resolve`) | `{ resolution }` |
| `endpoint_changed` | extension surfaces a 404 from claude.ai | `{ message }` |
| `token_revoked` | (reserved) | `{}` |

## Rate limiting

The pair endpoint (`POST /extension/pair`) is rate-limited per source IP
to **60 attempts per minute**. Brute-forcing a 6-char pairing code (31
possible glyphs ≈ 887M combinations) is infeasible within the
10-minute pairing window even at 60 attempts/minute.

Attempts are recorded in `claude_ai_pair_attempts`. To inspect:

```sql
SELECT source_ip, COUNT(*) AS attempts
FROM claude_ai_pair_attempts
WHERE created_at > now() - interval '5 minutes'
GROUP BY source_ip
ORDER BY attempts DESC
LIMIT 20;
```

A repeated 429 response from a single IP is a signal worth investigating
(scripted enumeration attempt, or a misbehaving extension build).

### Pruning old attempts

The table is small but unbounded. Add a periodic job (cron / Postgres
`pg_cron` / external scheduler) to keep it lean:

```sql
DELETE FROM claude_ai_pair_attempts
WHERE created_at < now() - interval '24 hours';
```

Same with the audit log if you have retention requirements:

```sql
DELETE FROM claude_ai_audit_log
WHERE created_at < now() - interval '90 days';
```

(Audit retention defaults to forever — set policy explicitly if needed.)

## Token security model

- **Pairing tokens** and **extension tokens** are stored as
  `sha256(token)` hex digests. Raw tokens are returned to the extension
  exactly once (at issuance) and never persisted server-side.
- Bearer verification uses `hmac.compare_digest` for constant-time
  comparison.
- `pairing_code` (the user-visible 6-char code) is stored in plaintext
  because the short window + low entropy makes hashing pointless. The
  *pairing_token* (the long opaque token the extension polls with)
  guards the actual handshake.

A database dump cannot replay sessions — at worst, an attacker with DB
access sees that integration X is paired, but cannot impersonate it.

## Disconnect / kill-switch

To revoke a single browser's access:

- **From the SkillNote UI** — Settings → claude.ai → Disconnect.
- **By API** — `DELETE /v1/integrations/claude-ai/integrations/{id}`.

To revoke ALL extension access (e.g. emergency response):

```sql
UPDATE claude_ai_integrations
SET status = 'disconnected', extension_token_hash = NULL;
```

After this, every extension bearer fails with 403. Users must re-pair.

## Backup / restore considerations

The connector adds three tables (`claude_ai_integrations`,
`claude_ai_skill_links`, `claude_ai_sync_operations`) and two polish
tables (`claude_ai_audit_log`, `claude_ai_pair_attempts`) plus one
column on `skills` (`claude_ai_sync_enabled`).

A point-in-time restore that rolls back past a pairing approval but
NOT the extension's token receipt would leave the extension holding a
token the server doesn't recognize. The extension handles this with a
401 response and prompts the user to re-pair. No data corruption — just
a re-pair friction event.

## Schema migration history

| Migration | Adds |
|---|---|
| `0019_claude_ai_integration` | core tables (integrations / links / ops) |
| `0020_claude_ai_polish` | audit log + rate-limit table + per-skill toggle column |

Future schema changes should land as new migrations rather than amending
0019/0020.

## Common operational issues

### "All my pairings show pending_approval"

Either the extension never finished its `/pair/status` poll (network
issue) or the user closed the approval tab before clicking Approve. The
records expire after 10 minutes; older rows can be safely deleted with:

```sql
DELETE FROM claude_ai_integrations
WHERE status = 'pending_approval'
  AND pairing_expires_at < now() - interval '1 day';
```

### "Sync queue keeps growing"

Indicates extensions can't reach SkillNote (the queue grows because the
extension's poll loop isn't draining it). Check:

1. Extension's last_error in the integrations list.
2. SkillNote's reachability from the user's network.
3. claude.ai endpoint health — if Anthropic ships an internal-endpoint
   change, ops fail and accumulate as `failed`.

The retry budget per op is 3; after that the op is marked `failed` and
surfaces in the UI. Failed ops don't block new ops.

### "Active integrations report `cookie_expired`"

The user's claude.ai session lapsed. They need to sign back into
claude.ai — the extension detects the new session cookie via
`chrome.cookies.onChanged` and resumes sync automatically. No
re-pairing.

### claude.ai endpoint contract drift

If the extension reports `ClaudeAIEndpointChangedError` repeatedly, an
internal claude.ai endpoint was renamed. Steps:

1. Verify locally with a fresh manual capture (devtools Network tab).
2. Update `extensions/claude-ai/src/lib/claude-ai-client.ts` with the
   new path.
3. Bump the extension version, build, submit to Chrome Web Store +
   Firefox AMO.
4. Users with auto-update enabled get the fix within hours.

Doc the new contract in `docs/claude-ai-endpoints.md` for future
regressions.

## See also

- [User guide](claude-ai-user-guide.md) — what to tell users.
- [Architecture plan](claude-ai-integration.md) — full design rationale.
- [Endpoint contracts](claude-ai-endpoints.md) — provisional claude.ai
  internal endpoint shapes.
- [Privacy policy](../extensions/claude-ai/PRIVACY.md) — what the
  extension reads and where it sends data.
