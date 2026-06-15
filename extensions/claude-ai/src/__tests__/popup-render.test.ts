// @vitest-environment jsdom
//
// Render-level tests for the popup. The pure decision logic lives in view.ts
// (view.test.ts); these assert that each connection state paints the right
// DOM — the regression net the visual checks can't provide in CI.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionConfig } from "../lib/types";

const POPUP_BODY = `
  <header>
    <span class="brand"><img class="mark" src="icons/logo.svg" alt="" /><span class="name">SkillNote</span></span>
    <span id="status-pill" class="pill muted">…</span>
  </header>
  <main id="content" aria-live="polite">Loading…</main>
`;

// Mutable fixture the chrome stub serves to loadConfig().
let fixture: ExtensionConfig = {};
const openOptions = vi.fn();
const sendMessage = vi.fn().mockResolvedValue({ ok: true });

function installChrome(): void {
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (k: unknown) =>
          Promise.resolve(k === "skillnote" ? { skillnote: fixture } : {}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      openOptionsPage: openOptions,
      sendMessage,
      getURL: (p: string) => p,
      onMessage: { addListener: () => {} },
    },
  };
}

async function renderWith(cfg: ExtensionConfig) {
  fixture = cfg;
  vi.resetModules();
  document.body.innerHTML = POPUP_BODY;
  installChrome();
  const mod = await import("../popup");
  await mod.render();
  return mod;
}

const ACTIVE = {
  skillnote_url: "https://skillnote.acme.com",
  extension_token: "tok",
  browser_label: "Chrome on macOS",
};

beforeEach(() => {
  vi.useFakeTimers();
  openOptions.mockClear();
  sendMessage.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function pill() {
  return document.getElementById("status-pill")!;
}
function content() {
  return document.getElementById("content")!.textContent ?? "";
}

describe("popup render", () => {
  it("setup state: renders the inline pairing form (no options-tab detour)", async () => {
    await renderWith({});
    expect(pill().textContent).toBe("Set up");
    expect(content()).toContain("Connect SkillNote");
    // The whole pairing flow lives in the popup now: URL + label + Connect.
    expect(document.getElementById("url")).not.toBeNull();
    expect(document.getElementById("label")).not.toBeNull();
    expect(document.getElementById("pair")).not.toBeNull();
  });

  it("setup state: rejects an empty URL inline without starting a pair", async () => {
    await renderWith({});
    sendMessage.mockClear(); // ignore the on-open health ping
    (document.getElementById("pair") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.getElementById("error")!.textContent).toMatch(/valid http/i);
    const pairCalls = sendMessage.mock.calls.filter(
      (c) => c[0]?.type === "skillnote.start-pair",
    );
    expect(pairCalls).toHaveLength(0);
  });

  it("pairing state: shows the code, a copy button, and a countdown", async () => {
    await renderWith({
      skillnote_url: "https://s.io",
      pairing: {
        pairing_token: "pt",
        pairing_code: "K7P29M",
        integration_id: "i",
        redemption_url: "https://s.io/pair?code=K7P29M",
        // far-future so the countdown is not "expired"
        expires_at: "2999-01-01T00:00:00Z",
      },
    });
    expect(pill().textContent).toBe("Pairing");
    expect(document.getElementById("code")!.textContent).toBe("K7P29M");
    expect(document.getElementById("copy")).not.toBeNull();
    expect(document.getElementById("countdown")!.textContent).toMatch(/Expires in/);
    expect(document.getElementById("cancel")).not.toBeNull();
  });

  it("connected state: usage hero + live list + demoted refresh + dashboard link", async () => {
    await renderWith({
      ...ACTIVE,
      claude_session_active: true,
      linked_skill_count: 7,
      pending_op_count: 1,
      failed_op_count: 0,
      last_sync_at: new Date("2026-05-30T11:59:00Z").toISOString(),
    });
    expect(pill().textContent).toBe("Connected");
    // Redesign: the proof-of-value usage hero leads (not two zero cards).
    expect(content()).toContain("This week on claude.ai");
    // A pending op surfaces the live syncing banner.
    expect(content()).toContain("Syncing 1 change");
    // Sync is now a demoted refresh affordance — NOT a hero primary button.
    const sync = document.getElementById("sync-now")!;
    expect(sync).not.toBeNull();
    expect(sync.className).not.toContain("btn-primary");
    // Deep link back to the user's own SkillNote dashboard.
    const dash = Array.from(document.querySelectorAll("a")).find((a) =>
      /Dashboard/i.test(a.textContent || ""),
    ) as HTMLAnchorElement | undefined;
    expect(dash).toBeTruthy();
    expect(dash!.getAttribute("href")).toBe(
      "https://skillnote.acme.com/settings/integrations/claude-ai",
    );
  });

  it("needs_signin state: calm Sign in CTA, not an error", async () => {
    await renderWith({ ...ACTIVE, claude_session_active: false, last_error: "stale" });
    expect(pill().textContent).toBe("Sign in");
    expect(content()).toContain("Sign in to claude.ai");
    // It must NOT surface the stale error string as the message.
    expect(content()).not.toContain("stale");
  });

  it("error state: surfaces the error with a retry", async () => {
    await renderWith({
      ...ACTIVE,
      claude_session_active: true,
      last_error: "claude.ai endpoint changed",
    });
    expect(pill().textContent).toBe("Error");
    expect(content()).toContain("claude.ai endpoint changed");
    expect(document.getElementById("retry")).not.toBeNull();
  });

  it("connected state: the settings gear opens an IN-POPUP settings view (never a tab)", async () => {
    await renderWith({ ...ACTIVE, claude_session_active: true });
    document.getElementById("open-settings")!.click();
    // The view swap re-renders async — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(openOptions).not.toHaveBeenCalled();
    expect(content()).toContain("Settings");
    expect(content()).toContain("SkillNote app");
    expect(content()).toContain("claude.ai");
    expect(document.getElementById("disconnect")).not.toBeNull();
    // Back returns home.
    document.getElementById("back")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById("sync-now")).not.toBeNull();
  });

  it("connected state: shows the read-only synced-collections section", async () => {
    await renderWith({ ...ACTIVE, claude_session_active: true });
    expect(content()).toContain("Live on claude.ai");
    expect(document.getElementById("collections")).not.toBeNull();
    // Read-only surface: NO toggles — sync is controlled from the SkillNote app.
    expect(document.querySelector("input[data-col]")).toBeNull();
  });

  it("connected state: Activity is its own tab (feed not on Overview)", async () => {
    await renderWith({
      ...ACTIVE,
      claude_session_active: true,
      recent_activity: [
        { ts: new Date().toISOString(), kind: "push", message: "conventions → claude.ai" },
      ],
    });
    // Overview: tabs present, feed NOT rendered inline.
    expect(document.getElementById("tab-activity")).not.toBeNull();
    expect(content()).not.toContain("conventions → claude.ai");
    // Switch to the Activity tab.
    document.getElementById("tab-activity")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(content()).toContain("conventions → claude.ai");
    // Deep link to the full history (the app's notifications page).
    const link = Array.from(document.querySelectorAll("a")).find((a) =>
      /Full history/i.test(a.textContent || ""),
    );
    expect(link?.getAttribute("href")).toBe("https://skillnote.acme.com/notifications");
    // And back.
    document.getElementById("tab-home")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById("sync-now")).not.toBeNull();
  });
});

describe("popup theme matching", () => {
  function theme() {
    return document.documentElement.dataset.theme;
  }

  it("applies the sampled dark theme when connected", async () => {
    await renderWith({ ...ACTIVE, claude_session_active: true, claude_theme: "dark" });
    expect(theme()).toBe("dark");
  });

  it("applies the sampled light theme when connected", async () => {
    await renderWith({ ...ACTIVE, claude_session_active: true, claude_theme: "light" });
    expect(theme()).toBe("light");
  });

  it("uses the sampled theme even DURING SETUP (not the OS) — regression guard", async () => {
    // The bug this pins: setup used to force the OS theme, so a light claude.ai
    // showed a dark panel on a dark-OS machine. Setup must honor claude_theme.
    await renderWith({ claude_theme: "light" });
    expect(pill().textContent).toBe("Set up");
    expect(theme()).toBe("light");
    await renderWith({ claude_theme: "dark" });
    expect(theme()).toBe("dark");
  });

  it("falls back to a concrete theme when nothing has been sampled", async () => {
    // No claude_theme + matchMedia absent in jsdom → must still resolve to a
    // valid theme (never undefined), so the panel is never unstyled.
    await renderWith({ ...ACTIVE, claude_session_active: true });
    expect(["light", "dark"]).toContain(theme());
  });
});
