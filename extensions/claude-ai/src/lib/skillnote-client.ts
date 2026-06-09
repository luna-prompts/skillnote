// SkillNote backend REST client.
//
// All requests go to the user-configured SkillNote URL (e.g.
// https://skillnote.acme.com) with the extension's bearer token in the
// Authorization header. Endpoints under /v1/integrations/claude-ai/ mirror
// the Pydantic schemas in backend/app/schemas/claude_ai.py.

import type {
  OperationCompletePayload,
  SyncOperation,
} from "./types";

export class SkillNoteAuthError extends Error {}
export class SkillNoteNetworkError extends Error {}

interface PairResponse {
  integration_id: string;
  pairing_code: string;
  pairing_token: string;
  redemption_url: string;
  expires_at: string;
}

interface PairStatusResponse {
  approved: boolean;
  extension_token: string | null;
}

interface KnownSkillIdsResponse {
  claude_ai_skill_ids: string[];
}

interface ExtensionSelfStatusResponse {
  integration_id: string;
  browser_label: string | null;
  status: string;
  linked_skill_count: number;
  pending_op_count: number;
  failed_op_count: number;
  last_sync_at: string | null;
  last_error: string | null;
}

// Default per-request timeout. Long enough for skill-bundle uploads,
// short enough that a hung backend doesn't permanently block the sync
// alarm. Override per-call if needed.
const DEFAULT_TIMEOUT_MS = 30_000;

/** Returns the user-configured SkillNote base URL or null if not yet set. */
export function buildClient(baseUrl: string, extensionToken?: string) {
  const base = baseUrl.replace(/\/$/, "");

  async function call<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (extensionToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${extensionToken}`);
    }
    if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? controller.signal,
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        throw new SkillNoteNetworkError(
          `SkillNote request to ${path} timed out after ${timeoutMs}ms`,
        );
      }
      throw new SkillNoteNetworkError(`Network error talking to SkillNote: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SkillNoteAuthError(`Auth error (${res.status})`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SkillNote ${path} returned ${res.status}: ${text.slice(0, 200)}`);
    }
    // Some endpoints return 204; guard against JSON parse on empty body.
    if (res.status === 204) return undefined as T;
    // Guard against non-JSON 200 responses (e.g. a misconfigured proxy
    // returning HTML). Without this, JSON.parse throws SyntaxError which
    // bypasses our SkillNoteNetworkError categorization.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const sample = (await res.text()).slice(0, 200);
      throw new SkillNoteNetworkError(
        `SkillNote ${path} returned non-JSON (${contentType}): ${sample}`,
      );
    }
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw new SkillNoteNetworkError(
        `SkillNote ${path} returned invalid JSON: ${(e as Error).message}`,
      );
    }
  }

  return {
    /** Pair: extension starts the handshake. */
    async startPair(browser_label?: string): Promise<PairResponse> {
      return call<PairResponse>("/v1/integrations/claude-ai/extension/pair", {
        method: "POST",
        body: JSON.stringify({ browser_label }),
      });
    },
    /** Pair: extension polls until approved. */
    async pollPair(pairing_token: string): Promise<PairStatusResponse> {
      const q = new URLSearchParams({ pairing_token });
      return call<PairStatusResponse>(
        `/v1/integrations/claude-ai/extension/pair/status?${q}`,
      );
    },
    /** Report a skill invocation observed in a claude.ai conversation.
     *  Hits the SAME analytics hook Claude Code uses, tagged
     *  agent_name="claude-ai", so usage lands in the shared
     *  skill_call_events table — true cross-agent parity. Best-effort:
     *  the hook returns 202 and never blocks sync. */
    async reportSkillUsed(
      skill_slug: string,
      session_id: string,
      session_name = "",
    ): Promise<void> {
      await call<unknown>("/v1/hooks/skill-used", {
        method: "POST",
        body: JSON.stringify({
          skill_slug,
          agent_name: "claude-ai",
          session_id,
          // The claude.ai conversation title (when known), so the dashboard
          // can show the chat name instead of an opaque conversation id.
          session_name,
        }),
      });
    },
    /** Fetch next batch of pending sync ops. */
    async fetchOperations(limit = 20): Promise<SyncOperation[]> {
      const q = new URLSearchParams({ limit: String(limit) });
      return call<SyncOperation[]>(
        `/v1/integrations/claude-ai/extension/operations?${q}`,
      );
    },
    /** Report op outcome back to SkillNote. */
    async completeOperation(
      op_id: string,
      payload: OperationCompletePayload,
    ): Promise<void> {
      await call<void>(
        `/v1/integrations/claude-ai/extension/operations/${op_id}/complete`,
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    /** Download a SkillNote skill bundle ZIP for an upload op.
     *
     * Uses a dedicated abort timer because the response is binary; the
     * generic JSON `call` helper would reject the non-JSON content-type.
     * The 60 s budget is doubled vs. the JSON default because large
     * skills with attachments can take longer. If the SkillNote backend
     * is hung, the tick must NOT block forever (ops would never roll
     * back to pending).
     */
    async fetchSkillBundle(
      skill_id: string,
      version_id: string,
      timeoutMs = 60_000,
    ): Promise<Blob> {
      const q = new URLSearchParams({ skill_id, version_id });
      const headers = new Headers();
      if (extensionToken) headers.set("Authorization", `Bearer ${extensionToken}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(
          `${base}/v1/integrations/claude-ai/extension/skill-bundle?${q}`,
          { headers, signal: controller.signal },
        );
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          throw new SkillNoteNetworkError(
            `Bundle fetch timed out after ${timeoutMs}ms`,
          );
        }
        throw new SkillNoteNetworkError(`Bundle fetch network error: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SkillNoteAuthError(`Auth error (${res.status})`);
      }
      if (!res.ok) throw new Error(`bundle fetch ${res.status}`);
      return await res.blob();
    },
    /** List the claude.ai plugin groups to publish — one per collection the
     *  user toggled on. Each: { name (plugin slug), display_name, skill_count }.
     *  The extension uploads each and uninstalls any group no longer listed. */
    async fetchPluginGroups(): Promise<{
      marketplace_name: string;
      groups: { name: string; display_name: string; skill_count: number }[];
    }> {
      return call(`/v1/integrations/claude-ai/extension/plugin-groups`);
    },
    /** Fetch ONE collection group's plugin ZIP (+ ETag + skill count). */
    async fetchPluginGroupBundle(
      group: string,
      timeoutMs = 60_000,
    ): Promise<{ bundle: Blob; etag: string | null; skillCount: number }> {
      const headers = new Headers();
      if (extensionToken) headers.set("Authorization", `Bearer ${extensionToken}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const q = new URLSearchParams({ group });
      let res: Response;
      try {
        res = await fetch(
          `${base}/v1/integrations/claude-ai/extension/plugin-bundle?${q}`,
          { headers, signal: controller.signal },
        );
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          throw new SkillNoteNetworkError(
            `Plugin bundle fetch timed out after ${timeoutMs}ms`,
          );
        }
        throw new SkillNoteNetworkError(`Plugin bundle fetch network error: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SkillNoteAuthError(`Auth error (${res.status})`);
      }
      if (!res.ok) throw new Error(`plugin bundle fetch ${res.status}`);
      const skillCount = Number(res.headers.get("X-Skill-Count") ?? "0");
      return { bundle: await res.blob(), etag: res.headers.get("ETag"), skillCount };
    },
    /** Compact snapshot of THIS integration's counters. Used by the popup. */
    async fetchSelfStatus(): Promise<ExtensionSelfStatusResponse> {
      return call<ExtensionSelfStatusResponse>(
        "/v1/integrations/claude-ai/extension/status",
      );
    },
    /** Reverse sync: get the claude.ai IDs SkillNote already knows about. */
    async listKnownClaudeAIIds(): Promise<string[]> {
      const data = await call<KnownSkillIdsResponse>(
        "/v1/integrations/claude-ai/extension/known-skill-ids",
      );
      return data.claude_ai_skill_ids;
    },
    /** Reverse sync: push a claude.ai-authored skill into SkillNote. */
    async importSkill(
      args: {
        claude_ai_skill_id: string;
        claude_ai_version?: string;
        name: string;
        description: string;
        bundle: Blob;
      },
      timeoutMs = 60_000,
    ): Promise<{ skillnote_skill_id: string; created: boolean }> {
      const fd = new FormData();
      fd.set("claude_ai_skill_id", args.claude_ai_skill_id);
      if (args.claude_ai_version) fd.set("claude_ai_version", args.claude_ai_version);
      fd.set("name", args.name);
      fd.set("description", args.description);
      fd.set("bundle", args.bundle, `${args.name}.zip`);
      const headers = new Headers();
      if (extensionToken) headers.set("Authorization", `Bearer ${extensionToken}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(
          `${base}/v1/integrations/claude-ai/extension/imported-skill`,
          { method: "POST", body: fd, headers, signal: controller.signal },
        );
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          throw new SkillNoteNetworkError(
            `importSkill timed out after ${timeoutMs}ms`,
          );
        }
        throw new SkillNoteNetworkError(`importSkill network error: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SkillNoteAuthError(`Auth error (${res.status})`);
      }
      if (!res.ok) throw new Error(`importSkill ${res.status}`);
      return await res.json();
    },
  };
}

export type SkillNoteClient = ReturnType<typeof buildClient>;
