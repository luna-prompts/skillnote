import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildClient,
  SkillNoteAuthError,
  SkillNoteNetworkError,
} from "../lib/skillnote-client";

// Vitest spy on fetch — module-level so tests can inspect call args.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildClient — pairing", () => {
  it("strips trailing slash from base URL", async () => {
    const client = buildClient("https://example.com/", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(
      mockResponse(201, {
        integration_id: "int-1",
        pairing_code: "ABC123",
        pairing_token: "tok-x",
        redemption_url: "https://example.com/pair",
        expires_at: new Date().toISOString(),
      }),
    );
    await client.startPair("test");
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toBe(
      "https://example.com/v1/integrations/claude-ai/extension/pair",
    );
  });

  it("sends browser_label in startPair body", async () => {
    const client = buildClient("https://example.com");
    (globalThis.fetch as any).mockResolvedValueOnce(
      mockResponse(201, {
        integration_id: "int-1",
        pairing_code: "ABC123",
        pairing_token: "tok",
        redemption_url: "https://example.com/pair",
        expires_at: new Date().toISOString(),
      }),
    );
    await client.startPair("Chrome on Mac");
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(JSON.parse(call[1].body as string)).toEqual({
      browser_label: "Chrome on Mac",
    });
  });

  it("does NOT attach Authorization on startPair when no token configured", async () => {
    const client = buildClient("https://example.com");
    (globalThis.fetch as any).mockResolvedValueOnce(
      mockResponse(201, {
        integration_id: "int-1",
        pairing_code: "ABC123",
        pairing_token: "tok",
        redemption_url: "x",
        expires_at: new Date().toISOString(),
      }),
    );
    await client.startPair();
    const headers = new Headers((globalThis.fetch as any).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("pollPair URL-encodes the pairing token", async () => {
    const client = buildClient("https://example.com");
    (globalThis.fetch as any).mockResolvedValueOnce(
      mockResponse(200, { approved: false, extension_token: null }),
    );
    // Token contains chars that need URL encoding.
    await client.pollPair("token+with/special=chars");
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toContain("pairing_token=token%2Bwith%2Fspecial%3Dchars");
  });
});

describe("buildClient — bearer-authed endpoints", () => {
  it("attaches Bearer token on fetchOperations", async () => {
    const client = buildClient("https://example.com", "my-token");
    (globalThis.fetch as any).mockResolvedValueOnce(mockResponse(200, []));
    await client.fetchOperations();
    const headers = new Headers((globalThis.fetch as any).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer my-token");
  });

  it("throws SkillNoteAuthError on 401", async () => {
    const client = buildClient("https://example.com", "bad-token");
    (globalThis.fetch as any).mockResolvedValueOnce(mockResponse(401, { error: { code: "X" } }));
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteAuthError);
  });

  it("throws SkillNoteAuthError on 403", async () => {
    const client = buildClient("https://example.com", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(mockResponse(403, { error: { code: "Y" } }));
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteAuthError);
  });

  it("throws SkillNoteNetworkError on fetch failure", async () => {
    const client = buildClient("https://example.com", "tok");
    (globalThis.fetch as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteNetworkError);
  });

  it("completeOperation sends success+result payload", async () => {
    const client = buildClient("https://example.com", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.completeOperation("op-1", {
      success: true,
      result: { claude_ai_skill_id: "skill_01" },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/operations/op-1/complete");
    expect(JSON.parse(call[1].body as string)).toEqual({
      success: true,
      result: { claude_ai_skill_id: "skill_01" },
    });
  });

  it("handles 204 No Content cleanly (no JSON parse)", async () => {
    const client = buildClient("https://example.com", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      client.completeOperation("op-x", { success: true }),
    ).resolves.toBeUndefined();
  });

  it("fetchSkillBundle returns a Blob", async () => {
    const client = buildClient("https://example.com", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(new Blob([new Uint8Array([1, 2, 3])])),
    );
    const blob = await client.fetchSkillBundle("skill-1", "ver-1");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);
  });

  it("importSkill sends multipart with all required fields", async () => {
    const client = buildClient("https://example.com", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(
      mockResponse(201, { skillnote_skill_id: "sn-1", created: true }),
    );
    const blob = new Blob([new Uint8Array(10)], { type: "application/zip" });
    const out = await client.importSkill({
      claude_ai_skill_id: "skill_anth_01",
      claude_ai_version: "v1",
      name: "my-skill",
      description: "test",
      bundle: blob,
    });
    expect(out).toEqual({ skillnote_skill_id: "sn-1", created: true });
    const body = (globalThis.fetch as any).mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("claude_ai_skill_id")).toBe("skill_anth_01");
    expect(body.get("name")).toBe("my-skill");
    expect(body.get("description")).toBe("test");
  });
});
