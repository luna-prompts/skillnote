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
  it("setup state: prompts to connect", async () => {
    await renderWith({});
    expect(pill().textContent).toBe("Set up");
    expect(content()).toContain("Connect SkillNote");
    expect(document.getElementById("open-options")).not.toBeNull();
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

  it("connected state: shows stats + an understated Sync now (not primary)", async () => {
    await renderWith({
      ...ACTIVE,
      claude_session_active: true,
      linked_skill_count: 7,
      pending_op_count: 1,
      failed_op_count: 0,
      last_sync_at: new Date("2026-05-30T11:59:00Z").toISOString(),
    });
    expect(pill().textContent).toBe("Connected");
    expect(content()).toContain("Skills synced");
    const sync = document.getElementById("sync-now")!;
    expect(sync).not.toBeNull();
    // Everyday action must be the subtle chip, not the prominent black CTA.
    expect(sync.className).not.toContain("btn-primary");
    // Enhancement: a deep link back to the user's own SkillNote dashboard.
    const dash = Array.from(document.querySelectorAll("a")).find((a) =>
      /SkillNote dashboard/i.test(a.textContent || ""),
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

  it("Get started opens the options page", async () => {
    await renderWith({});
    document.getElementById("open-options")!.click();
    expect(openOptions).toHaveBeenCalledOnce();
  });
});
