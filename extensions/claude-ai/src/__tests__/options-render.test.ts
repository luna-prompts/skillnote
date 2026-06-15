// @vitest-environment jsdom
//
// Render + interaction tests for the options page. Focuses on the behaviors
// the visual checks can't guard in CI: the setup form, the pairing code, and
// the inline disconnect confirmation that replaced the native confirm().

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionConfig } from "../lib/types";

let fixture: ExtensionConfig = {};
const sendMessage = vi.fn().mockResolvedValue({ ok: true });
const permissionsRequest = vi.fn().mockResolvedValue(true);

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
      openOptionsPage: () => {},
      sendMessage,
      getURL: (p: string) => p,
      onMessage: { addListener: () => {} },
    },
    permissions: { request: permissionsRequest },
  };
}

async function renderWith(cfg: ExtensionConfig) {
  fixture = cfg;
  vi.resetModules();
  document.body.innerHTML = `<div id="root"></div>`;
  installChrome();
  const mod = await import("../options");
  await mod.render();
  return mod;
}

const ACTIVE = {
  skillnote_url: "https://skillnote.acme.com",
  extension_token: "tok",
  browser_label: "Chrome on macOS",
  claude_session_active: true,
};

function rootText() {
  return document.getElementById("root")!.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockClear();
  permissionsRequest.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("options render", () => {
  it("setup: renders URL + label inputs with a prefilled label and Connect", async () => {
    await renderWith({});
    expect((document.getElementById("url") as HTMLInputElement)).not.toBeNull();
    const label = document.getElementById("label") as HTMLInputElement;
    expect(label.value.length).toBeGreaterThan(0); // defaulted from UA
    expect(document.getElementById("pair")).not.toBeNull();
  });

  it("setup: rejects an empty URL with an inline error (no pairing call)", async () => {
    await renderWith({});
    (document.getElementById("url") as HTMLInputElement).value = "";
    document.getElementById("pair")!.click();
    await Promise.resolve();
    expect(document.getElementById("error")!.textContent).toMatch(/valid http/i);
    // Only the on-open health ping is allowed — no pairing message.
    const pairCalls = sendMessage.mock.calls.filter(
      (c) => c[0]?.type === "skillnote.start-pair",
    );
    expect(pairCalls).toHaveLength(0);
  });

  it("pairing: shows code, copy button, countdown, and cancel", async () => {
    await renderWith({
      skillnote_url: "https://s.io",
      pairing: {
        pairing_token: "pt",
        pairing_code: "K7P29M",
        integration_id: "i",
        redemption_url: "https://s.io/pair?code=K7P29M",
        expires_at: "2999-01-01T00:00:00Z",
      },
    });
    expect(rootText()).toContain("K7P29M");
    expect(document.getElementById("copy")).not.toBeNull();
    expect(document.getElementById("countdown")!.textContent).toMatch(/expires in/i);
    expect(document.getElementById("cancel")).not.toBeNull();
  });

  it("connected: shows Sync now + Disconnect chips", async () => {
    await renderWith(ACTIVE);
    expect(rootText()).toContain("skillnote.acme.com");
    expect(document.getElementById("sync")).not.toBeNull();
    expect(document.getElementById("disconnect")).not.toBeNull();
  });

  it("needs_signin: shows the calm sign-in notice with an Open claude.ai link", async () => {
    await renderWith({ ...ACTIVE, claude_session_active: false });
    expect(rootText()).toContain("signed out of claude.ai");
    const link = document.querySelector('a[href="https://claude.ai/login"]');
    expect(link).not.toBeNull();
  });

  describe("inline disconnect confirmation (replaces native confirm)", () => {
    it("Disconnect reveals an in-page confirm and hides the primary actions — no native confirm()", async () => {
      const nativeConfirm = vi.spyOn(window, "confirm");
      await renderWith(ACTIVE);
      document.getElementById("disconnect")!.click();

      // Inline confirm appears…
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(document.getElementById("confirm-disconnect")).not.toBeNull();
      expect(document.getElementById("cancel-disconnect")).not.toBeNull();
      // …primary actions are hidden…
      expect((document.getElementById("primary-actions") as HTMLElement).style.display).toBe("none");
      // …and the jarring native dialog was never used.
      expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it("Keep connected restores the actions without disconnecting", async () => {
      await renderWith(ACTIVE);
      document.getElementById("disconnect")!.click();
      document.getElementById("cancel-disconnect")!.click();
      expect(document.getElementById("confirm-slot")!.innerHTML).toBe("");
      expect((document.getElementById("primary-actions") as HTMLElement).style.display).toBe("");
      // No disconnect message — the on-open health ping doesn't count.
      const calls = sendMessage.mock.calls.filter(
        (c) => c[0]?.type === "skillnote.disconnect",
      );
      expect(calls).toHaveLength(0);
    });

    it("Escape cancels the confirmation", async () => {
      await renderWith(ACTIVE);
      document.getElementById("disconnect")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(document.getElementById("confirm-slot")!.innerHTML).toBe("");
      const calls = sendMessage.mock.calls.filter(
        (c) => c[0]?.type === "skillnote.disconnect",
      );
      expect(calls).toHaveLength(0);
    });

    it("Confirm sends the disconnect message", async () => {
      await renderWith(ACTIVE);
      document.getElementById("disconnect")!.click();
      document.getElementById("confirm-disconnect")!.click();
      await Promise.resolve();
      expect(sendMessage).toHaveBeenCalledWith({ type: "skillnote.disconnect" });
    });

    it("restores the dialog (not stuck) when disconnect fails", async () => {
      await renderWith(ACTIVE);
      // Backend reports failure for this attempt.
      sendMessage.mockResolvedValueOnce({ ok: false, error: "server boom" });
      document.getElementById("disconnect")!.click();
      const btn = document.getElementById("confirm-disconnect") as HTMLButtonElement;
      btn.click();
      // Flush the async handler's microtask chain (await sendMessage → catch).
      for (let i = 0; i < 8; i++) await Promise.resolve();
      // Button is re-enabled (not stuck on "Disconnecting…") and an error shows.
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toContain("Disconnect");
      expect(document.querySelector("[data-confirm-error]")?.textContent).toMatch(/boom/);
    });
  });
});
