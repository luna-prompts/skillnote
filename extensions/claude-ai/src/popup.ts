// Popup — the extension's at-a-glance status panel.
//
// All state *decisions* live in lib/view.ts (pure, unit-tested). This file
// owns markup + interaction only: copy-to-clipboard, the live pairing
// countdown, and the message bridge to the background worker.

import { buildClient } from "./lib/skillnote-client";
import { loadConfig, saveConfig } from "./lib/storage";
import type { ActivityEntry, ExtensionConfig } from "./lib/types";
import {
  activityMeta,
  defaultBrowserLabel,
  deriveConnectionState,
  formatCountdown,
  formatRelativeTime,
  hostOf,
  normalizeSkillnoteUrl,
  statusMeta,
} from "./lib/view";

const CLAUDE_LOGIN_URL = "https://claude.ai/login";

// Theme applied BEFORE first paint to kill the open-flash. Extension-page CSP
// (`script-src 'self'`) forbids an inline <head> script, so we do it at the
// very top of this module from a synchronous localStorage mirror (written by
// applyTheme each render). Falls back to the OS preference on first-ever open.
// render() later refines it from the freshly-detected claude.ai theme.
const THEME_KEY = "skillnote:theme";
(() => {
  try {
    const cached = localStorage.getItem(THEME_KEY);
    const osDark =
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = cached ?? (osDark ? "dark" : "light");
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();

const pill = document.getElementById("status-pill")!;
const content = document.getElementById("content")!;

// Single live timer for the pairing countdown — cleared before every render
// so stale intervals never write into a replaced DOM.
let countdownTimer: ReturnType<typeof setInterval> | null = null;
function clearCountdown(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// Removes the Settings-view Escape listener so it can't outlive its view (a
// background re-render rebuilds the DOM but document-level listeners persist).
// MUST be declared before the first render() call below: render() invokes it
// before its first await, so a later `let` would hit the temporal dead zone
// on the module-load paint.
let settingsKeyTeardown: (() => void) | null = null;

// Re-render whenever the background updates stored config (pairing approved,
// sync finished, session lost) so the popup is live without a manual reopen.
// Scope to the "skillnote" config key (matches storage.ts KEY) so unrelated
// writes — e.g. the usage-dedup ring — don't trigger spurious re-renders.
// Writes that ONLY touch setup_draft are ignored: the setup form persists its
// draft as you type, and re-rendering on that write would rebuild the form
// under the user's cursor (focus stolen, input clobbered).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.skillnote) return;
  // Apply the theme on EVERY change, always — it's just a `data-theme`
  // attribute on <html> (non-destructive, no DOM rebuild), so it lands in real
  // time even while the setup URL input is focused. This is the path that makes
  // toggling claude.ai's light/dark reflect instantly in the panel.
  const next = changes.skillnote.newValue as ExtensionConfig | undefined;
  if (next) applyTheme(next);
  // The FULL re-render is what rebuilds the DOM, so defer it while someone is
  // typing in the setup form (it would clobber the half-typed URL + steal
  // focus). The next user action re-renders normally.
  if (isTypingInForm()) return;
  const strip = (v: unknown) =>
    JSON.stringify({ ...((v ?? {}) as Record<string, unknown>), setup_draft: null });
  if (strip(changes.skillnote.oldValue) === strip(changes.skillnote.newValue)) return;
  void render();
});

/** True when focus is in a text input/textarea — used to defer re-renders so
 *  a background storage write never yanks the DOM out from under typing. */
function isTypingInForm(): boolean {
  const a = document.activeElement;
  return (
    a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement
  );
}

void render();

// Live connection + theme check the moment the panel opens, and again whenever
// it regains focus. The side panel stays open beside claude.ai, so this is the
// path that catches an in-place claude.ai theme toggle: flip dark in claude.ai,
// click back into the panel → it re-samples and matches near-instantly. The
// worker writes results to storage, which re-renders.
const ping = () => void chrome.runtime.sendMessage({ type: "skillnote.ping" }).catch(() => {});
ping();
window.addEventListener("focus", ping);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") ping();
});

// In-popup navigation: Overview | Activity tabs + a gear-opened Settings
// view — everything inside the popup, never a new tab. Resets to home
// whenever the connection state leaves "connected".
let view: "home" | "activity" | "settings" = "home";

// What's currently syncing — READ-ONLY here. The panel is a status surface
// (a tunnel into SkillNote): choosing WHAT syncs happens in the SkillNote app
// (per-collection Sync toggle), which scales to any registry size and keeps
// one source of control. The panel just shows the live picture.
type CollectionRow = { name: string; count: number; published_to_claude_ai: boolean };
let colState: {
  enabled: CollectionRow[]; // collections currently published to claude.ai
  error: boolean;
} | null = null;
// claude.ai usage rollup (this week) — the panel's proof-of-value insight.
// null = not fetched yet (skeleton).
type Usage = { total_calls: number; unique_skills: number; calls_today: number; most_called: string | null };
let usageState: Usage | null = null;

// Freshness guards so the read-only data isn't re-fetched on EVERY render — a
// background poll or an Overview↔Activity tab toggle shouldn't hammer the
// backend with data that's seconds old. We refetch only when stale.
const DATA_TTL_MS = 20_000;
let lastColFetch = 0;
let lastUsageFetch = 0;
// The connection this cached data belongs to. If the user disconnects and
// re-pairs (possibly to a DIFFERENT SkillNote server), stale collections/usage
// from the old one must not flash into the new panel.
let cachedForUrl: string | undefined;

/** Drop all cached connection data — called when the paired URL changes. */
function resetConnectionData(): void {
  colState = null;
  usageState = null;
  lastColFetch = 0;
  lastUsageFetch = 0;
  lastScreen = null;
  syncKick = 0;
}

/** Match claude.ai's appearance. The background samples claude.ai's actual
 *  theme into cfg.claude_theme; if it hasn't yet (no claude.ai tab open),
 *  fall back to the OS preference so we're never stuck on the wrong one. */
function applyTheme(cfg: ExtensionConfig): void {
  // Match the sampled surrounding-tab theme whenever we have one — even during
  // setup. The content script keeps `claude_theme` fresh in real time from the
  // active claude.ai / SkillNote tab, so it's the page you're looking at, not a
  // stale value. Fall back to the OS preference only when nothing's been
  // sampled yet (no claude.ai/app tab open).
  const theme = cfg.claude_theme ?? prefersDark();
  document.documentElement.dataset.theme = theme;
  // Mirror to localStorage so the next open paints the right theme instantly
  // (before config loads) — see the pre-paint block at module top.
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / blocked — flash-prevention is best-effort */
  }
}

/** OS preference, guarded — matchMedia is absent in the jsdom test env. */
function prefersDark(): "dark" | "light" {
  try {
    return typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}
// Optimistic feedback: stamped when the user hits Sync now so the "Syncing…"
// banner shows IMMEDIATELY — the real pending counter takes a second or two
// to land via storage, and that gap read as "nothing happened".
let syncKick = 0;
let syncKickTimer: ReturnType<typeof setTimeout> | null = null;

// The screen currently painted (state + tab). Used to tell a real screen
// CHANGE (tab switch, connection flip) apart from a background poll re-render
// of the same screen — so the fade only plays on the former.
let lastScreen: string | null = null;

export async function render(): Promise<void> {
  clearCountdown();
  settingsKeyTeardown?.();
  settingsKeyTeardown = null;
  const cfg = await loadConfig();
  applyTheme(cfg);
  // Re-pair to a different server (or disconnect) → drop the previous
  // connection's cached collections/usage so they never bleed across.
  if (cfg.skillnote_url !== cachedForUrl) {
    resetConnectionData();
    cachedForUrl = cfg.skillnote_url;
  }
  const state = deriveConnectionState(cfg);
  const meta = statusMeta(state);
  pill.className = `pill ${meta.tone}`;
  pill.textContent = meta.label;

  if (state !== "connected") view = "home";
  const screen = `${state}:${view}`;
  const screenChanged = screen !== lastScreen;
  lastScreen = screen;

  // A side panel stays OPEN while you work, so it re-renders on every ~60s
  // background poll. Two things must stay invisible across those re-renders or
  // it stops feeling native:
  //  1) Fade only on a real screen change — not every poll (else it flickers).
  //  2) Preserve scroll — the full innerHTML rebuild would otherwise yank the
  //     list back to the top mid-read.
  const prevScroll = content.scrollTop;
  const prevColScroll = document.getElementById("col-list")?.scrollTop ?? 0;

  if (screenChanged) {
    content.classList.remove("fade");
    void content.offsetWidth;
    content.classList.add("fade");
  }

  switch (state) {
    case "setup":
      renderSetup();
      break;
    case "pairing":
      renderPairing(cfg);
      break;
    case "needs_signin":
      renderNeedsSignin(cfg);
      break;
    case "error":
      renderError(cfg);
      break;
    case "connected":
      if (view === "settings") renderSettings(cfg);
      else if (view === "activity") renderActivityView(cfg);
      else renderConnected(cfg);
      break;
  }

  // Restore scroll on a same-screen poll re-render (a real screen change
  // correctly starts at the top).
  if (!screenChanged) {
    content.scrollTop = prevScroll;
    const col = document.getElementById("col-list");
    if (col) col.scrollTop = prevColScroll;
  }
}

/** Overview | Activity tab bar (shared by both tab views). */
function tabsHtml(active: "home" | "activity", activityCount: number): string {
  return `<div class="tabs" role="tablist">
    <button class="tab${active === "home" ? " active" : ""}" id="tab-home" role="tab" aria-selected="${active === "home"}">Overview</button>
    <button class="tab${active === "activity" ? " active" : ""}" id="tab-activity" role="tab" aria-selected="${active === "activity"}">Activity${activityCount > 0 ? `<span class="n">${activityCount}</span>` : ""}</button>
  </div>`;
}

function wireTabs(): void {
  const go = (v: "home" | "activity") => {
    view = v;
    void render();
  };
  onClick("tab-home", () => go("home"));
  onClick("tab-activity", () => go("activity"));
  // Arrow-key navigation between tabs — the expected native tab behavior.
  const tabs = [document.getElementById("tab-home"), document.getElementById("tab-activity")];
  tabs.forEach((t, i) => {
    t?.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        go(i === 0 ? "activity" : "home");
        // Move focus onto the now-active tab after the re-render.
        setTimeout(() => document.getElementById(i === 0 ? "tab-activity" : "tab-home")?.focus(), 0);
      }
    });
  });
}

// ── States ──────────────────────────────────────────────────────────────────

// Inline pairing form — the whole connect flow happens right here in the
// popup (pair code shows here too). Bouncing users to a full options tab for
// two fields was confusing; the options page still exists for settings.
function renderSetup(): void {
  content.innerHTML = `
    <div class="form">
      <h2>Connect SkillNote</h2>
      <p class="lede">Link this browser to sync skills to your claude.ai account.</p>
      <div class="field">
        <label for="url">SkillNote URL</label>
        <input id="url" type="url" placeholder="http://localhost:3000" autocomplete="off" spellcheck="false" />
        <div class="hint">The address you open SkillNote at in your browser.</div>
      </div>
      <div class="field">
        <label for="label">Browser label</label>
        <input id="label" type="text" autocomplete="off" />
      </div>
      <p class="err-text" id="error" role="alert"></p>
      <div class="actions" style="margin-top:6px">
        <button class="btn btn-primary" id="pair">${ICON.plug}Connect</button>
      </div>
      <p class="perm-note">${ICON.shield}<span>Chrome will ask permission to reach this address — that's how the extension talks to your SkillNote. It only ever connects to the URL above.</span></p>
    </div>
  `;

  const urlInput = document.getElementById("url") as HTMLInputElement;
  const labelInput = document.getElementById("label") as HTMLInputElement;
  const err = document.getElementById("error")!;
  const pairBtn = document.getElementById("pair") as HTMLButtonElement;

  // Restore the draft — the host-permission prompt can close the popup
  // mid-flow, and retyping the URL would be exactly the confusion we're
  // removing. loadConfig resolves async, so never overwrite text the user
  // has already typed in the meantime. Falls back to a sensible label.
  labelInput.value = defaultBrowserLabel(navigator.userAgent);
  void loadConfig().then((cfg) => {
    // A re-render (or the panel closing) may have replaced this form while
    // loadConfig was in flight — don't write into detached inputs.
    if (!urlInput.isConnected || !labelInput.isConnected) return;
    if (!urlInput.value && cfg.setup_draft?.url) urlInput.value = cfg.setup_draft.url;
    if (cfg.setup_draft?.label && labelInput.value === defaultBrowserLabel(navigator.userAgent)) {
      labelInput.value = cfg.setup_draft.label;
    }
  });
  urlInput.focus();

  const persistDraft = () => {
    void saveConfig({ setup_draft: { url: urlInput.value, label: labelInput.value } });
  };
  urlInput.addEventListener("change", persistDraft);
  labelInput.addEventListener("change", persistDraft);
  urlInput.addEventListener("input", () => {
    err.textContent = "";
    urlInput.setAttribute("aria-invalid", "false");
  });
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pairBtn.click();
  });
  labelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pairBtn.click();
  });

  pairBtn.addEventListener("click", async () => {
    err.textContent = "";
    const url = normalizeSkillnoteUrl(urlInput.value);
    const label = labelInput.value.trim() || defaultBrowserLabel(navigator.userAgent);
    if (!url) {
      err.textContent = "Enter a valid http(s) SkillNote URL.";
      urlInput.setAttribute("aria-invalid", "true");
      urlInput.focus();
      return;
    }
    persistDraft();

    // Host permission for this origin (optional_host_permissions). Must run
    // in this click's user gesture. If Chrome's prompt closes the popup, the
    // draft restores on reopen and a second Connect resolves instantly.
    let granted = true;
    try {
      const origin = new URL(url).origin + "/*";
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch (e) {
      err.textContent = `Couldn't request permission: ${(e as Error).message}`;
      return;
    }
    if (!granted) {
      err.textContent = "Permission denied — sync needs access to reach SkillNote.";
      return;
    }

    pairBtn.disabled = true;
    pairBtn.innerHTML = `<span class="ico spin">${ICON.refresh}</span>Connecting…`;
    const res = await chrome.runtime.sendMessage({
      type: "skillnote.start-pair",
      skillnote_url: url,
      browser_label: label,
    });
    if (!res?.ok) {
      err.textContent = res?.error ?? "Pairing failed — check the URL and that SkillNote is running.";
      pairBtn.disabled = false;
      pairBtn.innerHTML = `${ICON.plug}Connect`;
      return;
    }
    // Pairing started — clear the draft; the storage listener re-renders
    // this popup straight into the approval-code view.
    void saveConfig({ setup_draft: undefined });
  });
}

function renderPairing(cfg: ExtensionConfig): void {
  const code = cfg.pairing?.pairing_code ?? "------";
  // No "Open SkillNote" deep link here — SkillNote's notification bell pops
  // the approval automatically, so the instruction is simply "go approve it
  // there". A second tab opened from here just confused people.
  content.innerHTML = `
    <div class="cta">
      <div class="icon info">${ICON.plug}</div>
      <h2>Approve this browser</h2>
      <p>Almost there — confirm the code in SkillNote to finish connecting.</p>
      <ol class="steps" style="text-align:left">
        <li>Open <strong>SkillNote</strong> in another tab</li>
        <li>Click the <strong>bell</strong> (top right) — the request is waiting</li>
        <li><strong>Approve</strong> if the code matches the one below</li>
      </ol>
    </div>
    <div class="code-wrap">
      <div class="code-box">
        <div class="code" id="code" aria-label="Pairing code ${escapeHtml(spell(code))}">${escapeHtml(code)}</div>
        <button class="copy" id="copy" title="Copy code" aria-label="Copy pairing code">${ICON.copy}</button>
      </div>
      <div class="countdown" id="countdown"></div>
    </div>
    <div class="actions" style="margin-top:14px">
      <button class="btn" id="cancel">Cancel</button>
    </div>
  `;
  wireCopy("copy", code);
  onClick("cancel", async () => {
    await chrome.runtime.sendMessage({ type: "skillnote.disconnect" });
  });
  startCountdown(cfg.pairing?.expires_at);
}

function renderNeedsSignin(cfg: ExtensionConfig): void {
  content.innerHTML = `
    <div class="cta">
      <div class="icon warn">${ICON.user}</div>
      <h2>Sign in to claude.ai</h2>
      <p>You're connected to ${escapeHtml(hostOf(cfg.skillnote_url))}. Sync resumes automatically once you're signed in to claude.ai.</p>
    </div>
    <div class="actions">
      <a href="${CLAUDE_LOGIN_URL}" target="_blank" rel="noopener" style="flex:1; text-decoration:none">
        <button class="btn btn-primary" style="width:100%">${ICON.external}Open claude.ai</button>
      </a>
    </div>
    ${settingsLink()}
  `;
  wireSettingsLink();
}

function renderError(cfg: ExtensionConfig): void {
  content.innerHTML = `
    <div class="cta">
      <div class="icon err">${ICON.alert}</div>
      <h2>Sync hit a snag</h2>
      <p>${escapeHtml(cfg.last_error ?? "Something went wrong during the last sync.")}</p>
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="retry">${ICON.refresh}Try again</button>
      <button class="btn" id="open-options">Settings</button>
    </div>
  `;
  onClick("open-options", () => chrome.runtime.openOptionsPage());
  wireSyncNow("retry", "Retrying…");
}

function renderConnected(cfg: ExtensionConfig): void {
  const pending = cfg.pending_op_count ?? 0;
  const failed = cfg.failed_op_count ?? 0;
  const lastSync = formatRelativeTime(cfg.last_sync_at);
  const enabledCount = colState && !colState.error ? colState.enabled.length : null;

  // Operational status only surfaces when it MATTERS — silence means healthy.
  // (No more two-always-zero cards posing as the dashboard.)
  let statusBanner = "";
  if (pending > 0) {
    statusBanner = `<div class="syncing"><span class="ico spin">${ICON.refresh}</span>Syncing ${pending} change${pending === 1 ? "" : "s"} to claude.ai…</div>`;
  } else if (Date.now() - syncKick < 6000) {
    statusBanner = `<div class="syncing"><span class="ico spin">${ICON.refresh}</span>Syncing to claude.ai…</div>`;
  } else if (failed > 0) {
    statusBanner = `<div class="status-bad"><span class="ico">${ICON.alert}</span>${failed} sync${failed === 1 ? "" : "s"} failed — open Activity for details.</div>`;
  }

  content.innerHTML = `
    ${tabsHtml("home", (cfg.recent_activity ?? []).length)}
    ${statusBanner}

    ${usageHtml()}

    <div class="section-head">
      <span class="t">Live on claude.ai</span>
      ${enabledCount !== null && enabledCount > 0 ? `<span class="m">${enabledCount} collection${enabledCount === 1 ? "" : "s"}</span>` : ""}
    </div>
    <div class="collections" id="collections">
      ${syncedListHtml(cfg)}
    </div>

    <div class="actionbar">
      <div class="foot">
        <span class="meta">Synced ${escapeHtml(lastSync)}</span>
        <button class="linkbtn" id="sync-now" title="Sync now">${ICON.refresh}<span>Refresh</span></button>
        <span class="sep">·</span>
        <a href="${escapeHtml(dashboardUrl(cfg.skillnote_url))}" target="_blank" rel="noopener">Dashboard</a>
        <span class="grow-sep"></span>
        <button class="btn-icon-sm" id="open-settings" title="Settings" aria-label="Settings">${ICON.gear}</button>
      </div>
    </div>
  `;
  wireTabs();
  onClick("open-settings", () => {
    view = "settings";
    void render();
  });
  wireSyncNow("sync-now", "Syncing…");
  void refreshCollections(cfg);
  void refreshUsage(cfg);
}

/** The proof-of-value hero: how much your synced skills got used on claude.ai
 *  this week. null = loading (skeleton); zeroed = a motivating empty state. */
function usageHtml(): string {
  if (usageState === null) {
    return `<div class="usage-card" aria-busy="true">
      <div class="usage-eyebrow">This week on claude.ai</div>
      <div class="usage-main"><span class="sk usage-sk-n"></span><span class="sk usage-sk-l"></span></div>
    </div>`;
  }
  const { total_calls, unique_skills, calls_today, most_called } = usageState;
  if (total_calls === 0) {
    return `<div class="usage-card">
      <div class="usage-eyebrow">This week on claude.ai</div>
      <div class="usage-zero">
        <span class="zn">0</span>
        <span class="zt">skill uses yet</span>
      </div>
      <div class="usage-hint">Your skills will show activity here once your assistant invokes one on claude.ai.</div>
    </div>`;
  }
  return `<div class="usage-card">
    <div class="usage-eyebrow">This week on claude.ai</div>
    <div class="usage-main">
      <span class="usage-n">${total_calls.toLocaleString()}</span>
      <span class="usage-l">skill use${total_calls === 1 ? "" : "s"}</span>
    </div>
    <div class="usage-sub">
      <span><strong>${unique_skills}</strong> skill${unique_skills === 1 ? "" : "s"} used</span>
      <span class="dot-sep">·</span>
      <span><strong>${calls_today}</strong> today</span>
    </div>
    ${most_called ? `<div class="usage-top"><span class="fic">${ICON.trendingUp}</span>Most used <strong>${escapeHtml(most_called)}</strong></div>` : ""}
  </div>`;
}

/** Fetch the claude.ai usage rollup; repaint only on change. Best-effort —
 *  a usage hiccup must never break the panel. */
async function refreshUsage(cfg: ExtensionConfig): Promise<void> {
  if (!cfg.skillnote_url) return;
  // Skip if fetched recently — tab switches & 60s polls re-render the home
  // view but the data is still warm; no need to re-hit the backend.
  if (usageState !== null && Date.now() - lastUsageFetch < DATA_TTL_MS) return;
  try {
    const client = buildClient(cfg.skillnote_url, cfg.extension_token);
    const u = await client.fetchUsage(7);
    lastUsageFetch = Date.now();
    const changed = JSON.stringify(u) !== JSON.stringify(usageState);
    usageState = u;
    if (changed && view === "home") void render();
  } catch {
    // Leave a zeroed view rather than a spinner stuck forever.
    if (usageState === null) {
      usageState = { total_calls: 0, unique_skills: 0, calls_today: 0, most_called: null };
      if (view === "home") void render();
    }
  }
}

// ── Activity (its own tab — the feed, not squeezed under the picker) ────────

function renderActivityView(cfg: ExtensionConfig): void {
  const entries = cfg.recent_activity ?? [];
  content.innerHTML = `
    ${tabsHtml("activity", entries.length)}
    <div class="section-head">
      <span class="t">Recent activity</span>
      <span class="m">last ${Math.min(entries.length, 10) || 0} events</span>
    </div>
    <div class="activity-card">
      ${
        entries.length === 0
          ? `<div class="empty-state">
               <div class="eico">${ICON.refresh}</div>
               <div class="et">No activity yet</div>
               <div class="es">Syncs, imports, and errors will show up here.</div>
             </div>`
          : renderActivity(entries, 10)
      }
    </div>
    <div class="actionbar">
      <div class="foot" style="margin-top:0">
        <a href="${escapeHtml(notificationsUrl(cfg.skillnote_url))}" target="_blank" rel="noopener">Full history in SkillNote ${ICON.arrowUpRight}</a>
      </div>
    </div>
  `;
  wireTabs();
}

/** Deep-link to the SkillNote notifications page (the full activity history). */
function notificationsUrl(skillnoteUrl: string | undefined): string {
  const base = (skillnoteUrl ?? "").replace(/\/+$/, "");
  return `${base}/notifications`;
}

// ── Synced collections (read-only status — control lives in SkillNote) ──────

/** Read-only list of the collections currently synced to claude.ai.
 *  Choosing what syncs happens in the SkillNote app — the "Manage" row links
 *  straight there. This stays bounded at any registry size (it only ever
 *  shows the enabled set, capped server-side). */
function syncedListHtml(cfg: ExtensionConfig): string {
  if (colState === null) {
    // Shimmer skeletons — a loading surface, not a bare sentence.
    const sk = `<div class="sk-row"><span class="sk sk-ic"></span><span class="sk sk-nm"></span><span class="sk sk-ct"></span></div>`;
    return `<div aria-busy="true" aria-label="Loading synced collections">${sk}${sk}</div>`;
  }
  if (colState.error) {
    return `<div class="col-empty">Couldn't load — is SkillNote running?</div>`;
  }
  const manageRow = `<a class="manage-row" href="${escapeHtml(collectionsUrl(cfg.skillnote_url))}" target="_blank" rel="noopener">Manage in SkillNote ${ICON.arrowUpRight}</a>`;
  if (colState.enabled.length === 0) {
    return `<div class="empty-state">
        <div class="eico">${ICON.folder}</div>
        <div class="et">Nothing synced yet</div>
        <div class="es">Pick collections to sync from SkillNote.</div>
      </div>${manageRow}`;
  }
  const rows = colState.enabled
    .map(
      (r) => `<div class="col-row">
        <span class="fic">${ICON.folder}</span>
        <span class="nm" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        <span class="live-dot" title="Live on claude.ai"></span>
        <span class="ct">${r.count} skill${r.count === 1 ? "" : "s"}</span>
      </div>`,
    )
    .join("");
  return `<div id="col-list">${rows}</div>${manageRow}`;
}

/** Deep-link to SkillNote's collections page — where sync is controlled. */
function collectionsUrl(skillnoteUrl: string | undefined): string {
  const base = (skillnoteUrl ?? "").replace(/\/+$/, "");
  return `${base}/collections`;
}

/** Refresh the enabled set (bounded: published only, capped at 100).
 *  Re-renders only when the data actually changed. */
async function refreshCollections(cfg: ExtensionConfig): Promise<void> {
  if (!cfg.skillnote_url) return;
  // Skip if warm (see refreshUsage) — but always retry after an error.
  if (colState !== null && !colState.error && Date.now() - lastColFetch < DATA_TTL_MS) return;
  try {
    const client = buildClient(cfg.skillnote_url, cfg.extension_token);
    const { rows } = await client.listCollections({ published: true, limit: 100 });
    lastColFetch = Date.now();
    const changed = !colState || colState.error || JSON.stringify(colState.enabled) !== JSON.stringify(rows);
    colState = { enabled: rows, error: false };
    if (changed && view === "home") void render();
  } catch {
    if (colState === null) {
      colState = { enabled: [], error: true };
      if (view === "home") void render();
    }
  }
}

/** Tiny transient notice at the bottom of the panel (no alert()). */
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove(); // one at a time
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    el.remove();
  }, 3000);
}

// ── Settings (in-popup view — the gear must never open a tab) ───────────────

function renderSettings(cfg: ExtensionConfig): void {
  const appOk = cfg.skillnote_reachable !== false;
  const claudeOk = cfg.claude_session_active !== false;
  const lastSync = cfg.last_sync_at ? formatRelativeTime(cfg.last_sync_at) : "never";
  const host = hostOf(cfg.skillnote_url);

  content.innerHTML = `
    <div class="view-head">
      <button class="back" id="back" aria-label="Back">${ICON.chevronLeft}</button>
      <h2>Settings</h2>
    </div>
    <div class="card">
      <div class="crow">
        <span class="k">SkillNote app</span>
        <span class="v" title="${escapeHtml(cfg.skillnote_url ?? "")}"><span class="dot ${appOk ? "ok" : "err"}"></span>${appOk ? escapeHtml(host) : "Unreachable"}</span>
      </div>
      <div class="crow">
        <span class="k">claude.ai</span>
        <span class="v"><span class="dot ${claudeOk ? "ok" : "warn"}"></span>${claudeOk ? "Signed in" : "Signed out"}</span>
      </div>
      <div class="crow">
        <span class="k">This browser</span>
        <span class="v plain">${escapeHtml(cfg.browser_label ?? "(unnamed)")}</span>
      </div>
      <div class="crow">
        <span class="k">Last synced</span>
        <span class="v plain">${escapeHtml(lastSync)}</span>
      </div>
      <div class="crow">
        <span class="k">Extension</span>
        <span class="v plain">v${escapeHtml(chrome.runtime.getManifest?.().version ?? "dev")}</span>
      </div>
    </div>
    <div class="actionbar">
      <div class="actions" id="settings-actions">
        <button class="btn btn-danger" id="disconnect">Disconnect this browser</button>
      </div>
      <div class="foot">
        <span class="meta">Skills sync automatically every minute.</span>
      </div>
    </div>
  `;
  const leaveSettings = () => {
    view = "home";
    void render();
    // Restore focus to the gear that opened Settings (native back behavior).
    setTimeout(() => document.getElementById("open-settings")?.focus(), 0);
  };
  onClick("back", leaveSettings);
  // Escape exits the Settings sub-view — but not while the disconnect confirm
  // is showing (there it should cancel that first; handled in its own slot).
  const onSettingsKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !document.getElementById("confirm-disconnect")) {
      document.removeEventListener("keydown", onSettingsKey);
      leaveSettings();
    }
  };
  document.addEventListener("keydown", onSettingsKey);
  // Tear the listener down on the next render so it can't outlive this view.
  settingsKeyTeardown = () => document.removeEventListener("keydown", onSettingsKey);
  // Move focus into the view for immediate keyboard control.
  setTimeout(() => document.getElementById("back")?.focus(), 0);
  // Inline two-step confirm — destructive action, but no jarring dialogs.
  onClick("disconnect", () => {
    const slot = document.getElementById("settings-actions")!;
    slot.innerHTML = `
      <button class="btn btn-danger" id="confirm-disconnect">Yes, disconnect</button>
      <button class="btn" id="keep">Keep connected</button>
    `;
    onClick("keep", () => {
      view = "settings";
      void render();
    });
    onClick("confirm-disconnect", async () => {
      const btn = document.getElementById("confirm-disconnect") as HTMLButtonElement;
      btn.disabled = true;
      btn.innerHTML = `<span class="ico spin">${ICON.refresh}</span>Disconnecting…`;
      const res = await chrome.runtime
        .sendMessage({ type: "skillnote.disconnect" })
        .catch(() => ({ ok: false }));
      if (!res?.ok) {
        btn.disabled = false;
        btn.textContent = "Yes, disconnect";
        toast("Couldn't disconnect — try again.");
        return;
      }
      // Storage change flips the popup to setup; render() resets the view.
    });
  });
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

// Monochrome line icon per activity kind — quiet by default; only error rows
// take color. Matches the SkillNote app's lucide icon set.
const ACT_ICON: Record<ActivityEntry["kind"], string> = {
  push: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`,
  pull: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  used: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

function renderActivity(entries: ActivityEntry[], max = 6): string {
  if (entries.length === 0) {
    return `<div class="empty-act">No activity yet — sync to get started.</div>`;
  }
  return entries
    .slice()
    .reverse()
    .slice(0, max)
    .map((e) => {
      const m = activityMeta(e.kind);
      const icon = ACT_ICON[e.kind] ?? ACT_ICON.push;
      return `<div class="act ${e.kind === "error" ? "error" : ""}">
        <span class="chip" role="img" aria-label="${escapeHtml(m.label)}">${icon}</span>
        <span class="msg">${escapeHtml(e.message)}</span>
        <span class="ts">${escapeHtml(formatRelativeTime(e.ts))}</span>
      </div>`;
    })
    .join("");
}

function settingsLink(): string {
  return `<div class="link-row"><a href="#" id="settings-link">Extension settings</a></div>`;
}
function wireSettingsLink(): void {
  const el = document.getElementById("settings-link");
  el?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

// ── Interactions ──────────────────────────────────────────────────────────────

function onClick(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener("click", () => handler());
}

function wireSyncNow(id: string, busyLabel: string): void {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) return;
  const original = btn.innerHTML;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="ico spin">${ICON.refresh}</span>${escapeHtml(busyLabel)}`;
    // Optimistic banner: show "Syncing…" immediately on the next paint —
    // the real pending counter takes a beat to land via storage. Track the
    // timer so repeated clicks / re-renders don't queue stale render calls.
    syncKick = Date.now();
    if (syncKickTimer !== null) clearTimeout(syncKickTimer);
    syncKickTimer = setTimeout(() => {
      syncKickTimer = null;
      if (view === "home") void render();
    }, 6200);
    try {
      await chrome.runtime.sendMessage({ type: "skillnote.sync-now" });
    } catch {
      /* surfaced via re-render */
    }
    // storage.onChanged re-render will repaint; restore as a fallback.
    btn.innerHTML = original;
    btn.disabled = false;
    void render();
  });
}

function wireCopy(id: string, code: string): void {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      btn.classList.add("copied");
      btn.innerHTML = ICON.check;
      setTimeout(() => {
        // A re-render may have replaced the DOM while we waited — don't
        // mutate a detached node.
        if (!btn.isConnected) return;
        btn.classList.remove("copied");
        btn.innerHTML = ICON.copy;
      }, 1400);
    } catch {
      /* clipboard blocked — the code is still visible to read */
    }
  });
}

function startCountdown(expiresAt: string | undefined): void {
  const el = document.getElementById("countdown");
  if (!el || !expiresAt) return;
  const paint = () => {
    const c = formatCountdown(expiresAt);
    el.className = `countdown${c.urgent ? " urgent" : ""}${c.expired ? " expired" : ""}`;
    el.innerHTML = c.expired
      ? "Code expired — cancel and reconnect."
      : `Expires in <span class="t">${escapeHtml(c.text)}</span>`;
    if (c.expired) clearCountdown();
  };
  paint();
  countdownTimer = setInterval(paint, 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Space out a code so screen readers read it character-by-character. */
function spell(code: string): string {
  return code.split("").join(" ");
}

/** Deep-link to the user's own SkillNote claude.ai connector dashboard. */
function dashboardUrl(skillnoteUrl: string | undefined): string {
  const base = (skillnoteUrl ?? "").replace(/\/+$/, "");
  return `${base}/settings/integrations/claude-ai`;
}

// ── Inline icons (stroke-based, currentColor) ───────────────────────────────
const ICON = {
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  refresh: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  external: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  gear: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  arrowUpRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
  trendingUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/></svg>`,
};
