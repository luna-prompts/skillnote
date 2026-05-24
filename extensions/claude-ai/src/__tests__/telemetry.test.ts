import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveConfig } from "../lib/storage";
import { reportTelemetry } from "../lib/telemetry";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("reportTelemetry", () => {
  it("is a no-op when not configured", async () => {
    // No skillnote_url or extension_token in storage.
    await reportTelemetry("test_event", { ok: 1 });
    expect((globalThis.fetch as any).mock.calls).toHaveLength(0);
  });

  it("posts to the user's SkillNote backend, not to the project", async () => {
    await saveConfig({
      skillnote_url: "https://skillnote.acme.com",
      extension_token: "tok-123",
    });
    await reportTelemetry("endpoint_changed", { path: "/api/x" });

    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(
      "https://skillnote.acme.com/v1/integrations/claude-ai/extension/telemetry",
    );
    // The URL must contain ONLY the user's SkillNote — never any other host.
    // Anyone seeing a hostname like "telemetry.skillnote-project.com" here
    // would be a privacy violation.
    expect(url).not.toContain("skillnote-project");
    expect(url).not.toContain("luna-prompts");

    const body = JSON.parse(opts.body as string);
    expect(body.category).toBe("endpoint_changed");
    expect(body.ext_version).toBeDefined();
    expect(body.ts).toBeDefined();
    expect(body.detail).toEqual({ path: "/api/x" });
  });

  it("attaches the extension bearer token", async () => {
    await saveConfig({
      skillnote_url: "https://example.com",
      extension_token: "secret-bearer",
    });
    await reportTelemetry("x", {});
    const opts = (globalThis.fetch as any).mock.calls[0][1];
    expect(opts.headers.Authorization).toBe("Bearer secret-bearer");
  });

  it("swallows network errors silently", async () => {
    await saveConfig({
      skillnote_url: "https://example.com",
      extension_token: "tok",
    });
    (globalThis.fetch as any).mockRejectedValueOnce(new Error("DNS fail"));
    // Must NOT throw — telemetry is best-effort.
    await expect(reportTelemetry("x", {})).resolves.toBeUndefined();
  });
});
