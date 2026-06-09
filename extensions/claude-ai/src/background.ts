// Background service worker.
//
// Lifecycle (Manifest V3): the browser can terminate this worker any time
// it's idle. State is held in chrome.storage; scheduling uses chrome.alarms
// (which survives worker termination). Anything that needs to "run later"
// must be triggered by an alarm, not a setTimeout.

import {
  ClaudeAIEndpointChangedError,
  ClaudeAINotLoggedInError,
  ClaudeAIPermanentError,
  deleteOrgSkill,
  downloadSkillBundle,
  ensureSkillNoteMarketplace,
  getOrgId,
  isLoggedIn,
  listAccountPlugins,
  listConversationSkillInvocations,
  listOrgSkills,
  setPluginEnabled,
  uploadOrgSkill,
  uploadPluginBundle,
  watchSessionCookie,
} from "./lib/claude-ai-client";
import {
  buildClient,
  SkillNoteAuthError,
  SkillNoteNetworkError,
  type SkillNoteClient,
} from "./lib/skillnote-client";
import {
  appendActivity,
  filterAndMarkNewInvocations,
  loadConfig,
  saveConfig,
} from "./lib/storage";
import { reportTelemetry } from "./lib/telemetry";
import type { OperationCompletePayload, SyncOperation } from "./lib/types";

const ALARM_SYNC = "skillnote-sync";
const ALARM_PAIR_POLL = "skillnote-pair-poll";

// Schedule the sync alarm at module load (idempotent — Chrome dedupes by name).
void initialize();

async function initialize(): Promise<void> {
  await chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 1 });
  // Re-register the web→SW sync bridge on every worker start (idempotent), so
  // the SkillNote web app can trigger an immediate sync when already paired.
  void registerWebBridge();
  // Drain any pending ops on worker start (reload / wake) rather than waiting
  // for the first 1-min alarm — `tick()` no-ops when unpaired and is guarded
  // against overlapping runs.
  void tick();
  watchSessionCookie(async (loggedIn) => {
    // Record the session state authoritatively so the popup/options can
    // render a calm "Sign in to claude.ai" affordance rather than treating
    // a signed-out session as an error.
    await saveConfig({ claude_session_active: loggedIn });
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

/** Register (idempotently) a content script on the paired SkillNote web origin
 *  that relays a "sync now" window-message from the web app to this worker.
 *  This is what lets a "Sync to claude.ai" toggle in the web UI trigger an
 *  IMMEDIATE sync (waking the dormant MV3 worker) instead of the change
 *  sitting in the queue until the 1-minute alarm fires. Also injects into any
 *  already-open SkillNote tabs so it works without a page reload. */
async function registerWebBridge(skillnoteUrl?: string): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return;
  let url = skillnoteUrl;
  if (!url) {
    const cfg = await loadConfig();
    url = cfg.skillnote_url;
  }
  if (!url) return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  const pattern = `${origin}/*`;
  // Only register where we actually hold host permission (granted at pairing).
  const hasPerm = await chrome.permissions
    .contains({ origins: [pattern] })
    .catch(() => false);
  if (!hasPerm) return;
  try {
    await chrome.scripting
      .unregisterContentScripts({ ids: ["skillnote-web-bridge"] })
      .catch(() => {});
    await chrome.scripting.registerContentScripts([
      {
        id: "skillnote-web-bridge",
        matches: [pattern],
        js: ["content.js"],
        runAt: "document_idle",
      },
    ]);
    // registerContentScripts only covers FUTURE loads — inject into currently
    // open SkillNote tabs too so the bridge works without a reload.
    const tabs = await chrome.tabs.query({ url: pattern });
    for (const t of tabs) {
      if (t.id != null) {
        chrome.scripting
          .executeScript({ target: { tabId: t.id }, files: ["content.js"] })
          .catch(() => {});
      }
    }
  } catch (e) {
    console.warn("registerWebBridge failed", e);
  }
}

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
      void registerWebBridge(cfg.skillnote_url); // let the web UI trigger syncs
      void tick(); // first sync immediately
    }
  } catch (e) {
    // Network or 404 on the token — let the next poll retry. If permanently
    // gone, the user can re-pair from the options page.
    console.warn("pollPair error", e);
  }
}

// ── Usage analytics ─────────────────────────────────────────────────────────

const CONV_URL_RE = /^https:\/\/claude\.ai\/chat\/([0-9a-f-]{8,})/i;
const MAX_CONVS_PER_SCAN = 10;

/** Scan open claude.ai conversation tabs for skill invocations (skill-file
 *  reads) and report each one ONCE to SkillNote's shared usage hook. The
 *  background can reach claude.ai with the session cookie (same path that
 *  uploads skills), and tabs.query exposes conversation URLs because we hold
 *  host_permissions for claude.ai. */
async function scanUsage(client: SkillNoteClient): Promise<void> {
  // Discover the chat-capable org once. If discovery fails (not signed in,
  // shape drift) there's nothing to scan.
  let orgId: string;
  try {
    orgId = await getOrgId();
  } catch {
    return;
  }

  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: "https://claude.ai/chat/*" });
  } catch {
    return; // tabs API unavailable (rare) — skip.
  }

  // Unique conversation ids from the open tabs, most-recent first, bounded.
  const convIds: string[] = [];
  for (const t of tabs) {
    const m = t.url ? CONV_URL_RE.exec(t.url) : null;
    const id = m?.[1];
    if (id && !convIds.includes(id)) convIds.push(id);
  }
  const scanList = convIds.slice(0, MAX_CONVS_PER_SCAN);

  for (const convId of scanList) {
    let invocations;
    let chatTitle = "";
    try {
      const res = await listConversationSkillInvocations(orgId, convId);
      invocations = res.invocations;
      chatTitle = res.title;
    } catch (e) {
      // claude.ai endpoint drift / network — skip this conversation, keep going.
      console.warn(`usage scan: conversation ${convId} failed`, e);
      continue;
    }
    if (invocations.length === 0) continue;

    // Dedup: only report invocations we haven't reported before.
    const freshKeys = await filterAndMarkNewInvocations(
      invocations.map((i) => i.dedupKey),
    );
    if (freshKeys.length === 0) continue;
    const freshSet = new Set(freshKeys);

    for (const inv of invocations) {
      if (!freshSet.has(inv.dedupKey)) continue;
      try {
        await client.reportSkillUsed(inv.slug, convId, chatTitle);
        await appendActivity({
          ts: new Date().toISOString(),
          kind: "used",
          message: `${inv.slug} used in claude.ai`,
        });
      } catch (e) {
        // Reporting failed — the dedup key is already marked seen, so we
        // won't retry this exact invocation. Acceptable: usage analytics is
        // best-effort, not a billing ledger.
        console.warn(`report skill-used ${inv.slug} failed`, e);
      }
    }
  }
}

// ── Sync engine ───────────────────────────────────────────────────────────────

let _ticking = false;

/** Re-entrancy guard around the sync engine. The 1-min alarm and the popup/
 *  options "Sync now" message both drive a tick and can overlap. A second
 *  concurrent run would double-scan usage (extra claude.ai conversation-tree
 *  fetches) and let the two end-of-tick saveConfig writes race, flickering the
 *  last_error / session state. Skip the re-entrant run if one is in flight. */
async function tick(): Promise<void> {
  if (_ticking) return;
  _ticking = true;
  try {
    await _runTick();
  } finally {
    _ticking = false;
  }
}

async function _runTick(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.skillnote_url || !cfg.extension_token) return;
  if (!(await isLoggedIn())) {
    // Signed out of claude.ai is a normal, recoverable state — not an error.
    // Record it as such and clear any stale error so the UI shows the calm
    // "Sign in to claude.ai" CTA instead of a red error banner.
    await saveConfig({ claude_session_active: false, last_error: undefined });
    return;
  }

  const client = buildClient(cfg.skillnote_url, cfg.extension_token);

  // Usage analytics: scan open claude.ai conversations for skill
  // invocations and report them. Independent of the sync queue so it runs
  // even when there's nothing to sync. Best-effort — never breaks sync.
  try {
    await scanUsage(client);
  } catch (e) {
    console.warn("usage scan failed", e);
  }

  let ops: SyncOperation[];
  try {
    ops = await client.fetchOperations();
  } catch (e) {
    await handleSkillNoteError(e);
    return;
  }
  if (ops.length === 0) {
    // No pending work — but reaching this branch IS a successful tick.
    // Clear any stale last_error from prior auth/network failures so
    // the UI stops showing "claude.ai session expired" after the user
    // has signed back in.
    await saveConfig({
      last_sync_at: new Date().toISOString(),
      last_error: undefined,
      claude_session_active: true,
    });
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
      // Mid-sync 401 — the cookie lapsed. Mark the session inactive (calm
      // "Sign in" CTA) rather than leaving a raw error string in the UI.
      await saveConfig({ claude_session_active: false, last_error: undefined });
      await notify("claude.ai sign-in required", "Open claude.ai and sign in to resume sync.");
      return;
    }
    if (e instanceof ClaudeAIEndpointChangedError) {
      await reportEndpointChange(e.message);
      return;
    }
    // Non-auth failure (e.g. org-scope 403, org-discovery miss). The cookie
    // is present (isLoggedIn passed above), so assert the session is healthy
    // — otherwise a stale `false` from a prior signed-out tick would wrongly
    // render "Sign in" instead of surfacing the real error.
    await saveConfig({ claude_session_active: true, last_error: (e as Error).message });
    return;
  }

  // Execute each op; track whether the claude.ai cookie lapsed mid-loop so we
  // don't end the tick reporting a healthy session while ops are 401-failing.
  let authExpiredDuringOps = false;
  for (const op of ops) {
    if (await executeOp(op, client, orgId)) authExpiredDuringOps = true;
  }
  if (authExpiredDuringOps) {
    await saveConfig({ claude_session_active: false, last_error: undefined });
    await notify("claude.ai sign-in required", "Open claude.ai and sign in to resume sync.");
    return;
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
    claude_session_active: true,
    ...counterPatch,
  });
}

/** Execute one op. Returns true if it failed because the claude.ai cookie
 *  lapsed (401) — the caller uses that to mark the session inactive instead
 *  of ending the tick reporting a healthy "connected" session. */
async function executeOp(
  op: SyncOperation,
  client: SkillNoteClient,
  orgId: string,
): Promise<boolean> {
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
      case "publish_group": {
        // Git-free named-group sync. Each published SkillNote collection is
        // its own claude.ai plugin group ("SkillNote: <name>") under one
        // "SkillNote" marketplace. This op reconciles the whole set:
        //   1. fetch the desired groups (published collections) from SkillNote
        //   2. ensure the marketplace exists
        //   3. upload (overwrite) each group's bundle
        //   4. uninstall any existing group whose collection was toggled off
        // Each group is replace-as-a-whole, so re-upload handles add/edit/del
        // of skills within it.
        const { groups } = await client.fetchPluginGroups();
        const marketplaceId = await ensureSkillNoteMarketplace(orgId);

        let uploaded = 0;
        let totalSkills = 0;
        let failedGroups = 0;
        const wantNames = new Set<string>();
        for (const g of groups) {
          wantNames.add(g.name);
          try {
            const { bundle, skillCount } = await client.fetchPluginGroupBundle(g.name);
            const up = await uploadPluginBundle(orgId, marketplaceId, bundle);
            // Re-enable in case this group's plugin was previously retired
            // (collection toggled off, then back on). An overwrite-upload
            // refreshes content but does NOT itself re-enable a disabled
            // plugin, so a re-published collection would stay invisible.
            // setPluginEnabled(true) is idempotent for already-enabled plugins.
            if (up.plugin_id) await setPluginEnabled(orgId, up.plugin_id, true);
            uploaded++;
            totalSkills += skillCount;
          } catch (e) {
            // A logged-out error aborts the whole op (no point continuing).
            if (e instanceof ClaudeAINotLoggedInError) throw e;
            // Otherwise one bad group must NOT abort the batch — if it did, the
            // retire pass below would be skipped and a collection toggled off
            // would stay live on claude.ai forever (never disabled).
            failedGroups++;
            console.warn(`publish_group: group "${g.name}" failed`, e);
          }
        }

        // Retire groups for collections turned off: disable any plugin in the
        // SkillNote marketplace that isn't in the desired set. Runs
        // UNCONDITIONALLY (even when some uploads failed) so retirements are
        // never silently dropped by an unrelated group's upload error.
        let retired = 0;
        try {
          const existing = await listAccountPlugins(orgId, marketplaceId);
          for (const p of existing) {
            if (!wantNames.has(p.name)) {
              await setPluginEnabled(orgId, p.id, false);
              retired++;
            }
          }
        } catch (e) {
          // Reconciliation of removals is best-effort; the uploads above are
          // the critical path. Log and continue.
          console.warn("publish_group: uninstall-removed pass failed", e);
        }

        if (failedGroups > 0) {
          // Some groups didn't upload — report failure so the op retries on a
          // later tick (overwrite-upload makes re-uploading the good ones a
          // no-op). The retire pass already ran, so removals aren't lost.
          await client.completeOperation(op.id, {
            success: false,
            error: `${failedGroups} of ${groups.length} group(s) failed to upload`,
            claude_ai_org_id: orgId,
          });
          await appendActivity({
            ts: new Date().toISOString(),
            kind: "error",
            message: `SkillNote → claude.ai: ${failedGroups} group(s) failed to sync`,
          });
          return false; // retry next tick; not an auth abort
        }

        await client.completeOperation(op.id, {
          success: true,
          result: {
            group_count: uploaded,
            skill_count: totalSkills,
            retired_count: retired,
            marketplace_id: marketplaceId,
          },
          claude_ai_org_id: orgId,
        });
        await appendActivity({
          ts: new Date().toISOString(),
          kind: "push",
          message: `SkillNote → claude.ai (${uploaded} group${uploaded === 1 ? "" : "s"}, ${totalSkills} skills)`,
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
        // Unknown op kind can never succeed by retrying — fail it permanently
        // so it doesn't burn the 3-attempt budget and spam identical errors.
        // (The backend no longer enqueues the unhandled "fetch_one" kind.)
        throw new ClaudeAIPermanentError(`unsupported op kind: ${op.kind}`);
    }
    return false;
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
    // A permanent rejection (e.g. duplicate skill name) can't be fixed by
    // retrying — tell the backend to fail it immediately instead of
    // burning the 3-attempt budget and logging repeated red lines.
    if (e instanceof ClaudeAIPermanentError) {
      payload.permanent = true;
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
    return e instanceof ClaudeAINotLoggedInError;
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
    // Visible in the service-worker console — confirms the web-bridge (or
    // popup) reached the worker and a sync is running.
    console.info("[SkillNote] sync-now received → syncing");
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
