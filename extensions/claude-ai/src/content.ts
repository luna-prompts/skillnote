// Web-app bridge + theme observer content script.
//
// Injected (dynamically, after pairing) on the user's SkillNote web origin and
// (statically) on claude.ai. The SkillNote web app can't talk to the extension
// directly, so when the user toggles "Sync to claude.ai" in the web UI it posts
// a window message; this script relays it to the service worker, which wakes
// the (dormant MV3) worker and runs a sync immediately. It also watches the
// page's theme and pushes light/dark changes so the side panel matches in real
// time. Only a fixed, no-payload sync signal is forwarded — nothing else from
// the page is trusted.
import { luminanceToTheme } from "./lib/theme";

// Guard against double-injection: this script loads via the static manifest
// content_scripts on normal page loads AND via executeScript when the worker
// attaches it to already-open tabs on startup. Running the observers twice
// would double-report; bail if we've already initialized in this page.
declare global {
  interface Window {
    __skillnoteContentLoaded?: boolean;
  }
}
if (window.__skillnoteContentLoaded) {
  // already initialized — no-op
} else {
  window.__skillnoteContentLoaded = true;

// SECURITY: the sync-now bridge must run ONLY on the user's SkillNote web
// origin (where this script is injected dynamically after pairing) — NEVER on
// claude.ai, where the static manifest injects this same script purely for
// theme detection. The `event.source !== window` check below only blocks
// cross-frame spoofing, not the top page's own scripts; so on claude.ai any
// first-party script (or an XSS there) could post `sync-now` and force the
// worker to drive the user's SkillNote backend + claude.ai (a free
// sync-amplification/DoS trigger). Registering the relay only off-claude.ai
// removes that surface. The theme observer further down is safe everywhere and
// stays unconditional.
const __onClaudeAi = /(^|\.)claude\.(ai|com)$/i.test(location.hostname);
if (!__onClaudeAi) {
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
}

// ── Real-time theme observer ────────────────────────────────────────────────
//
// The side panel mirrors the appearance of the page it's docked beside. Tab
// events + the panel's on-focus ping catch most changes, but an IN-PLACE theme
// toggle (flipping claude.ai/the app to light without navigating) fires none of
// them. So watch the page's own theme here and push changes to the worker the
// instant they happen — that's what makes the switch real-time.
(() => {
  /** Perceived light/dark of the page from its painted background — agnostic
   *  to however the page marks its theme (class, data-attr, CSS var). Walks up
   *  to the first non-transparent background, then defers the actual decision
   *  to the shared, tested luminanceToTheme(). */
  function currentTheme(): "dark" | "light" {
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
    const declaredDark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
    return luminanceToTheme(rgb, declaredDark ? "dark" : "light");
  }

  let last: "dark" | "light" | null = null;
  function report(): void {
    let theme: "dark" | "light";
    try {
      theme = currentTheme();
    } catch {
      return;
    }
    if (theme === last) return; // only on actual change — no churn
    last = theme;
    try {
      void chrome.runtime?.sendMessage?.({ type: "skillnote.theme", theme });
    } catch {
      /* worker waking / context invalidated — the pull path catches up */
    }
  }

  // Initial report once the DOM is ready.
  if (document.body) report();
  else document.addEventListener("DOMContentLoaded", report, { once: true });

  // React to in-place theme flips: most apps toggle a class / data-attr / style
  // on <html> or <body>. Observe both; debounce so a burst of mutations during
  // a theme switch collapses into one check.
  let t: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (t) clearTimeout(t);
    t = setTimeout(report, 120);
  };
  const mo = new MutationObserver(debounced);
  const opts: MutationObserverInit = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-mode", "data-color-scheme"] };
  if (document.documentElement) mo.observe(document.documentElement, opts);
  if (document.body) mo.observe(document.body, opts);

  // "System" themes follow the OS — catch that too.
  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", report);
  } catch {
    /* older engines — the MutationObserver + pull path still cover it */
  }
})();

} // end double-injection guard
