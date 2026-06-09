import { describe, expect, it } from "vitest";

import type { ExtensionConfig } from "../lib/types";
import {
  activityMeta,
  defaultBrowserLabel,
  deriveConnectionState,
  formatCountdown,
  formatRelativeTime,
  hostOf,
  normalizeSkillnoteUrl,
  statusMeta,
} from "../lib/view";

describe("deriveConnectionState", () => {
  it("is 'setup' with no URL", () => {
    expect(deriveConnectionState({})).toBe("setup");
  });

  it("is 'setup' when a URL exists but neither token nor pairing (post-disconnect)", () => {
    expect(deriveConnectionState({ skillnote_url: "https://s.io" })).toBe("setup");
  });

  it("is 'pairing' while a handshake is in flight", () => {
    const cfg: ExtensionConfig = {
      skillnote_url: "https://s.io",
      pairing: {
        pairing_token: "t",
        pairing_code: "ABC234",
        integration_id: "i",
        redemption_url: "https://s.io/pair?code=ABC234",
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    };
    expect(deriveConnectionState(cfg)).toBe("pairing");
  });

  it("is 'connected' with a token and healthy session", () => {
    const cfg: ExtensionConfig = {
      skillnote_url: "https://s.io",
      extension_token: "tok",
      claude_session_active: true,
    };
    expect(deriveConnectionState(cfg)).toBe("connected");
  });

  it("is 'connected' when session flag is undefined (not yet ticked)", () => {
    const cfg: ExtensionConfig = {
      skillnote_url: "https://s.io",
      extension_token: "tok",
    };
    expect(deriveConnectionState(cfg)).toBe("connected");
  });

  it("is 'needs_signin' when the claude.ai session is inactive — even if a stale error lingers", () => {
    const cfg: ExtensionConfig = {
      skillnote_url: "https://s.io",
      extension_token: "tok",
      claude_session_active: false,
      last_error: "something old",
    };
    expect(deriveConnectionState(cfg)).toBe("needs_signin");
  });

  it("is 'error' when there's a last_error but the session is active", () => {
    const cfg: ExtensionConfig = {
      skillnote_url: "https://s.io",
      extension_token: "tok",
      claude_session_active: true,
      last_error: "claude.ai endpoint changed",
    };
    expect(deriveConnectionState(cfg)).toBe("error");
  });

  it("prefers pairing over a leftover token (re-pair mid-flight)", () => {
    const cfg: ExtensionConfig = {
      skillnote_url: "https://s.io",
      extension_token: "tok",
      pairing: {
        pairing_token: "t",
        pairing_code: "ABC234",
        integration_id: "i",
        redemption_url: "u",
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    };
    expect(deriveConnectionState(cfg)).toBe("pairing");
  });
});

describe("statusMeta", () => {
  it("maps every state to a label + tone (no snake_case leaks)", () => {
    for (const s of ["setup", "pairing", "connected", "needs_signin", "error"] as const) {
      const m = statusMeta(s);
      expect(m.label).toBeTruthy();
      expect(m.label).not.toMatch(/_/);
      expect(["ok", "warn", "err", "info", "muted"]).toContain(m.tone);
    }
  });

  it("signed-out is a warning, not an error", () => {
    expect(statusMeta("needs_signin").tone).toBe("warn");
    expect(statusMeta("connected").tone).toBe("ok");
    expect(statusMeta("error").tone).toBe("err");
  });
});

describe("hostOf", () => {
  it("extracts host from a URL", () => {
    expect(hostOf("https://skillnote.acme.com/foo")).toBe("skillnote.acme.com");
    expect(hostOf("http://localhost:3000")).toBe("localhost:3000");
  });
  it("falls back gracefully on malformed input", () => {
    expect(hostOf("not a url")).toBe("not a url");
    expect(hostOf(undefined)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-05-30T12:00:00Z").getTime();
  it("handles never / invalid", () => {
    expect(formatRelativeTime(undefined, now)).toBe("never");
    expect(formatRelativeTime("garbage", now)).toBe("unknown");
  });
  it("buckets seconds/minutes/hours/days", () => {
    expect(formatRelativeTime(new Date(now - 2000).toISOString(), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now - 30_000).toISOString(), now)).toBe("30s ago");
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
    expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3h ago");
    expect(formatRelativeTime(new Date(now - 2 * 86400_000).toISOString(), now)).toBe("2d ago");
  });
  it("treats future timestamps (clock skew) as just now", () => {
    expect(formatRelativeTime(new Date(now + 60_000).toISOString(), now)).toBe("just now");
  });
});

describe("formatCountdown", () => {
  const now = new Date("2026-05-30T12:00:00Z").getTime();
  it("returns mm:ss while time remains", () => {
    const c = formatCountdown(new Date(now + 9 * 60_000 + 58_000).toISOString(), now);
    expect(c.text).toBe("9:58");
    expect(c.expired).toBe(false);
    expect(c.urgent).toBe(false);
  });
  it("zero-pads seconds", () => {
    expect(formatCountdown(new Date(now + 60_000 + 5000).toISOString(), now).text).toBe("1:05");
  });
  it("flags the final minute as urgent", () => {
    const c = formatCountdown(new Date(now + 45_000).toISOString(), now);
    expect(c.text).toBe("0:45");
    expect(c.urgent).toBe(true);
    expect(c.expired).toBe(false);
  });
  it("reports expired at/after zero", () => {
    const c = formatCountdown(new Date(now - 1000).toISOString(), now);
    expect(c.expired).toBe(true);
    expect(c.text).toBe("expired");
  });
  it("is empty for missing/invalid input", () => {
    expect(formatCountdown(undefined, now).text).toBe("");
    expect(formatCountdown("nope", now).text).toBe("");
  });
});

describe("activityMeta", () => {
  it("gives each kind a glyph + tone + label", () => {
    for (const k of ["push", "pull", "delete", "used", "error"] as const) {
      const m = activityMeta(k);
      expect(m.glyph).toBeTruthy();
      expect(m.label).toBeTruthy();
    }
  });
  it("errors are toned err, pushes ok", () => {
    expect(activityMeta("error").tone).toBe("err");
    expect(activityMeta("push").tone).toBe("ok");
  });
});

describe("defaultBrowserLabel", () => {
  it("detects Chrome on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    expect(defaultBrowserLabel(ua)).toBe("Chrome on macOS");
  });
  it("detects Edge over Chrome (Edg token wins)", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120";
    expect(defaultBrowserLabel(ua)).toBe("Edge on Windows");
  });
  it("detects Firefox on Linux", () => {
    expect(defaultBrowserLabel("Mozilla/5.0 (X11; Linux x86_64) Firefox/120")).toBe(
      "Firefox on Linux",
    );
  });
});

describe("normalizeSkillnoteUrl", () => {
  it("trims and strips trailing slashes", () => {
    expect(normalizeSkillnoteUrl("  https://s.io/// ")).toBe("https://s.io");
  });
  it("accepts http and https", () => {
    expect(normalizeSkillnoteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("rejects empty and non-http schemes", () => {
    expect(normalizeSkillnoteUrl("")).toBeNull();
    expect(normalizeSkillnoteUrl("   ")).toBeNull();
    expect(normalizeSkillnoteUrl("ftp://s.io")).toBeNull();
    expect(normalizeSkillnoteUrl("javascript:alert(1)")).toBeNull();
  });
});
