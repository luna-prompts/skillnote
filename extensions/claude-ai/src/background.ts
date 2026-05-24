// Background service worker.
//
// Lifecycle (Manifest V3): the browser can terminate this worker any time
// it's idle. State is held in chrome.storage; scheduling uses chrome.alarms
// (which survives worker termination). Anything that needs to "run later"
// must be triggered by an alarm, not a setTimeout.

import {
  ClaudeAIEndpointChangedError,
  ClaudeAINotLoggedInError,
  deleteOrgSkill,
  downloadSkillBundle,
  getOrgId,
  isLoggedIn,
  listOrgSkills,
  uploadOrgSkill,
  watchSessionCookie,
} from "./lib/claude-ai-client";
import {
  buildClient,
  SkillNoteAuthError,
  SkillNoteNetworkError,
  type SkillNoteClient,
} from "./lib/skillnote-client";
import { appendActivity, loadConfig, saveConfig } from "./lib/storage";
import { reportTelemetry } from "./lib/telemetry";
import type { OperationCompletePayload, SyncOperation } from "./lib/types";

const ALARM_SYNC = "skillnote-sync";
const ALARM_PAIR_POLL = "skillnote-pair-poll";

// Schedule the sync alarm at module load (idempotent — Chrome dedupes by name).
void initialize();

async function initialize(): Promise<void> {
  await chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 1 });
  watchSessionCookie(async (loggedIn) => {
    if (loggedIn) {
      // User just logged into claude.ai — kick a sync immediately.
      void tick();
    } else {
      await notify("Sign in to claude.ai to keep syncing", "");
    }
  });
}

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === ALARM_SYNC) {
    await tick();
  } else if (name === ALARM_PAIR_POLL) {
    await pollPairOnce();
  }
});

// ── Pairing flow (extension side) ─────────────────────────────────────────────

/** Called by options.ts when the user clicks "Pair". */
export async function startPairing(skillnoteUrl: string, browserLabel: string): Promise<{ pairing_code: string; redemption_url: string; expires_at: string }> {
  const client = buildClient(skillnoteUrl);
  const res = await client.startPair(browserLabel);
  await saveConfig({
    skillnote_url: skillnoteUrl,
    browser_label: browserLabel,
    pairing: {
      pairing_token: res.pairing_token,
      pairing_code: res.pairing_code,
      integration_id: res.integration_id,
      redemption_url: res.redemption_url,
      expires_at: res.expires_at,
    },
  });
  await chrome.alarms.create(ALARM_PAIR_POLL, { periodInMinutes: 0.1 });
  return {
    pairing_code: res.pairing_code,
    redemption_url: res.redemption_url,
    expires_at: res.expires_at,
  };
}

async function pollPairOnce(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.skillnote_url || !cfg.pairing) {
    await chrome.alarms.clear(ALARM_PAIR_POLL);
    return;
  }
  // Expired? Give up.
  if (new Date(cfg.pairing.expires_at).getTime() < Date.now()) {
    await saveConfig({ pairing: undefined });
    await chrome.alarms.clear(ALARM_PAIR_POLL);
    await notify("Pairing expired", "Restart the pairing from the extension popup.");
    return;
  }
  const client = buildClient(cfg.skillnote_url);
  try {
    const status = await client.pollPair(cfg.pairing.pairing_token);
    if (status.approved && status.extension_token) {
      await saveConfig({
        extension_token: status.extension_token,
        pairing: undefined,
      });
      await chrome.alarms.clear(ALARM_PAIR_POLL);
      await notify("SkillNote connected", "Syncing skills to claude.ai now.");
      void tick(); // first sync immediately
    }
  } catch (e) {
    // Network or 404 on the token — let the next poll retry. If permanently
    // gone, the user can re-pair from the options page.
    console.warn("pollPair error", e);
  }
}

// ── Sync engine ───────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.skillnote_url || !cfg.extension_token) return;
  if (!(await isLoggedIn())) {
    await saveConfig({ last_error: "claude.ai session not active" });
    return;
  }

  const client = buildClient(cfg.skillnote_url, cfg.extension_token);

  let ops: SyncOperation[];
  try {
    ops = await client.fetchOperations();
  } catch (e) {
    await handleSkillNoteError(e);
    return;
  }
  if (ops.length === 0) {
    // No pending work — opportunistically force a list-op to drive reverse
    // sync (the helper is coalesced on the backend so this is cheap).
    // TODO Phase 3: add a /trigger-list endpoint and call it here.
    await saveConfig({ last_sync_at: new Date().toISOString() });
    return;
  }

  // Discover org_id once and cache.
  let orgId: string | undefined;
  try {
    orgId = await getOrgId();
  } catch (e) {
    // Ops were already pulled (marked in_progress server-side). If we
    // can't reach claude.ai we MUST release them back to pending,
    // otherwise the queue stalls — fetchOperations only returns
    // status='pending', so ops stuck in_progress are invisible to the
    // next tick.
    const isAuthExpired = e instanceof ClaudeAINotLoggedInError;
    await releaseInFlightOps(client, ops, (e as Error).message, isAuthExpired);

    if (isAuthExpired) {
      await saveConfig({ last_error: "claude.ai session expired" });
      await notify("claude.ai sign-in required", "Open claude.ai and sign in to resume sync.");
      return;
    }
    if (e instanceof ClaudeAIEndpointChangedError) {
      await reportEndpointChange(e.message);
      return;
    }
    await saveConfig({ last_error: (e as Error).message });
    return;
  }

  for (const op of ops) {
    await executeOp(op, client, orgId);
  }

  // Refresh popup-facing counters once per tick. Failures here are
  // non-fatal — the sync itself already succeeded.
  let counterPatch: Partial<{
    linked_skill_count: number;
    pending_op_count: number;
    failed_op_count: number;
  }> = {};
  try {
    const status = await client.fetchSelfStatus();
    counterPatch = {
      linked_skill_count: status.linked_skill_count,
      pending_op_count: status.pending_op_count,
      failed_op_count: status.failed_op_count,
    };
  } catch (e) {
    console.warn("fetchSelfStatus failed", e);
  }

  await saveConfig({
    last_sync_at: new Date().toISOString(),
    last_error: undefined,
    ...counterPatch,
  });
}

async function executeOp(
  op: SyncOperation,
  client: SkillNoteClient,
  orgId: string,
): Promise<void> {
  try {
    switch (op.kind) {
      case "upload":
      case "update": {
        const version_id = op.payload.version_id as string | undefined;
        if (!op.skill_id || !version_id) throw new Error("upload op missing skill_id/version_id");
        const bundle = await client.fetchSkillBundle(op.skill_id, version_id);
        const name = (op.payload.name as string) ?? "skill";
        const result = await uploadOrgSkill(orgId, bundle, name);
        await client.completeOperation(op.id, {
          success: true,
          result: { claude_ai_skill_id: result.skill_id, claude_ai_version: result.version },
          claude_ai_org_id: orgId,
        });
        await appendActivity({
          ts: new Date().toISOString(),
          kind: "push",
          message: `${name} → claude.ai`,
        });
        break;
      }
      case "delete": {
        const claude_ai_skill_id = op.payload.claude_ai_skill_id as string | undefined;
        if (!claude_ai_skill_id) throw new Error("delete op missing claude_ai_skill_id");
        await deleteOrgSkill(orgId, claude_ai_skill_id);
        await client.completeOperation(op.id, {
          success: true,
          claude_ai_org_id: orgId,
        });
        await appendActivity({
          ts: new Date().toISOString(),
          kind: "delete",
          message: `removed ${claude_ai_skill_id}`,
        });
        break;
      }
      case "list": {
        // Reverse sync: discover claude.ai-authored skills and import them.
        const remote = await listOrgSkills(orgId);
        const known = await client.listKnownClaudeAIIds();
        const knownSet = new Set(known);
        let imported = 0;
        for (const skill of remote) {
          if (knownSet.has(skill.id)) continue;
          try {
            const bundle = await downloadSkillBundle(orgId, skill.id);
            await client.importSkill({
              claude_ai_skill_id: skill.id,
              claude_ai_version: skill.version,
              name: skill.name,
              description: skill.description ?? "",
              bundle,
            });
            imported++;
            await appendActivity({
              ts: new Date().toISOString(),
              kind: "pull",
              message: `${skill.name} ← claude.ai`,
            });
          } catch (e) {
            // One skill failing shouldn't abort the whole list op.
            console.warn(`import ${skill.id} failed`, e);
          }
        }
        await client.completeOperation(op.id, {
          success: true,
          result: { imported_count: imported },
          claude_ai_org_id: orgId,
        });
        break;
      }
      default:
        throw new Error(`unsupported op kind: ${op.kind}`);
    }
  } catch (e) {
    const payload: OperationCompletePayload = {
      success: false,
      error: (e as Error).message,
    };
    // claude.ai 401 / session-gone surfaces as ClaudeAINotLoggedInError.
    // Flag it so the backend can flip status -> cookie_expired and emit
    // the matching audit event. Without this, the user sees N op_failed
    // rows and no hint that the fix is "sign in to claude.ai."
    if (e instanceof ClaudeAINotLoggedInError) {
      payload.auth_expired = true;
    }
    try {
      await client.completeOperation(op.id, payload);
    } catch {
      /* fall through — next tick will retry */
    }
    await appendActivity({
      ts: new Date().toISOString(),
      kind: "error",
      message: `${op.kind} failed: ${(e as Error).message.slice(0, 80)}`,
    });
    if (e instanceof ClaudeAIEndpointChangedError) {
      await reportEndpointChange(e.message);
    }
  }
}

// ── Error handling ────────────────────────────────────────────────────────────

/** Release in-flight ops back to pending when claude.ai is unreachable.
 *
 * Fetched ops are marked in_progress server-side. If we then fail to
 * reach claude.ai, those ops would be stuck — never retried on the
 * next tick (which only fetches PENDING ops). Reporting failure with
 * success=false flips them back to pending (until the retry budget is
 * exhausted, then 'failed' and surfaced in the UI).
 */
async function releaseInFlightOps(
  client: SkillNoteClient,
  ops: SyncOperation[],
  error: string,
  authExpired: boolean = false,
): Promise<void> {
  for (const op of ops) {
    try {
      await client.completeOperation(op.id, {
        success: false,
        error: `claude.ai unreachable: ${error.slice(0, 200)}`,
        auth_expired: authExpired || undefined,
      });
    } catch {
      // If SkillNote is ALSO unreachable, there's nothing to do — the
      // ops stay in_progress until they age out or until manual
      // intervention. Best-effort.
    }
  }
}


async function handleSkillNoteError(e: unknown): Promise<void> {
  if (e instanceof SkillNoteAuthError) {
    await saveConfig({
      extension_token: undefined,
      last_error: "Extension token revoked; re-pair from options",
    });
    await notify("SkillNote disconnected", "Re-pair from the extension options page.");
    return;
  }
  if (e instanceof SkillNoteNetworkError) {
    await saveConfig({ last_error: e.message });
    return;
  }
  await saveConfig({ last_error: (e as Error).message });
}

async function reportEndpointChange(msg: string): Promise<void> {
  await saveConfig({ last_error: msg });
  await notify(
    "claude.ai endpoint changed",
    "Update the SkillNote extension to restore sync.",
  );
  // Best-effort anonymous report to the user's own SkillNote backend so the
  // operator can decide whether to push an extension update. Never goes to
  // SkillNote-project servers.
  void reportTelemetry("endpoint_changed", { message: msg.slice(0, 200) });
}

async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/128.png"),
      title,
      message,
    });
  } catch {
    // Notification API may be unavailable in incognito / restricted profiles.
  }
}

// ── Message bridge for the popup / options page ───────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "skillnote.sync-now") {
    void tick().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg?.type === "skillnote.start-pair") {
    void startPairing(msg.skillnote_url, msg.browser_label)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "skillnote.disconnect") {
    void (async () => {
      await saveConfig({
        extension_token: undefined,
        pairing: undefined,
        recent_activity: [],
      });
      await chrome.alarms.clear(ALARM_PAIR_POLL);
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});
