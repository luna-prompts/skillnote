// Options page — full pairing setup, connection status, and disconnect.
//
// Pure decisions come from lib/view.ts (unit-tested). This file owns markup +
// interaction. No native confirm()/alert() — disconnect uses an inline
// confirmation panel so the experience stays inside the extension's design.

import { loadConfig } from "./lib/storage";
import type { ExtensionConfig } from "./lib/types";
import {
  defaultBrowserLabel,
  deriveConnectionState,
  formatCountdown,
  hostOf,
  normalizeSkillnoteUrl,
} from "./lib/view";

const CLAUDE_LOGIN_URL = "https://claude.ai/login";

const root = document.getElementById("root")!;

let countdownTimer: ReturnType<typeof setInterval> | null = null;
function clearCountdown(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// Cleanup for the inline disconnect-confirm's document-level keydown listener.
// Hoisted so render() can tear it down — otherwise a background sync tick
// (which re-renders via storage.onChanged ~once a minute) would wipe the
// confirm panel from the DOM but leave the listener orphaned.
let teardownConfirm: (() => void) | null = null;

// Re-render when the stored config changes (catches the moment pairing
// completes via the background poll, or the session state flips). Scoped to
// the "skillnote" key (matches storage.ts KEY) so unrelated writes don't
// trigger spurious re-renders mid-interaction.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.skillnote) void render();
});

void render();

export async function render(): Promise<void> {
  clearCountdown();
  teardownConfirm?.();
  teardownConfirm = null;
  const cfg = await loadConfig();
  const state = deriveConnectionState(cfg);
  if (state === "pairing") return renderPairing(cfg);
  if (state === "connected" || state === "needs_signin" || state === "error") {
    return renderConnected(cfg, state);
  }
  return renderSetup();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function renderSetup(): void {
  root.innerHTML = `
    <div class="card stack">
      <div class="field">
        <label for="url">SkillNote URL</label>
        <input id="url" type="url" placeholder="https://skillnote.acme.com" autocomplete="off" spellcheck="false" />
        <div class="hint">Your SkillNote URL — the same address you open in your browser (e.g. <code>http://localhost:3000</code>). Use HTTPS in production.</div>
      </div>
      <div class="field">
        <label for="label">Browser label</label>
        <input id="label" type="text" placeholder="Chrome on MacBook Pro" autocomplete="off" />
        <div class="hint">Helps you recognize this browser in SkillNote's connected-browsers list.</div>
      </div>
      <div class="err-text" id="error" role="alert"></div>
      <div class="actions">
        <button class="btn btn-primary" id="pair">${ICON.link}Connect</button>
      </div>
    </div>
  `;
  const urlInput = document.getElementById("url") as HTMLInputElement;
  const labelInput = document.getElementById("label") as HTMLInputElement;
  const err = document.getElementById("error")!;
  const pairBtn = document.getElementById("pair") as HTMLButtonElement;

  labelInput.value = defaultBrowserLabel(navigator.userAgent);
  urlInput.focus();

  const clearError = () => {
    err.textContent = "";
    urlInput.setAttribute("aria-invalid", "false");
  };
  urlInput.addEventListener("input", clearError);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pairBtn.click();
  });

  pairBtn.addEventListener("click", async () => {
    clearError();
    const url = normalizeSkillnoteUrl(urlInput.value);
    const label = labelInput.value.trim() || defaultBrowserLabel(navigator.userAgent);
    if (!url) {
      err.textContent = "Enter a valid http(s) SkillNote URL.";
      urlInput.setAttribute("aria-invalid", "true");
      urlInput.focus();
      return;
    }

    // Request host permission for this specific origin (optional_host_permissions).
    let granted = true;
    try {
      const origin = new URL(url).origin + "/*";
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch (e) {
      err.textContent = `Couldn't request permission: ${(e as Error).message}`;
      return;
    }
    if (!granted) {
      err.textContent = "Permission denied for that host — sync needs access to reach SkillNote.";
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
      err.textContent = res?.error ?? "Pairing failed — check the URL and that SkillNote is reachable.";
      pairBtn.disabled = false;
      pairBtn.innerHTML = `${ICON.link}Connect`;
      return;
    }
    // The storage-change listener triggers the pairing render.
  });
}

// ── Pairing ─────────────────────────────────────────────────────────────────

function renderPairing(cfg: ExtensionConfig): void {
  const code = cfg.pairing?.pairing_code ?? "------";
  // Only allow http(s) redemption URLs — the backend-supplied value goes into
  // an <a href>; a javascript:/data: scheme would execute in this extension
  // page (which holds the token). escapeHtml doesn't guard the URL scheme.
  const rawUrl = cfg.pairing?.redemption_url ?? "#";
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "#";
  root.innerHTML = `
    <div class="card stack">
      <div>
        <div class="pill info" style="margin-bottom:10px">Awaiting approval</div>
        <h2 style="font-size:16px; margin:0 0 4px; font-weight:650;">Approve this browser in SkillNote</h2>
        <p class="muted" style="margin:0;">Open SkillNote and confirm the code below. The extension is polling — this page updates automatically once you approve.</p>
      </div>
      <div class="code-box">
        <div class="code" aria-label="Pairing code ${escapeHtml(spell(code))}">${escapeHtml(code)}</div>
        <button class="copy" id="copy" title="Copy code" aria-label="Copy pairing code">${ICON.copy}</button>
      </div>
      <div class="countdown" id="countdown"></div>
      <div class="actions">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="text-decoration:none">
          <button class="btn btn-primary">${ICON.external}Open SkillNote to approve</button>
        </a>
        <button class="btn btn-ghost" id="cancel">Cancel</button>
      </div>
    </div>
  `;
  wireCopy("copy", code);
  document.getElementById("cancel")!.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "skillnote.disconnect" });
  });
  startCountdown(cfg.pairing?.expires_at);
}

// ── Connected (also handles needs_signin + error) ────────────────────────────

function renderConnected(cfg: ExtensionConfig, state: "connected" | "needs_signin" | "error"): void {
  const host = hostOf(cfg.skillnote_url);
  const pill =
    state === "needs_signin"
      ? `<span class="pill warn">Sign in needed</span>`
      : state === "error"
        ? `<span class="pill warn">Attention</span>`
        : `<span class="pill ok">Connected</span>`;

  const notice =
    state === "needs_signin"
      ? `<div class="notice warn"><span class="ico">${ICON.user}</span><div>You're signed out of claude.ai, so sync is paused. <a href="${CLAUDE_LOGIN_URL}" target="_blank" rel="noopener">Open claude.ai</a> and sign in — sync resumes automatically.</div></div>`
      : state === "error"
        ? `<div class="notice warn"><span class="ico">${ICON.alert}</span><div>${escapeHtml(cfg.last_error ?? "The last sync ran into a problem.")}</div></div>`
        : "";

  root.innerHTML = `
    <div class="card stack">
      <div>
        <div class="meta-row">${pill}<strong style="font-size:15px;">${escapeHtml(host)}</strong></div>
        <div class="browser-label">Browser: ${escapeHtml(cfg.browser_label ?? "(unnamed)")}</div>
      </div>
      ${notice}
      <div class="actions" id="primary-actions">
        <button class="btn" id="sync">${ICON.refresh}Sync now</button>
        <button class="btn btn-danger" id="disconnect">${ICON.unlink}Disconnect this browser</button>
      </div>
      <div id="confirm-slot"></div>
      <hr>
      <p class="muted" style="margin:0;">
        Skills sync automatically every minute while you're signed in to claude.ai.
        Disconnecting clears this browser's token — skills already pushed to claude.ai stay put.
      </p>
    </div>
  `;

  wireSyncNow("sync");
  document.getElementById("disconnect")!.addEventListener("click", () => showDisconnectConfirm());
}

/** Inline disconnect confirmation — replaces the jarring native confirm(). */
function showDisconnectConfirm(): void {
  const slot = document.getElementById("confirm-slot");
  const actions = document.getElementById("primary-actions");
  if (!slot) return;
  // Hide the primary actions while confirming to keep focus on the decision.
  if (actions) actions.style.display = "none";

  slot.innerHTML = `
    <div class="confirm" role="alertdialog" aria-modal="true" aria-label="Confirm disconnect">
      <p>Disconnect this browser from SkillNote? Skills already pushed to claude.ai will stay — you can re-pair anytime.</p>
      <div class="actions">
        <button class="btn btn-danger" id="confirm-disconnect">${ICON.unlink}Disconnect</button>
        <button class="btn btn-ghost" id="cancel-disconnect">Keep connected</button>
      </div>
    </div>
  `;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cancel();
  };
  function cancel(): void {
    document.removeEventListener("keydown", onKey);
    teardownConfirm = null;
    slot!.innerHTML = "";
    if (actions) actions.style.display = "";
    document.getElementById("disconnect")?.focus();
  }
  document.addEventListener("keydown", onKey);
  // Let render() (fired by a background sync's storage write) tear this down
  // so the keydown listener can't be orphaned mid-confirm.
  teardownConfirm = () => document.removeEventListener("keydown", onKey);
  // Move focus into the dialog, defaulting to the safe (non-destructive) action.
  document.getElementById("cancel-disconnect")!.focus();
  document.getElementById("cancel-disconnect")!.addEventListener("click", cancel);
  document.getElementById("confirm-disconnect")!.addEventListener("click", async () => {
    const btn = document.getElementById("confirm-disconnect") as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = `<span class="ico spin">${ICON.refresh}</span>Disconnecting…`;
    try {
      const res = await chrome.runtime.sendMessage({ type: "skillnote.disconnect" });
      if (res && res.ok === false) throw new Error(res.error ?? "Disconnect failed");
      // Success: the storage-change listener re-renders into the setup state.
      // Keep the keydown listener registered until then; render() tears it down.
    } catch (e) {
      // Restore the dialog so the user can retry or cancel instead of being
      // stranded on a stuck "Disconnecting…" button.
      btn.disabled = false;
      btn.innerHTML = `${ICON.unlink}Disconnect`;
      const err = slot!.querySelector("[data-confirm-error]") as HTMLElement | null;
      const msg = `Couldn't disconnect: ${(e as Error).message}`;
      if (err) {
        err.textContent = msg;
      } else {
        const p = document.createElement("p");
        p.setAttribute("data-confirm-error", "");
        p.style.cssText = "margin:8px 0 0;font-size:12px;color:var(--err)";
        p.textContent = msg;
        slot!.querySelector(".confirm")?.appendChild(p);
      }
    }
  });
}

// ── Interactions ──────────────────────────────────────────────────────────────

function wireSyncNow(id: string): void {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) return;
  const original = btn.innerHTML;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="ico spin">${ICON.refresh}</span>Syncing…`;
    try {
      await chrome.runtime.sendMessage({ type: "skillnote.sync-now" });
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
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
      /* clipboard blocked — the code is still readable on screen */
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
      ? "Code expired — cancel and reconnect to get a fresh one."
      : `Code expires in <span class="t">${escapeHtml(c.text)}</span>`;
    if (c.expired) clearCountdown();
  };
  paint();
  countdownTimer = setInterval(paint, 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function spell(code: string): string {
  return code.split("").join(" ");
}

// ── Inline icons ────────────────────────────────────────────────────────────
const ICON = {
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  refresh: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  external: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  link: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  unlink: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};
