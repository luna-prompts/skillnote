// Options page — handles initial pairing, displays connection status,
// allows disconnect.

import { loadConfig } from "./lib/storage";

const root = document.getElementById("root")!;

void render();

// Re-render when chrome.storage changes (catches the moment the pairing
// completes via background poll).
chrome.storage.onChanged.addListener(() => void render());

async function render(): Promise<void> {
  const cfg = await loadConfig();

  if (cfg.extension_token && cfg.skillnote_url) {
    renderConnected(cfg.skillnote_url, cfg.browser_label);
    return;
  }
  if (cfg.pairing) {
    renderPairing(cfg.pairing.pairing_code, cfg.pairing.redemption_url);
    return;
  }
  renderSetup();
}

function renderSetup(): void {
  root.innerHTML = `
    <div class="card stack">
      <div>
        <label for="url">SkillNote URL</label>
        <input id="url" type="url" placeholder="https://skillnote.acme.com" />
        <div class="muted" style="margin-top:6px">Your self-hosted SkillNote instance. Use HTTPS in production; <code>localhost</code> is fine for development.</div>
      </div>
      <div>
        <label for="label">Browser label</label>
        <input id="label" type="text" placeholder="Chrome on MacBook Pro" />
        <div class="muted" style="margin-top:6px">Helps you recognize this browser in SkillNote's connected-browsers list.</div>
      </div>
      <div class="row">
        <button class="primary" id="pair">Connect</button>
        <span id="error" class="muted"></span>
      </div>
    </div>
  `;
  const urlInput = document.getElementById("url") as HTMLInputElement;
  const labelInput = document.getElementById("label") as HTMLInputElement;
  const err = document.getElementById("error")!;

  // Pre-fill the browser label with a sensible default.
  labelInput.value = defaultBrowserLabel();

  document.getElementById("pair")!.addEventListener("click", async () => {
    err.textContent = "";
    const url = urlInput.value.trim().replace(/\/$/, "");
    const label = labelInput.value.trim() || defaultBrowserLabel();
    if (!url) {
      err.textContent = "Enter your SkillNote URL.";
      return;
    }
    // Request the user's permission for this specific host (optional_host_permissions).
    let granted = true;
    try {
      const origin = new URL(url).origin + "/*";
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch (e) {
      err.textContent = `Invalid URL: ${(e as Error).message}`;
      return;
    }
    if (!granted) {
      err.textContent = "Permission denied for that host.";
      return;
    }
    const res = await chrome.runtime.sendMessage({
      type: "skillnote.start-pair",
      skillnote_url: url,
      browser_label: label,
    });
    if (!res?.ok) {
      err.textContent = res?.error ?? "Pairing failed.";
      return;
    }
    // Render will be triggered by the storage-change listener.
  });
}

function renderPairing(pairingCode: string, redemptionUrl: string): void {
  root.innerHTML = `
    <div class="card stack">
      <div>
        <strong>Pairing in progress</strong>
        <p class="muted">Open SkillNote and approve this code:</p>
      </div>
      <div class="code" id="code">${escapeHtml(pairingCode)}</div>
      <div class="row">
        <a href="${escapeHtml(redemptionUrl)}" target="_blank" rel="noopener">
          <button class="primary">Open SkillNote to approve</button>
        </a>
        <button class="danger" id="cancel">Cancel</button>
      </div>
      <hr>
      <p class="muted">The extension is polling SkillNote — once you approve, this page will update automatically.</p>
    </div>
  `;
  document.getElementById("cancel")!.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "skillnote.disconnect" });
  });
}

function renderConnected(skillnoteUrl: string, browserLabel: string | undefined): void {
  const host = new URL(skillnoteUrl).host;
  root.innerHTML = `
    <div class="card stack">
      <div class="row">
        <span class="pill ok">Connected</span>
        <strong>${escapeHtml(host)}</strong>
      </div>
      <div class="muted">Browser: ${escapeHtml(browserLabel ?? "(unnamed)")}</div>
      <hr>
      <div class="row">
        <button id="sync">Sync now</button>
        <button class="danger" id="disconnect">Disconnect this browser</button>
      </div>
      <p class="muted" style="margin-top:18px">
        Skills are synced automatically every minute while you're logged into claude.ai.
        Disconnecting clears the extension token but doesn't remove skills already pushed.
      </p>
    </div>
  `;
  document.getElementById("sync")!.addEventListener("click", async () => {
    const btn = document.getElementById("sync") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Syncing…";
    await chrome.runtime.sendMessage({ type: "skillnote.sync-now" });
    btn.disabled = false;
    btn.textContent = "Sync now";
  });
  document.getElementById("disconnect")!.addEventListener("click", async () => {
    if (!confirm("Disconnect this browser from SkillNote? Skills already pushed to claude.ai will stay.")) return;
    await chrome.runtime.sendMessage({ type: "skillnote.disconnect" });
  });
}

function defaultBrowserLabel(): string {
  const ua = navigator.userAgent;
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "";
  if (/Mac/.test(ua)) os = " on macOS";
  else if (/Win/.test(ua)) os = " on Windows";
  else if (/Linux/.test(ua)) os = " on Linux";
  return `${browser}${os}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
