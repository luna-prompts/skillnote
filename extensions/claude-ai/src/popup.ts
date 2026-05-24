// Popup script — renders the status panel + Sync now / Open settings buttons.

import { loadConfig } from "./lib/storage";
import type { ActivityEntry } from "./lib/types";

const pill = document.getElementById("status-pill")!;
const content = document.getElementById("content")!;

void render();

async function render(): Promise<void> {
  const cfg = await loadConfig();

  // Three top-level states: not configured / pairing / connected.
  if (!cfg.skillnote_url) {
    pill.className = "pill warn";
    pill.textContent = "Setup";
    content.innerHTML = `
      <div class="empty">
        Connect to your SkillNote to start syncing.
      </div>
      <div class="actions">
        <button class="primary" id="open-options">Open settings</button>
      </div>
    `;
    document.getElementById("open-options")!.addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  if (cfg.pairing) {
    pill.className = "pill warn";
    pill.textContent = "Pairing";
    content.innerHTML = `
      <div class="empty">
        Waiting for approval.<br>
        Code: <strong>${escapeHtml(cfg.pairing.pairing_code)}</strong>
      </div>
      <div class="actions">
        <a href="${escapeHtml(cfg.pairing.redemption_url)}" target="_blank" rel="noopener" style="flex: 1;">
          <button class="primary" style="width: 100%;">Open SkillNote to approve</button>
        </a>
      </div>
    `;
    return;
  }

  // Connected.
  pill.className = cfg.last_error ? "pill err" : "pill ok";
  pill.textContent = cfg.last_error ? "Error" : "Connected";

  const host = new URL(cfg.skillnote_url).host;
  const lastSync = cfg.last_sync_at ? timeAgo(new Date(cfg.last_sync_at)) : "never";

  const pending = cfg.pending_op_count ?? 0;
  const failed = cfg.failed_op_count ?? 0;
  const linked = cfg.linked_skill_count ?? 0;

  content.innerHTML = `
    <div class="row">
      <span class="label">SkillNote</span>
      <span class="value">${escapeHtml(host)}</span>
    </div>
    <div class="row">
      <span class="label">Last sync</span>
      <span class="value">${escapeHtml(lastSync)}</span>
    </div>
    <div class="row">
      <span class="label">Skills synced</span>
      <span class="value">${linked}</span>
    </div>
    ${pending > 0 ? `<div class="row"><span class="label">Pending</span><span class="value">${pending}</span></div>` : ""}
    ${failed > 0 ? `<div class="row"><span class="label">Failed</span><span class="value" style="color: var(--err, #ef4444);">${failed}</span></div>` : ""}
    ${cfg.last_error ? `<div class="row"><span class="label">Last error</span><span class="value" style="font-size:11px">${escapeHtml(cfg.last_error)}</span></div>` : ""}

    <div class="activity">
      <div class="activity-title">Recent activity</div>
      ${(cfg.recent_activity ?? []).slice().reverse().map(renderActivity).join("") || `<div class="empty" style="padding:8px 0;">No activity yet.</div>`}
    </div>

    <div class="actions">
      <button id="sync-now">Sync now</button>
      <button id="open-options">Settings</button>
    </div>
  `;

  document.getElementById("sync-now")!.addEventListener("click", async () => {
    const btn = document.getElementById("sync-now") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Syncing…";
    await chrome.runtime.sendMessage({ type: "skillnote.sync-now" });
    void render();
  });
  document.getElementById("open-options")!.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

function renderActivity(e: ActivityEntry): string {
  const cls = e.kind === "error" ? "error" : "";
  return `<div class="activity-entry ${cls}"><span class="msg">${escapeHtml(e.message)}</span><span class="ts">${escapeHtml(timeAgo(new Date(e.ts)))}</span></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
