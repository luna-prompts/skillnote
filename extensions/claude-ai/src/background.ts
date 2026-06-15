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
  // Toolbar icon opens the SIDE PANEL (native, full-height surface — same
  // pattern as Claude in Chrome) instead of a cramped popup. Guarded: Firefox
  // and older Chrome don't expose chrome.sidePanel; there the manifest keeps
  // its popup/sidebar fallback.
  try {
    const sidePanel = (chrome as unknown as {
      sidePanel?: { setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void> };
    }).sidePanel;
    await sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn("sidePanel behavior unavailable", e);
  }
  await chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 1 });
  // Re-register the web→SW sync bridge on every worker start (idempotent), so
  // the SkillNote web app can trigger an immediate sync when already paired.
  void registerWebBridge();
  // Attach the theme observer to ALREADY-OPEN claude.ai tabs. The static
  // manifest content_scripts only covers FUTURE page loads, so without this a
  // user who reloads the extension wouldn't get real-time theme until they
  // refreshed claude.ai. The content script self-guards against double-init.
  void injectIntoOpenClaudeTabs();
  // Drain any pending ops on worker start (reload / wake) rather than waiting
  // for the first 1-min alarm — `tick()` no-ops when unpaired and is guarded
  // against overlapping runs.
  void tick();
  // NOTE: the claude.ai session cookie watcher is registered at the TOP LEVEL
  // (below), NOT here. MV3 only routes wake-up events to listeners added
  // synchronously during top-level script evaluation; registering it after the
  // awaits above would silently miss login/logout while the worker is dormant.
}

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === ALARM_SYNC) {
    await tick();
  } else if (name === ALARM_PAIR_POLL) {
    await pollPairOnce();
  }
});

// Watch the claude.ai session cookie at TOP LEVEL (synchronous registration) so
// a dormant MV3 worker still wakes on login/logout. Inside initialize() — after
// its awaits — this listener wouldn't be guaranteed to wake the worker, so
// instant sign-in/out detection would silently fall back to the 1-min tick.
watchSessionCookie(async (loggedIn) => {
  // Record the session state authoritatively so the popup/options can render a
  // calm "Sign in to claude.ai" affordance rather than treating a signed-out
  // session as an error.
  await saveConfig({ claude_session_active: loggedIn });
  if (loggedIn) {
    void tick(); // just logged in → sync immediately
  } else {
    await notify("Sign in to claude.ai to keep syncing", "");
  }
});

// Near-instant theme follow: re-sample the surrounding tab's appearance when a
// relevant tab finishes loading or becomes active. "Relevant" = claude.ai OR
// the paired SkillNote app — the two pages the panel docks beside and the two
// origins we hold permission to read. detectSurroundingTheme is cheap and only
// writes when the theme actually changed, so these events don't cause churn.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (await _isThemeSource(tab.url)) void detectSurroundingTheme();
  } catch {
    /* tab gone — ignore */
  }
});
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && (await _isThemeSource(tab.url))) {
    void detectSurroundingTheme();
  }
});

/** Inject content.js (theme observer) into open claude.ai tabs on worker
 *  start — content_scripts only auto-inject on future loads, so this covers
 *  tabs already open when the extension (re)loads. Self-guarded against
 *  double-init in the page. */
async function injectIntoOpenClaudeTabs(): Promise<void> {
  if (!chrome.scripting?.executeScript) return;
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://claude.ai/*", "https://claude.com/*"],
      status: "complete",
    });
    for (const t of tabs) {
      if (t.id != null) {
        chrome.scripting
          .executeScript({ target: { tabId: t.id }, files: ["content.js"] })
          .catch(() => {});
      }
    }
  } catch {
    /* no permission / no tabs — non-fatal */
  }
}

/** A tab whose theme the panel should mirror + we have permission to read:
 *  claude.ai/claude.com, or the paired SkillNote app's origin. */
async function _isThemeSource(url?: string): Promise<boolean> {
  if (!url) return false;
  if (url.startsWith("https://claude.ai/") || url.startsWith("https://claude.com/")) return true;
  const cfg = await loadConfig();
  if (!cfg.skillnote_url) return false;
  try {
    return url.startsWith(new URL(cfg.skillnote_url).origin + "/");
  } catch {
    return false;
  }
}

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
  // The 0.1-min alarm is the durable fallback, but Chrome clamps alarm periods
  // to 30s in packed (Web Store) builds — so approval would lag up to ~30s and
  // read as broken. The side panel stays open right after Connect (worker
  // awake), so also run a fast ~2s poll to catch a quick approval near-instantly.
  void fastPollPairing();
  return {
    pairing_code: res.pairing_code,
    redemption_url: res.redemption_url,
    expires_at: res.expires_at,
  };
}

// Fast pairing poll: while a pairing is pending and the worker is awake (the
// side panel keeps it alive for a stretch after Connect), re-check every ~2s so
// approval is detected without waiting on the 30s-clamped alarm. Self-stops as
// soon as the pairing resolves (pollPairOnce clears cfg.pairing on approve or
// expiry); if the worker sleeps the loop dies and the alarm takes over. The
// module-level timer guards against stacking loops across repeated startPairing.
let _fastPairTimer: ReturnType<typeof setTimeout> | null = null;
async function fastPollPairing(): Promise<void> {
  if (_fastPairTimer) return; // a loop is already running
  const step = async (): Promise<void> => {
    _fastPairTimer = null;
    const cfg = await loadConfig();
    if (!cfg.pairing) return; // resolved (token saved) or cleared — stop
    await pollPairOnce();
    const after = await loadConfig();
    if (after.pairing) _fastPairTimer = setTimeout(() => void step(), 2000);
  };
  _fastPairTimer = setTimeout(() => void step(), 1500);
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
  // MV3 keepalive: a sync can span several claude.ai round-trips (marketplace
  // ensure + per-group upload). Pinging a chrome API every 20s resets the
  // service-worker idle timer so Chrome doesn't kill the worker mid-op — the
  // exact failure that left ops stuck `in_progress` with no error.
  const keepAlive = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 20_000);
  try {
    await _runTick();
  } finally {
    clearInterval(keepAlive);
    _ticking = false;
  }
}

/** Manual "Sync now": force a fresh reconcile op (so it's never a silent
 *  no-op when the queue is empty), then run the tick to process it. */
async function syncNow(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.skillnote_url && cfg.extension_token) {
    try {
      const client = buildClient(cfg.skillnote_url, cfg.extension_token);
      await client.reconcile();
    } catch (e) {
      // Non-fatal — still tick (there may be other pending work, and the
      // tick surfaces auth/network errors with a clear reason).
      console.warn("[SkillNote] reconcile failed; ticking anyway", e);
    }
  }
  await tick();
}

async function _runTick(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.skillnote_url || !cfg.extension_token) return;
  // Keep the panel's appearance in step with claude.ai (cheap; best-effort).
  void detectSurroundingTheme();
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
    // Still pull self-status: a reaper-failed op (worker killed mid-sync)
    // leaves 0 PENDING ops yet a non-zero failed count + a server-side reason.
    // Surface it so the popup's error state fires instead of showing all-clear;
    // otherwise we'd silently clear the very failure we need to report.
    let failed = 0;
    let failReason: string | undefined;
    try {
      const s = await client.fetchSelfStatus();
      failed = s.failed_op_count ?? 0;
      failReason = s.last_error ?? undefined;
    } catch {
      /* network blip — the next tick retries; don't fake a failure */
    }
    await saveConfig({
      last_sync_at: new Date().toISOString(),
      last_error:
        failed > 0
          ? failReason || "A sync failed after several attempts. Use Retry."
          : undefined,
      claude_session_active: true,
      // Reaching here means fetchOperations succeeded → the app is reachable.
      skillnote_reachable: true,
      skillnote_checked_at: new Date().toISOString(),
      failed_op_count: failed,
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
  let failReason: string | undefined;
  try {
    const status = await client.fetchSelfStatus();
    counterPatch = {
      linked_skill_count: status.linked_skill_count,
      pending_op_count: status.pending_op_count,
      failed_op_count: status.failed_op_count,
    };
    failReason = status.last_error ?? undefined;
  } catch (e) {
    console.warn("fetchSelfStatus failed", e);
  }

  // Surface a residual failure (e.g. a sibling op the reaper gave up on) even
  // though THIS tick's ops succeeded — so "we tried and gave up" reaches the
  // popup right after the attempts, instead of being cleared as all-clear.
  const hasFailed = (counterPatch.failed_op_count ?? 0) > 0;
  await saveConfig({
    last_sync_at: new Date().toISOString(),
    last_error: hasFailed
      ? failReason || "A sync failed after several attempts. Use Retry."
      : undefined,
    claude_session_active: true,
    skillnote_reachable: true,
    skillnote_checked_at: new Date().toISOString(),
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
          // "(0 groups, 0 skills)" reads like a failure — say what it means.
          message:
            uploaded === 0
              ? "Nothing selected to sync — pick collections in the popup"
              : `SkillNote → claude.ai (${uploaded} group${uploaded === 1 ? "" : "s"}, ${totalSkills} skills)`,
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
    // Can't reach the SkillNote APP (backend). Mark the connection down + give
    // a fix-it message instead of a raw "network error" — the usual cause is
    // the self-hosted app being stopped or the URL being wrong.
    const cfg = await loadConfig();
    await saveConfig({
      skillnote_reachable: false,
      last_error: `Can't reach the SkillNote app at ${cfg.skillnote_url ?? "your server"}. Make sure it's running and the URL is right, then Retry.`,
    });
    return;
  }
  await saveConfig({ last_error: (e as Error).message });
}

/** Lightweight health ping (plugin → SkillNote app). Used by the popup on
 *  open so the connection state is live, not up-to-60s stale. Only touches
 *  the backend (fetchSelfStatus), never claude.ai, so it's cheap. */
async function pingHealth(): Promise<void> {
  // Match claude.ai's appearance — sample its theme whenever the panel opens.
  void detectSurroundingTheme();
  const cfg = await loadConfig();
  if (!cfg.skillnote_url || !cfg.extension_token) return;
  const client = buildClient(cfg.skillnote_url, cfg.extension_token);
  try {
    const s = await client.fetchSelfStatus();
    await saveConfig({
      skillnote_reachable: true,
      skillnote_checked_at: new Date().toISOString(),
      linked_skill_count: s.linked_skill_count,
      pending_op_count: s.pending_op_count,
      failed_op_count: s.failed_op_count,
    });
  } catch (e) {
    if (e instanceof SkillNoteNetworkError) {
      await saveConfig({ skillnote_reachable: false });
    }
    // Auth/other errors are handled by the full tick — don't clobber here.
  }
}

/** Match the panel's light/dark to the page it's docked beside. The panel
 *  can't read another page's DOM from its own context, but we hold permission
 *  for claude.ai AND the paired SkillNote app — so sample whichever of those
 *  is the ACTIVE tab (what the user actually sees next to the panel), reading
 *  its rendered background luminance. Implementation-agnostic: it works no
 *  matter how the page marks dark mode, because it reads the painted pixel.
 *  Prefers the focused window's active tab; falls back to any loaded permitted
 *  tab. Nothing readable → leaves the value alone (panel keeps last / OS). */
async function detectSurroundingTheme(): Promise<void> {
  if (!chrome.scripting?.executeScript) return;
  try {
    // Prefer the active tab of the focused window — that's what's beside the
    // panel right now. Fall back to any loaded permitted tab.
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let tab: chrome.tabs.Tab | undefined;
    if (active[0]?.id && active[0].status === "complete" && (await _isThemeSource(active[0].url))) {
      tab = active[0];
    } else {
      const all = await chrome.tabs.query({ status: "complete" });
      for (const t of all) {
        if (t.id && (await _isThemeSource(t.url))) {
          tab = t;
          break;
        }
      }
    }
    if (!tab?.id) return;
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Walk up from body to the first element with a non-transparent
        // background, then judge its perceived luminance.
        let el: Element | null = document.body;
        let rgb = "";
        while (el) {
          const bg = getComputedStyle(el).backgroundColor;
          if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0)")) {
            rgb = bg;
            break;
          }
          el = el.parentElement;
        }
        const m = rgb.match(/\d+(\.\d+)?/g);
        if (!m || m.length < 3) {
          // Fall back to the page's declared color-scheme.
          return getComputedStyle(document.documentElement).colorScheme.includes("dark")
            ? "dark"
            : "light";
        }
        const [r = 255, g = 255, b = 255] = m.map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? "dark" : "light";
      },
    });
    const theme = res?.result === "dark" ? "dark" : res?.result === "light" ? "light" : undefined;
    if (theme) {
      const cfg = await loadConfig();
      if (cfg.claude_theme !== theme) await saveConfig({ claude_theme: theme });
    }
  } catch (e) {
    // Tab gone, permission lapsed, CSP — non-fatal; panel keeps its last theme.
    console.warn("claude theme detect failed", e);
  }
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

// A "UI sender" is one of THIS extension's own pages (popup / options page):
// it carries our extension id and has NO `sender.tab`. Content scripts always
// carry `sender.tab`; ordinary web pages can't reach chrome.runtime at all (no
// `externally_connectable`). Config-changing flows must be UI-only so an
// injected/compromised content script can never repoint the SkillNote URL or
// revoke the token.
function _isExtensionUiSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  return !!sender && sender.id === chrome.runtime.id && !sender.tab;
}

function _senderHostname(sender: chrome.runtime.MessageSender | undefined): string {
  try {
    return sender?.origin ? new URL(sender.origin).hostname : "";
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "skillnote.theme") {
    // Real-time theme push from a content script (claude.ai / paired app).
    // Accept only from a FOREGROUND tab so the panel reflects the page the
    // user is actually looking at next to it — a background tab flipping its
    // theme shouldn't change the panel. Persist only on change (the content
    // script already de-dups, but guard storage churn anyway).
    const theme = msg.theme === "dark" ? "dark" : msg.theme === "light" ? "light" : null;
    if (theme && _sender.tab?.active) {
      void loadConfig().then((cfg) => {
        if (cfg.claude_theme !== theme) void saveConfig({ claude_theme: theme });
      });
    }
    return false; // no response needed
  }
  if (msg?.type === "skillnote.sync-now") {
    // Defense-in-depth with content.ts (which already declines to relay on
    // claude.ai): never let a claude.ai content script drive a sync — only the
    // SkillNote web bridge or our own UI may. A claude.ai-origin sender is
    // rejected outright.
    if (_sender.tab && /(^|\.)claude\.(ai|com)$/i.test(_senderHostname(_sender))) {
      sendResponse({ ok: false, error: "forbidden" });
      return false;
    }
    // Visible in the service-worker console — confirms the web-bridge (or
    // popup) reached the worker and a sync is running.
    console.info("[SkillNote] sync-now received → reconcile + sync");
    void syncNow().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg?.type === "skillnote.ping") {
    // Lightweight liveness check (plugin → app), fired when the popup opens.
    void pingHealth().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "skillnote.start-pair") {
    // Privileged: accepts a caller-supplied URL and persists pairing state.
    // Only our own popup/options page may initiate pairing.
    if (!_isExtensionUiSender(_sender)) {
      sendResponse({ ok: false, error: "forbidden" });
      return false;
    }
    void startPairing(msg.skillnote_url, msg.browser_label)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "skillnote.disconnect") {
    // Privileged: revokes the bearer token + clears config. UI-only.
    if (!_isExtensionUiSender(_sender)) {
      sendResponse({ ok: false, error: "forbidden" });
      return false;
    }
    // Promise-chain with a catch — the async-IIFE form could throw before
    // sendResponse, leaving the caller's "Disconnecting…" spinner hung (or,
    // worse, options.ts treats an undefined response as success).
    void saveConfig({
      extension_token: undefined,
      pairing: undefined,
      recent_activity: [],
    })
      .then(() => chrome.alarms.clear(ALARM_PAIR_POLL))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
