/**
 * Coverage for the popup-facing fetchSelfStatus method and the
 * timeout/error handling on the binary-body methods (fetchSkillBundle,
 * importSkill). Before round 6, those two methods bypassed the timeout
 * wrapper — a hung SkillNote would hang the entire sync alarm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildClient,
  SkillNoteAuthError,
  SkillNoteNetworkError,
} from "../lib/skillnote-client";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchSelfStatus", () => {
  it("hits /extension/status and returns the parsed JSON", async () => {
    const payload = {
      integration_id: "int-1",
      browser_label: "Chrome on Mac",
      status: "active",
      linked_skill_count: 7,
      pending_op_count: 1,
      failed_op_count: 0,
      last_sync_at: "2026-05-24T00:00:00Z",
      last_error: null,
    };
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = buildClient("https://skillnote.example", "tok-xyz");
    const status = await client.fetchSelfStatus();
    expect(status.linked_skill_count).toBe(7);
    expect(status.pending_op_count).toBe(1);

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://skillnote.example/v1/integrations/claude-ai/extension/status");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-xyz");
  });

  it("401 from /extension/status raises SkillNoteAuthError", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response("{}", {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = buildClient("https://skillnote.example", "expired-token");
    await expect(client.fetchSelfStatus()).rejects.toBeInstanceOf(SkillNoteAuthError);
  });
});

describe("fetchSkillBundle resilience", () => {
  it("AbortError surfaces as SkillNoteNetworkError with 'timed out' message", async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const client = buildClient("https://skillnote.example", "tok");
    await expect(
      client.fetchSkillBundle("sk-1", "v-1"),
    ).rejects.toBeInstanceOf(SkillNoteNetworkError);
    (globalThis.fetch as any).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    await expect(
      client.fetchSkillBundle("sk-1", "v-1"),
    ).rejects.toThrow(/timed out/);
  });

  it("401 maps to SkillNoteAuthError (not a generic Error)", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(new Blob(["x"]), { status: 401 }),
    );
    const client = buildClient("https://skillnote.example", "tok");
    await expect(
      client.fetchSkillBundle("sk-1", "v-1"),
    ).rejects.toBeInstanceOf(SkillNoteAuthError);
  });

  it("happy path returns a Blob", async () => {
    const zip = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/zip" });
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(zip, { status: 200, headers: { "Content-Type": "application/zip" } }),
    );
    const client = buildClient("https://skillnote.example", "tok");
    const out = await client.fetchSkillBundle("sk-1", "v-1");
    expect(out).toBeInstanceOf(Blob);
  });
});

describe("importSkill resilience", () => {
  it("AbortError surfaces as SkillNoteNetworkError with 'timed out'", async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const client = buildClient("https://skillnote.example", "tok");
    const bundle = new Blob([new Uint8Array([1, 2])], { type: "application/zip" });
    await expect(
      client.importSkill({
        claude_ai_skill_id: "skill_ext_1",
        name: "imported-from-claude",
        description: "test",
        bundle,
      }),
    ).rejects.toBeInstanceOf(SkillNoteNetworkError);
  });

  it("401 maps to SkillNoteAuthError", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response("{}", { status: 401 }),
    );
    const client = buildClient("https://skillnote.example", "tok");
    const bundle = new Blob([new Uint8Array([1, 2])]);
    await expect(
      client.importSkill({
        claude_ai_skill_id: "skill_ext_1",
        name: "imported-from-claude",
        description: "test",
        bundle,
      }),
    ).rejects.toBeInstanceOf(SkillNoteAuthError);
  });
});
