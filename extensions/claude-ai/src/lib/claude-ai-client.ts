// claude.ai internal-endpoint client.
//
// Uses cookies the user already has from being logged in. The extension's
// host_permissions on claude.ai means `credentials: "include"` attaches
// session cookies automatically on every fetch. HttpOnly cookies are reached
// via chrome.cookies (for inspection) but the actual auth happens via the
// browser's normal cookie attachment.
//
// Endpoint paths and shapes here mirror docs/claude-ai-endpoints.md.
// MUST update both files together when the spike reveals real values.

import type { ClaudeAISkillSummary } from "./types";

const CLAUDE_AI_BASE = "https://claude.ai";

export class ClaudeAINotLoggedInError extends Error {}
export class ClaudeAIEndpointChangedError extends Error {}
/** A request claude.ai rejected as invalid (4xx invalid_request_error) —
 *  e.g. "skill name already in use". Retrying can't fix it, so the sync
 *  engine reports it as a PERMANENT failure (no 3x retry spam). */
export class ClaudeAIPermanentError extends Error {}
/** The session cookie authenticated, but isn't authorized for this
 *  claude.ai resource. Strong signal the connector is targeting the
 *  wrong surface (e.g. the Anthropic API-workspace skills endpoint
 *  rather than the web-UI personal-skills endpoint). */
export class ClaudeAIAuthScopeError extends Error {}

/** Verify the user is currently logged in by checking the session cookie. */
export async function isLoggedIn(): Promise<boolean> {
  // TODO: verify in Phase 0 spike — the exact cookie name. Community refs
  // 'sessionKey'; production might be '__Secure-sessionKey' or similar.
  const candidates = ["sessionKey", "__Secure-sessionKey", "claude_session"];
  for (const name of candidates) {
    const c = await chrome.cookies.get({ url: CLAUDE_AI_BASE, name });
    if (c?.value) return true;
  }
  return false;
}

/** Listen for login/logout transitions on the claude.ai session cookie. */
export function watchSessionCookie(
  onChange: (loggedIn: boolean) => void,
): void {
  chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
    if (!cookie.domain.includes("claude.ai")) return;
    // Any session-like cookie change triggers a re-check; the listener
    // doesn't need to know which exact name is canonical.
    void isLoggedIn().then(onChange);
    void removed; // silence unused
  });
}

// Headers the claude.ai web app sends on every internal API call.
// `anthropic-client-platform: web_claude_ai` is the one that matters —
// the internal skills endpoints reject session-cookie requests that
// don't identify as the web client (this was a root cause of the 403s).
// `Referer`/`User-Agent`/`Origin` are forbidden headers a page-script
// can't set, but extension service workers with host_permissions for
// claude.ai CAN send these custom anthropic-* headers.
function webClientHeaders(h: Headers): void {
  h.set("Accept", "application/json");
  h.set("anthropic-client-platform", "web_claude_ai");
  h.set("anthropic-client-version", "1.0.0");
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<T> {
  const headers = new Headers(init.headers);
  webClientHeaders(headers);
  // Abort a hung request so it can't stall the whole sync tick (and the MV3
  // service worker) until the backend's 10-min op reaper reclaims it. Mirrors
  // the AbortController/timeout the SkillNote client already uses on its fetches.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${CLAUDE_AI_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error(`claude.ai ${path} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    throw new ClaudeAINotLoggedInError("claude.ai session expired");
  }
  if (res.status === 404) {
    throw new ClaudeAIEndpointChangedError(`claude.ai endpoint ${path} returned 404 — likely renamed`);
  }
  if (res.status === 403) {
    // Authenticated but not authorized. Most commonly: the session
    // cookie can't authorize the Anthropic org-skills API — meaning the
    // connector is pointed at the API-workspace surface, not the
    // web-UI personal-skills surface the user actually sees. Surface a
    // clear, actionable message rather than a raw JSON dump.
    const text = await res.text();
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? detail;
    } catch {
      /* keep raw slice */
    }
    throw new ClaudeAIAuthScopeError(
      `claude.ai ${path} denied (403): "${detail}". Your session is signed ` +
        `in but not authorized for this endpoint — the connector may be ` +
        `targeting the wrong skills surface. Capture the real request from ` +
        `claude.ai's Network tab and update claude-ai-client.ts.`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    // 400 invalid_request_error (e.g. duplicate skill name) is permanent —
    // surface a clean, human message and let the caller mark it non-retryable.
    if (res.status === 400) {
      let msg = text.slice(0, 200);
      try {
        const j = JSON.parse(text);
        msg = j?.error?.message ?? msg;
      } catch {
        /* keep raw */
      }
      throw new ClaudeAIPermanentError(`claude.ai rejected the request: ${msg}`);
    }
    throw new Error(`claude.ai ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface OrgItem {
  id?: string;
  uuid?: string;
  name?: string;
  capabilities?: string[];
}

// Plan capabilities that mark an org as the user's claude.ai *chat*
// workspace (the one that backs the web UI / personal skills). An account
// can belong to several orgs — an "api"-only org, legacy orgs, team orgs
// the user was invited to — and hitting skills endpoints on the wrong one
// returns 403 "Invalid authorization for organization". The right org is
// the chat-capable one. This mirrors ClaudeSync's proven selection logic.
const _CHAT_PLAN_CAPS = ["claude_pro", "raven", "claude_max", "claude_team", "pro", "max"];

function _orgId(o: OrgItem | undefined): string | undefined {
  return o?.uuid ?? o?.id;
}

function _selectChatOrg(orgs: OrgItem[]): OrgItem | undefined {
  // 1. Best: chat + a known paid-plan capability (ClaudeSync heuristic).
  const planned = orgs.find((o) => {
    const caps = new Set(o.capabilities ?? []);
    return caps.has("chat") && _CHAT_PLAN_CAPS.some((c) => caps.has(c));
  });
  if (planned) return planned;
  // 2. Any org with the chat capability at all (free-tier chat org).
  const chatOnly = orgs.find((o) => (o.capabilities ?? []).includes("chat"));
  if (chatOnly) return chatOnly;
  // 3. Last resort: the LAST org in the array. Working community clients
  //    (unofficial-claude-api) found the last entry is the active one far
  //    more often than the first — picking [0] is the classic 403 bug.
  return orgs[orgs.length - 1];
}

/** Discover the user's claude.ai chat-workspace org_id.
 *
 * /api/organizations returns a bare array of orgs (each with uuid, name,
 * capabilities). We must select the CHAT org — picking the wrong one is
 * the cause of the 403 "Invalid authorization for organization" on the
 * skills endpoints. Defensive about wrapped shapes + id|uuid keys.
 *
 * On failure throws ClaudeAIEndpointChangedError WITH the real response
 * snippet so the activity feed shows exactly what came back.
 */
export async function getOrgId(): Promise<string> {
  const data = await call<unknown>("/api/organizations");

  let orgs: OrgItem[] = [];
  if (Array.isArray(data)) {
    orgs = data as OrgItem[];
  } else if (data && typeof data === "object") {
    const d = data as {
      organizations?: OrgItem[];
      organization?: OrgItem;
      data?: OrgItem[];
    };
    if (d.organization) orgs = [d.organization];
    else orgs = d.organizations ?? d.data ?? [];
  }

  const chosen = orgs.length ? _selectChatOrg(orgs) : undefined;
  const orgId = _orgId(chosen);

  if (!orgId) {
    throw new ClaudeAIEndpointChangedError(
      "Could not find a chat-capable claude.ai organization. " +
        "/api/organizations returned: " +
        JSON.stringify(data).slice(0, 400),
    );
  }
  return orgId;
}

// ── Skill-invocation detection (usage analytics) ────────────────────────────
//
// When Claude uses a skill in a claude.ai conversation, it reads the skill
// file, which surfaces as a tool_use block in the conversation tree:
//   "input": { "path": "/mnt/skills/user/secure-migrations/SKILL.md", ... }
// The slug is embedded in the path. This is capture-verified against a real
// conversation. We fetch the conversation tree (render_all_tools=true) and
// walk it for those reads.
//
// Two mount layouts exist (both live-verified 2026-06-07):
//   * personal/flat skills →  /mnt/skills/<namespace>/<slug>/SKILL.md
//       e.g. /mnt/skills/user/secure-migrations/SKILL.md   (namespace "user")
//   * plugin-group skills  →  /mnt/skills/plugins/<plugin>:<slug>/SKILL.md
//       e.g. /mnt/skills/plugins/skillnote:secure-migrations/SKILL.md
// The regex matches both; for the plugin layout the second segment carries a
// "<plugin>:" prefix that we strip so the slug maps back to the SkillNote DB.

const SKILL_PATH_RE = /\/mnt\/skills\/([^/]+)\/([^/]+)\/SKILL\.md/;

export interface SkillInvocation {
  /** Skill slug, e.g. "secure-migrations" (plugin prefix stripped). */
  slug: string;
  /** Namespace segment: "user" (personal), "org", "anthropic" (built-in),
   *  or "plugins" (delivered inside a plugin group). */
  namespace: string;
  /** Plugin name when the skill was delivered via a plugin group
   *  (namespace === "plugins"), e.g. "skillnote"; undefined otherwise. */
  pluginName?: string;
  /** Stable id for dedup — the tool block's uuid when present, else a
   *  composite of conversation + path + ordinal. */
  dedupKey: string;
}

/** Recursively walk an arbitrary JSON value collecting skill-file reads.
 *  Shape-agnostic on purpose: claude.ai's conversation tree nests messages →
 *  content blocks → tool_use, and the structure drifts. We just look for any
 *  object whose input.path matches a skill SKILL.md read, and grab the
 *  nearest uuid/id for dedup. */
const _MAX_SKILL_SCAN_DEPTH = 256;

function _collectSkillReads(
  node: unknown,
  conversationId: string,
  out: SkillInvocation[],
  counter: { n: number },
  depth = 0,
): void {
  // Guard against a pathologically deep (or cyclic) conversation tree blowing
  // the service-worker call stack — the JSON comes from claude.ai unbounded.
  if (depth > _MAX_SKILL_SCAN_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) _collectSkillReads(item, conversationId, out, counter, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  const input = obj["input"];
  if (input && typeof input === "object") {
    const path = (input as Record<string, unknown>)["path"];
    if (typeof path === "string") {
      const m = SKILL_PATH_RE.exec(path);
      if (m && m[1] && m[2]) {
        const namespace = m[1];
        let slug = m[2];
        let pluginName: string | undefined;
        // Plugin-group skills mount as "<plugin>:<slug>". Strip the prefix so
        // the slug matches the SkillNote registry; remember the plugin name.
        if (namespace === "plugins") {
          const colon = slug.indexOf(":");
          if (colon > 0) {
            pluginName = slug.slice(0, colon);
            slug = slug.slice(colon + 1);
          }
        }
        const uuid =
          (typeof obj["uuid"] === "string" && obj["uuid"]) ||
          (typeof obj["id"] === "string" && obj["id"]) ||
          `${conversationId}#${path}#${counter.n}`;
        counter.n += 1;
        out.push({ slug, namespace, pluginName, dedupKey: String(uuid) });
      }
    }
  }

  // Recurse into all object values (messages, content, etc.).
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") _collectSkillReads(v, conversationId, out, counter, depth + 1);
  }
}

/** Fetch one conversation's tree and return every skill invocation in it.
 *  Uses the capture-verified read endpoint with render_all_tools=true so the
 *  tool blocks (skill reads) are present. */
export async function listConversationSkillInvocations(
  orgId: string,
  conversationId: string,
): Promise<{ invocations: SkillInvocation[]; title: string }> {
  const q =
    "tree=True&rendering_mode=messages&render_all_tools=true&consistency=eventual";
  const data = await call<unknown>(
    `/api/organizations/${orgId}/chat_conversations/${conversationId}?${q}`,
  );
  const out: SkillInvocation[] = [];
  _collectSkillReads(data, conversationId, out, { n: 0 });
  // claude.ai stores the conversation's human title under `name`. Surfaced as
  // the session/chat name in usage analytics so the dashboard can show
  // "Refactor auth flow" instead of an opaque conversation id.
  const root = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const title = typeof root.name === "string" ? root.name : "";
  return { invocations: out, title };
}

interface ListOrgSkillsResponse {
  skills?: ClaudeAISkillSummary[];
  // Some shapes use top-level array.
  data?: ClaudeAISkillSummary[];
}

export async function listOrgSkills(orgId: string): Promise<ClaudeAISkillSummary[]> {
  // Personal verb `list-skills` (symmetric with the verified `upload-skill`);
  // the `-org-` variant is the Team/Enterprise admin list. Falls back across
  // a couple of path shapes since only `upload-skill` is capture-verified.
  let data: ListOrgSkillsResponse | ClaudeAISkillSummary[];
  try {
    data = await call(`/api/organizations/${orgId}/skills/list-skills`);
  } catch (e) {
    if (e instanceof ClaudeAIEndpointChangedError) {
      // Older/alternate path: bare collection.
      data = await call(`/api/organizations/${orgId}/skills`);
    } else {
      throw e;
    }
  }
  if (Array.isArray(data)) return data;
  return data.skills ?? data.data ?? [];
}

export async function uploadOrgSkill(
  orgId: string,
  bundle: Blob,
  _display_title: string,
): Promise<{ skill_id: string; version?: string }> {
  // Verified against a real claude.ai web-UI capture:
  //   POST /api/organizations/{org}/skills/upload-skill?overwrite=true
  //   multipart body with a SINGLE field named `file` (a .zip whose
  //   SKILL.md frontmatter carries the skill name — no display_title
  //   field is sent). NOTE the verb is `upload-skill` (personal), not
  //   `upload-org-skill` (Team/Enterprise admin, which 403s for personal
  //   accounts).
  const fd = new FormData();
  fd.append("file", bundle, "skill.zip");

  // overwrite=true so re-pushing the same skill updates it in place
  // rather than erroring on a duplicate. (The web UI sends overwrite=false
  // for first creation; true is the right choice for an idempotent sync.)
  const data = await call<{
    skill?: { id?: string; uuid?: string; version?: string; latest_version?: string };
    id?: string;
    uuid?: string;
    version?: string;
    latest_version?: string;
  }>(
    `/api/organizations/${orgId}/skills/upload-skill?overwrite=true`,
    { method: "POST", body: fd },
  );
  // Tolerate wrapped ({skill:{...}}) and flat shapes, uuid|id keys, and
  // version|latest_version — the exact response shape is confirmed on the
  // first real push and the parser is defensive meanwhile.
  const skillId =
    data.skill?.id ?? data.skill?.uuid ?? data.id ?? data.uuid;
  const version =
    data.skill?.version ?? data.skill?.latest_version ?? data.version ?? data.latest_version;
  if (!skillId) {
    throw new ClaudeAIEndpointChangedError(
      "claude.ai upload-skill response missing skill id/uuid: " +
        JSON.stringify(data).slice(0, 200),
    );
  }
  return { skill_id: skillId, version };
}

// ── Plugin-group publish (git-free "Upload plugin" path) ────────────────────
//
// Verified live 2026-06-07 (see docs/claude-ai-endpoints.md). Two cookie-auth
// POSTs make the whole SkillNote registry appear as its OWN named "SkillNote"
// group under Personal plugins:
//   1. create-account-marketplace {name,source:"manual",source_url:""}  (once)
//   2. {mp}/plugins/account-upload?overwrite=true   (multipart `file` = ZIP)
// `overwrite=true` is the update path: re-uploading the regenerated bundle
// refreshes the group in place. No git, no GitHub.

const SKILLNOTE_MARKETPLACE_NAME = "SkillNote";

interface AccountMarketplace {
  id: string;
  name: string;
  source?: string;
}

/** Find or create the user's manual "SkillNote" marketplace and return its id.
 *  Idempotent: a marketplace name is unique per account, so we list first and
 *  reuse, only creating when absent. */
export async function ensureSkillNoteMarketplace(orgId: string): Promise<string> {
  const listed = await call<{ marketplaces?: AccountMarketplace[] }>(
    `/api/organizations/${orgId}/marketplaces/list-account-marketplaces`,
  );
  const existing = (listed.marketplaces ?? []).find(
    (m) => m.name === SKILLNOTE_MARKETPLACE_NAME,
  );
  if (existing?.id) return existing.id;

  const created = await call<AccountMarketplace>(
    `/api/organizations/${orgId}/marketplaces/create-account-marketplace`,
    {
      method: "POST",
      body: JSON.stringify({
        name: SKILLNOTE_MARKETPLACE_NAME,
        source: "manual",
        source_url: "",
      }),
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!created?.id) {
    throw new ClaudeAIEndpointChangedError(
      "create-account-marketplace response missing id: " +
        JSON.stringify(created).slice(0, 200),
    );
  }
  return created.id;
}

/** Upload (overwrite) the whole-group plugin bundle into the SkillNote
 *  marketplace, creating/refreshing the named "SkillNote" plugin group. */
export async function uploadPluginBundle(
  orgId: string,
  marketplaceId: string,
  bundle: Blob,
): Promise<{ plugin_id?: string; version?: string }> {
  const fd = new FormData();
  fd.append("file", bundle, "skillnote-plugin.zip");
  const data = await call<{
    id?: string;
    name?: string;
    display_name?: string;
    version?: string;
  }>(
    `/api/organizations/${orgId}/marketplaces/${marketplaceId}/plugins/account-upload?overwrite=true`,
    { method: "POST", body: fd },
    60000, // multipart upload — allow longer than the 30s JSON default
  );
  return { plugin_id: data.id, version: data.version };
}

interface AccountPlugin {
  id: string;
  name: string;
  display_name?: string;
}

/** List the plugins currently in the SkillNote account-marketplace, so the
 *  caller can diff against the desired set and uninstall stale groups
 *  (collections the user toggled off). */
export async function listAccountPlugins(
  orgId: string,
  marketplaceId: string,
): Promise<AccountPlugin[]> {
  const data = await call<{ plugins?: AccountPlugin[] }>(
    `/api/organizations/${orgId}/marketplaces/${marketplaceId}/plugins/account-list-plugins?limit=100`,
  );
  return data.plugins ?? [];
}

/** Enable/disable an account plugin. "Uninstalling" an account-uploaded
 *  plugin disables it (PUT .../enabled) — it can be re-enabled from the
 *  user's own marketplace. Used to retire a collection's group when its
 *  toggle is turned off. */
export async function setPluginEnabled(
  orgId: string,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  await call<void>(
    `/api/organizations/${orgId}/plugins/${pluginId}/enabled`,
    {
      method: "PUT",
      body: JSON.stringify({ enabled }),
      headers: { "Content-Type": "application/json" },
    },
  );
}

export async function deleteOrgSkill(
  orgId: string,
  skillId: string,
): Promise<void> {
  // Personal verb `delete-skill` (symmetric with `upload-skill`).
  await call<void>(
    `/api/organizations/${orgId}/skills/delete-skill`,
    {
      method: "POST",
      body: JSON.stringify({ skill_id: skillId }),
      headers: { "Content-Type": "application/json" },
    },
  );
}

export async function downloadSkillBundle(
  orgId: string,
  skillId: string,
): Promise<Blob> {
  // Download path is not capture-verified yet; include the web-client
  // headers so cookie auth is accepted the same way the verified
  // endpoints require.
  const dlHeaders = new Headers();
  webClientHeaders(dlHeaders);
  // Abort a hung download so a stalled claude.ai response can't block the
  // whole sync tick (and the MV3 service worker) until the 10-min backend
  // reaper frees the lease. Every other claude.ai call goes through call()'s
  // timeout — this raw fetch must not be the exception.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(
      `${CLAUDE_AI_BASE}/api/organizations/${orgId}/skills/${skillId}/download`,
      { credentials: "include", headers: dlHeaders, signal: ctrl.signal },
    );
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      // A timeout is transient — NOT an endpoint change. Classifying it as
      // EndpointChanged fired the "claude.ai changed, update the extension"
      // alert + telemetry for what was just a slow response.
      throw new Error(`claude.ai skill download for ${skillId} timed out`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  // Mirror call()'s status classification so the sync engine reacts right:
  // signed-out pauses sync, scope errors surface their own message, and only
  // a 404 means the endpoint actually moved.
  if (res.status === 401) {
    throw new ClaudeAINotLoggedInError("claude.ai session expired");
  }
  if (res.status === 403) {
    throw new ClaudeAIAuthScopeError(
      `claude.ai skill download for ${skillId} denied (403)`,
    );
  }
  if (res.status === 404) {
    throw new ClaudeAIEndpointChangedError(
      `claude.ai skill download endpoint returned 404 — likely renamed`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `claude.ai skill download for ${skillId} returned ${res.status}`,
    );
  }
  return await res.blob();
}

// Personal-skills equivalents. TBD on path; placeholders for Phase 1b.
export async function listPersonalSkills(): Promise<ClaudeAISkillSummary[]> {
  // TODO: verify path. Possibly /api/account/skills/list-skills.
  const data = await call<ListOrgSkillsResponse>("/api/account/skills/list-skills");
  return data.skills ?? data.data ?? [];
}
