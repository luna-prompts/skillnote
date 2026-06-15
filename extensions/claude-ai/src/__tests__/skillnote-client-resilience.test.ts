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

describe("skillnote-client resilience", () => {
  it("rejects non-JSON 200 response with a clear error", async () => {
    // Response bodies can only be read once; build a fresh Response per call.
    (globalThis.fetch as any).mockImplementation(
      async () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const client = buildClient("https://example.com", "tok");
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteNetworkError);
    await expect(client.fetchOperations()).rejects.toThrow(/non-JSON/);
  });

  it("rejects malformed JSON gracefully", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response("{not real json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = buildClient("https://example.com", "tok");
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteNetworkError);
  });

  it("AbortError from fetch surfaces as SkillNoteNetworkError", async () => {
    // Simulate the abort outcome (browser fetch rejecting with AbortError)
    // rather than racing real timers.
    (globalThis.fetch as any).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const client = buildClient("https://example.com", "tok");
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteNetworkError);
    // Error message should mention timeout for AbortError specifically.
    await expect(
      (async () => {
        (globalThis.fetch as any).mockRejectedValueOnce(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        );
        await client.fetchOperations();
      })(),
    ).rejects.toThrow(/timed out/);
  });

  it("authorization header sent on every call when token provided", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const client = buildClient("https://example.com", "my-bearer");
    await client.fetchOperations();
    const headers = new Headers((globalThis.fetch as any).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer my-bearer");
  });

  it("network error from fetch (no AbortError) categorized correctly", async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(new Error("ECONNRESET"));
    const client = buildClient("https://example.com", "tok");
    await expect(client.fetchOperations()).rejects.toBeInstanceOf(SkillNoteNetworkError);
    await expect(
      (async () => {
        (globalThis.fetch as any).mockRejectedValueOnce(new Error("ECONNRESET"));
        await client.fetchOperations();
      })(),
    ).rejects.toThrow(/ECONNRESET/);
  });
});
