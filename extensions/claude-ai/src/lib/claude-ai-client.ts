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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // claude.ai may require a CSRF token on mutating requests. The token
  // typically lives in a meta tag on the page or is set via a cookie.
  // For Phase 1 we attempt the simple cookie-only path; if it 403s we
  // surface ClaudeAIEndpointChangedError so the user knows to update.
  headers.set("Accept", "application/json");
  const res = await fetch(`${CLAUDE_AI_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401) {
    throw new ClaudeAINotLoggedInError("claude.ai session expired");
  }
  if (res.status === 404) {
    throw new ClaudeAIEndpointChangedError(`claude.ai endpoint ${path} returned 404 — likely renamed`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`claude.ai ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface OrgsListResponse {
  organizations?: Array<{ id: string; name: string }>;
  // Alternate top-level shape some endpoints use:
  organization?: { id: string };
}

/** Discover the user's primary org_id. */
export async function getOrgId(): Promise<string> {
  // TODO: verify endpoint shape in Phase 0 spike.
  const data = await call<OrgsListResponse>("/api/organizations");
  const first =
    data.organization?.id ??
    data.organizations?.[0]?.id ??
    null;
  if (!first) {
    throw new Error("No claude.ai org found on this account");
  }
  return first;
}

interface ListOrgSkillsResponse {
  skills?: ClaudeAISkillSummary[];
  // Some shapes use top-level array.
  data?: ClaudeAISkillSummary[];
}

export async function listOrgSkills(orgId: string): Promise<ClaudeAISkillSummary[]> {
  const data = await call<ListOrgSkillsResponse>(
    `/api/organizations/${orgId}/skills/list-org-skills`,
  );
  return data.skills ?? data.data ?? [];
}

export async function uploadOrgSkill(
  orgId: string,
  bundle: Blob,
  display_title: string,
): Promise<{ skill_id: string; version?: string }> {
  const fd = new FormData();
  fd.set("display_title", display_title);
  // TODO: verify if multipart field name is `files[]` or `file` — community
  // docs reference `files[]` matching the public API skills endpoint format.
  fd.append("files[]", bundle, "skill.zip");

  const data = await call<{ skill?: { id: string; version?: string } }>(
    `/api/organizations/${orgId}/skills/upload-org-skill`,
    { method: "POST", body: fd },
  );
  const skill = data.skill;
  if (!skill?.id) {
    throw new ClaudeAIEndpointChangedError(
      "claude.ai upload response missing skill.id — endpoint contract may have changed",
    );
  }
  return { skill_id: skill.id, version: skill.version };
}

export async function deleteOrgSkill(
  orgId: string,
  skillId: string,
): Promise<void> {
  await call<void>(
    `/api/organizations/${orgId}/skills/delete-org-skill`,
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
  // TODO: verify path — claude.ai may not expose a download endpoint at all.
  const res = await fetch(
    `${CLAUDE_AI_BASE}/api/organizations/${orgId}/skills/${skillId}/download`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new ClaudeAIEndpointChangedError(
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
