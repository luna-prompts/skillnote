// Popup — the extension's at-a-glance status panel.
//
// All state *decisions* live in lib/view.ts (pure, unit-tested). This file
// owns markup + interaction only: copy-to-clipboard, the live pairing
// countdown, and the message bridge to the background worker.

import { loadConfig } from "./lib/storage";
import type { ActivityEntry, ExtensionConfig } from "./lib/types";
import {
  activityMeta,
  deriveConnectionState,
  formatCountdown,
  formatRelativeTime,
  hostOf,
  statusMeta,
} from "./lib/view";

const CLAUDE_LOGIN_URL = "https://claude.ai/login";
const CLAUDE_APP_URL = "https://claude.ai/new";

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

// Re-render whenever the background updates stored config (pairing approved,
// sync finished, session lost) so the popup is live without a manual reopen.
// Scope to the "skillnote" config key (matches storage.ts KEY) so unrelated
// writes — e.g. the usage-dedup ring — don't trigger spurious re-renders.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.skillnote) void render();
});

void render();

export async function render(): Promise<void> {
  clearCountdown();
  const cfg = await loadConfig();
  const state = deriveConnectionState(cfg);
  const meta = statusMeta(state);
  pill.className = `pill ${meta.tone}`;
  pill.textContent = meta.label;

  switch (state) {
    case "setup":
      return renderSetup();
    case "pairing":
      return renderPairing(cfg);
    case "needs_signin":
      return renderNeedsSignin(cfg);
    case "error":
      return renderError(cfg);
    case "connected":
      return renderConnected(cfg);
  }
}

// ── States ──────────────────────────────────────────────────────────────────

function renderSetup(): void {
  content.innerHTML = `
    <div class="cta">
      <div class="icon info">${ICON.plug}</div>
      <h2>Connect SkillNote</h2>
      <p>Link this browser to your self-hosted SkillNote to sync skills to your claude.ai account.</p>
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="open-options">Get started</button>
    </div>
  `;
  onClick("open-options", () => chrome.runtime.openOptionsPage());
}

function renderPairing(cfg: ExtensionConfig): void {
  const code = cfg.pairing?.pairing_code ?? "------";
  // Only allow http(s) redemption URLs. The value comes from the backend
  // pairing response and is rendered into an <a href>; a javascript:/data:
  // scheme would execute in this extension page (which holds the token).
  // escapeHtml guards attribute breakout but NOT the URL scheme.
  const rawUrl = cfg.pairing?.redemption_url ?? "#";
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "#";
  content.innerHTML = `
    <div class="cta" style="padding-bottom:0">
      <h2>Approve this browser</h2>
      <p>Open SkillNote and confirm the code below to finish connecting.</p>
    </div>
    <div class="code-wrap">
      <div class="code-box">
        <div class="code" id="code" aria-label="Pairing code ${escapeHtml(spell(code))}">${escapeHtml(code)}</div>
        <button class="copy" id="copy" title="Copy code" aria-label="Copy pairing code">${ICON.copy}</button>
      </div>
      <div class="countdown" id="countdown"></div>
    </div>
    <div class="actions">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="flex:1; text-decoration:none">
        <button class="btn btn-primary" style="width:100%">${ICON.external}Open SkillNote to approve</button>
      </a>
    </div>
    <div class="actions" style="margin-top:8px">
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
  const host = hostOf(cfg.skillnote_url);
  const lastSync = formatRelativeTime(cfg.last_sync_at);
  const pending = cfg.pending_op_count ?? 0;
  const failed = cfg.failed_op_count ?? 0;
  const linked = cfg.linked_skill_count ?? 0;

  content.innerHTML = `
    <div class="rows">
      <div class="row"><span class="label">SkillNote</span><span class="value" title="${escapeHtml(cfg.skillnote_url ?? "")}">${escapeHtml(host)}</span></div>
      <div class="row"><span class="label">Last sync</span><span class="value">${escapeHtml(lastSync)}</span></div>
    </div>

    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="n">${linked}</div><div class="k">Skills synced</div></div>
      <div class="stat"><div class="n">${pending}</div><div class="k">Queued</div></div>
      <div class="stat"><div class="n${failed > 0 ? " err" : ""}">${failed}</div><div class="k">Failed</div></div>
    </div>

    <div class="section-label">Recent activity</div>
    <div class="activity-list">
      ${renderActivity(cfg.recent_activity ?? [])}
    </div>

    <div class="actions">
      <button class="btn" id="sync-now">${ICON.refresh}Sync now</button>
      <button class="btn btn-sm" id="open-options" title="Settings" aria-label="Settings">${ICON.gear}</button>
    </div>
    <div class="link-row">
      <a href="${escapeHtml(dashboardUrl(cfg.skillnote_url))}" target="_blank" rel="noopener">SkillNote dashboard</a>
      <span class="dot">·</span>
      <a href="${CLAUDE_APP_URL}" target="_blank" rel="noopener">Open claude.ai →</a>
    </div>
  `;
  onClick("open-options", () => chrome.runtime.openOptionsPage());
  wireSyncNow("sync-now", "Syncing…");
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function renderActivity(entries: ActivityEntry[]): string {
  if (entries.length === 0) {
    return `<div class="empty-act">No activity yet — sync to get started.</div>`;
  }
  return entries
    .slice()
    .reverse()
    .slice(0, 6)
    .map((e) => {
      const m = activityMeta(e.kind);
      return `<div class="act ${e.kind === "error" ? "error" : ""}">
        <span class="glyph ${m.tone}" aria-label="${escapeHtml(m.label)}">${escapeHtml(m.glyph)}</span>
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
};
