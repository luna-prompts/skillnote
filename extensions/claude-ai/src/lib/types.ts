// Shared types between the background worker, popup, and options page.
// Mirrors the SkillNote backend's Pydantic schemas (app/schemas/claude_ai.py).
// If the backend changes a contract, update here and re-run typecheck.

export type IntegrationStatus =
  | "pending_approval"
  | "active"
  | "cookie_expired"
  | "disconnected"
  | "error";

export type OpKind =
  | "upload"
  | "update"
  | "delete"
  | "list"
  | "fetch_one"
  | "publish_group";

/** Pending sync operation handed to the extension by SkillNote. */
export interface SyncOperation {
  id: string;
  kind: OpKind;
  skill_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
}

/** Result reported back to SkillNote after executing an operation. */
export interface OperationCompletePayload {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  claude_ai_org_id?: string;
  /** Flag a 401/expired-cookie outcome so the backend can flip the
   *  integration to `cookie_expired` and surface a re-sign-in CTA. */
  auth_expired?: boolean;
  /** Permanent failure (4xx invalid request) — backend fails the op
   *  immediately instead of retrying. */
  permanent?: boolean;
}

/** Local extension configuration (lives in chrome.storage.local). */
export interface ExtensionConfig {
  skillnote_url?: string;
  extension_token?: string;
  browser_label?: string;
  // Setup-form draft (URL + label typed but not yet paired). Persisted so the
  // popup closing mid-flow — e.g. while Chrome shows the host-permission
  // prompt — doesn't lose what the user typed; the form restores on reopen.
  setup_draft?: { url: string; label: string };
  // Pairing state — only present while a pairing handshake is in flight.
  pairing?: {
    pairing_token: string;
    pairing_code: string;
    integration_id: string;
    redemption_url: string;
    expires_at: string;
  };
  // Last sync metadata for the popup.
  last_sync_at?: string;
  last_error?: string;
  // Whether the claude.ai session cookie is currently active. Set
  // authoritatively by the background worker (cookie watcher + each tick)
  // so the UI can show a calm "Sign in to claude.ai" state instead of
  // surfacing the signed-out condition as a scary error. `undefined`
  // means "not yet determined" (fresh pair, before the first tick).
  claude_session_active?: boolean;
  // Whether the SkillNote APP (backend at skillnote_url) was reachable on the
  // last attempt. The other half of "is the connection live": claude_session
  // covers claude.ai, this covers the self-hosted app. Set by each tick and by
  // the popup's on-open health ping. `undefined` = not yet checked.
  skillnote_reachable?: boolean;
  // ISO timestamp of the last successful reach to the SkillNote app.
  skillnote_checked_at?: string;
  // claude.ai's current appearance, sampled from an open claude.ai tab so the
  // panel can match it (dark/light). Undefined = not yet detected → the panel
  // falls back to the OS `prefers-color-scheme`.
  claude_theme?: "dark" | "light";
  // Counters mirrored from the last status fetch.
  pending_op_count?: number;
  failed_op_count?: number;
  linked_skill_count?: number;
  // Recent activity ring buffer for the popup (last ~10 events).
  recent_activity?: ActivityEntry[];
}

export interface ActivityEntry {
  ts: string;            // ISO timestamp
  kind: "push" | "pull" | "delete" | "error" | "used";
  message: string;       // human-readable: "pdf-extractor → claude.ai"
}

/** Skill metadata returned by claude.ai's list endpoint. */
export interface ClaudeAISkillSummary {
  id: string;
  name: string;
  description?: string;
  version?: string;
  updated_at?: string;
}
