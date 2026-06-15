// Tests for the read-only data the side panel fetches: listCollections
// (collection picker / synced list) and fetchUsage (the "this week" hero).
// Covers the bugs hardened this session: X-Total-Count parsing, the
// published/q/limit params, the timeout on the raw fetch, auth classification,
// and the most_called_skill→most_called mapping with defaults.

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
  vi.useRealTimers();
});

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("listCollections", () => {
  it("builds the published+limit query and parses X-Total-Count", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonRes(200, [{ name: "conventions", count: 4, published_to_claude_ai: true }], {
        "X-Total-Count": "37",
      }),
    );
    const { rows, total } = await client.listCollections({ published: true, limit: 100 });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/v1/collections?");
    expect(url).toContain("published=true");
    expect(url).toContain("limit=100");
    expect(rows).toHaveLength(1);
    expect(total).toBe(37); // from the header, NOT rows.length
  });

  it("falls back to rows.length when X-Total-Count is absent", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonRes(200, [
        { name: "a", count: 1, published_to_claude_ai: true },
        { name: "b", count: 2, published_to_claude_ai: true },
      ]),
    );
    const { total } = await client.listCollections({ published: true });
    expect(total).toBe(2);
  });

  it("URL-encodes the q search term", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(jsonRes(200, []));
    await client.listCollections({ q: "front end/ml" });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("q=front+end%2Fml");
  });

  it("attaches the bearer token", async () => {
    const client = buildClient("https://s.io", "tok-abc");
    (globalThis.fetch as any).mockResolvedValueOnce(jsonRes(200, []));
    await client.listCollections({});
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok-abc");
  });

  it("maps 401/403 to SkillNoteAuthError", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(jsonRes(403, {}));
    await expect(client.listCollections({})).rejects.toBeInstanceOf(SkillNoteAuthError);
  });

  it("times out a hung request as a network error (never hangs the panel)", async () => {
    vi.useFakeTimers();
    const client = buildClient("https://s.io", "tok");
    // fetch that rejects with AbortError when its signal aborts.
    (globalThis.fetch as any).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const p = client.listCollections({});
    const assertion = expect(p).rejects.toBeInstanceOf(SkillNoteNetworkError);
    await vi.advanceTimersByTimeAsync(31_000); // past DEFAULT_TIMEOUT_MS (30s)
    await assertion;
  });

  it("honors an external abort signal (type-ahead supersede) without masking it", async () => {
    const client = buildClient("https://s.io", "tok");
    const ctrl = new AbortController();
    (globalThis.fetch as any).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const p = client.listCollections({ signal: ctrl.signal });
    ctrl.abort();
    // External cancel rethrows AbortError (caller superseded) — NOT a network error.
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("fetchUsage", () => {
  it("queries claude.ai usage and maps most_called_skill → most_called", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonRes(200, {
        total_calls: 23,
        unique_skills: 4,
        calls_today: 3,
        most_called_skill: "code-review-checklist",
      }),
    );
    const u = await client.fetchUsage(7);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/v1/analytics/summary");
    expect(url).toContain("agent=claude-ai");
    expect(url).toContain("days=7");
    expect(u).toEqual({
      total_calls: 23,
      unique_skills: 4,
      calls_today: 3,
      most_called: "code-review-checklist",
    });
  });

  it("defaults every field when the API omits them", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(jsonRes(200, {}));
    const u = await client.fetchUsage();
    expect(u).toEqual({
      total_calls: 0,
      unique_skills: 0,
      calls_today: 0,
      most_called: null,
    });
  });
});

describe("setCollectionPublished", () => {
  it("PUTs the publish flag to the encoded collection path", async () => {
    const client = buildClient("https://s.io", "tok");
    (globalThis.fetch as any).mockResolvedValueOnce(jsonRes(204, null));
    await client.setCollectionPublished("front end", true);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://s.io/v1/collections/front%20end/claude-ai");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ published: true });
  });
});
