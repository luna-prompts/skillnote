// Web-app bridge content script.
//
// Injected (dynamically, after pairing) on the user's SkillNote web origin.
// The SkillNote web app can't talk to the extension directly, so when the
// user toggles "Sync to claude.ai" in the web UI it posts a window message;
// this script relays it to the service worker, which wakes the (dormant MV3)
// worker and runs a sync immediately — instead of the change sitting in the
// queue until the 1-minute alarm happens to fire. Same effect as clicking
// "Sync now" in the popup, but driven from the web UI.
//
// Only a fixed, no-payload signal is forwarded — nothing from the page is
// trusted beyond "the user asked to sync now".
window.addEventListener("message", (event: MessageEvent) => {
  // Only accept messages from this page's own window (not iframes/other origins).
  if (event.source !== window) return;
  const data = event.data as { __skillnote?: unknown } | null;
  if (!data || data.__skillnote !== "sync-now") return;
  try {
    // Visible in the WEB PAGE's console so the user can confirm the bridge is
    // installed on this origin and firing on a "Sync to claude.ai" toggle.
    console.info("[SkillNote] sync-now → waking the extension to sync");
    // Fire-and-forget; the SW handles `skillnote.sync-now` (same as the popup).
    void chrome.runtime?.sendMessage?.({ type: "skillnote.sync-now" });
  } catch {
    // SW waking / transient — the alarm-driven tick will catch up regardless.
  }
});
