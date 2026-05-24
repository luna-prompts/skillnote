import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeAIEndpointChangedError,
  ClaudeAINotLoggedInError,
  deleteOrgSkill,
  getOrgId,
  isLoggedIn,
  listOrgSkills,
  uploadOrgSkill,
} from "../lib/claude-ai-client";
import { testHelpers } from "./setup";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("isLoggedIn", () => {
  it("returns false when no session cookie present", async () => {
    expect(await isLoggedIn()).toBe(false);
  });

  it("returns true when sessionKey cookie is present", async () => {
    testHelpers.setCookie({
      url: "https://claude.ai",
      name: "sessionKey",
      value: "x",
      domain: ".claude.ai",
    });
    expect(await isLoggedIn()).toBe(true);
  });

  it("returns true when alternate session cookie name is present", async () => {
    // The client checks multiple candidate names until Phase 0 spike
    // confirms the canonical one.
    testHelpers.setCookie({
      url: "https://claude.ai",
      name: "__Secure-sessionKey",
      value: "x",
      domain: ".claude.ai",
    });
    expect(await isLoggedIn()).toBe(true);
  });
});

describe("getOrgId", () => {
  it("extracts org id from 'organizations' array shape", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        organizations: [
          { id: "org_01ABCDEF", name: "Acme" },
          { id: "org_02XXXX", name: "Other" },
        ],
      }),
    );
    expect(await getOrgId()).toBe("org_01ABCDEF");
  });

  it("extracts org id from top-level 'organization' shape", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { organization: { id: "org_alt" } }),
    );
    expect(await getOrgId()).toBe("org_alt");
  });

  it("throws if no org id in response", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { organizations: [] }),
    );
    await expect(getOrgId()).rejects.toThrow(/no.*org/i);
  });

  it("throws ClaudeAINotLoggedInError on 401", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(getOrgId()).rejects.toBeInstanceOf(ClaudeAINotLoggedInError);
  });

  it("throws ClaudeAIEndpointChangedError on 404", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(404, {}));
    await expect(getOrgId()).rejects.toBeInstanceOf(ClaudeAIEndpointChangedError);
  });

  it("sends credentials: include for cookie auth", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { organizations: [{ id: "x" }] }),
    );
    await getOrgId();
    const opts = (globalThis.fetch as any).mock.calls[0][1];
    expect(opts.credentials).toBe("include");
  });
});

describe("listOrgSkills", () => {
  it("returns skills array from response", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        skills: [
          { id: "skill_01", name: "pdf-extractor", description: "Extracts PDFs" },
          { id: "skill_02", name: "image-resizer" },
        ],
      }),
    );
    const skills = await listOrgSkills("org_01");
    expect(skills).toHaveLength(2);
    expect(skills[0]?.id).toBe("skill_01");
  });

  it("returns empty array for missing skills key", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(200, {}));
    expect(await listOrgSkills("org_01")).toEqual([]);
  });

  it("targets the correct org path", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(200, { skills: [] }));
    await listOrgSkills("org_xyz");
    expect((globalThis.fetch as any).mock.calls[0][0]).toContain(
      "/api/organizations/org_xyz/skills/list-org-skills",
    );
  });
});

describe("uploadOrgSkill", () => {
  it("sends multipart FormData with display_title and files[]", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        skill: { id: "skill_new", version: "v1" },
      }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const result = await uploadOrgSkill("org_1", blob, "my-skill");
    expect(result).toEqual({ skill_id: "skill_new", version: "v1" });
    const body = (globalThis.fetch as any).mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("display_title")).toBe("my-skill");
  });

  it("throws ClaudeAIEndpointChangedError when response missing skill.id", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { result: "some-other-shape" }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    await expect(uploadOrgSkill("org_1", blob, "x")).rejects.toBeInstanceOf(
      ClaudeAIEndpointChangedError,
    );
  });
});

describe("deleteOrgSkill", () => {
  it("sends skill_id in JSON body", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteOrgSkill("org_1", "skill_to_delete");
    const body = (globalThis.fetch as any).mock.calls[0][1].body;
    expect(JSON.parse(body as string)).toEqual({ skill_id: "skill_to_delete" });
  });
});
