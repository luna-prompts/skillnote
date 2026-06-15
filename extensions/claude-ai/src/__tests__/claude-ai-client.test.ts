import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeAIEndpointChangedError,
  ClaudeAINotLoggedInError,
  deleteOrgSkill,
  ensureSkillNoteMarketplace,
  getOrgId,
  isLoggedIn,
  listAccountPlugins,
  listOrgSkills,
  setPluginEnabled,
  uploadPluginBundle,
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
  it("selects the chat+plan-capable org, not array position [0]", async () => {
    // The real claude.ai bug: picking [0] grabs an api/legacy org and the
    // skills endpoints 403. The chat-capable org is the correct one even
    // when it's NOT first.
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, [
        { uuid: "org_api", name: "API", capabilities: ["api"] },
        {
          uuid: "org_chat",
          name: "Personal",
          capabilities: ["chat", "claude_pro"],
        },
      ]),
    );
    expect(await getOrgId()).toBe("org_chat");
  });

  it("accepts raven (enterprise) and claude_max plan capabilities", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, [
        { uuid: "org_max", name: "Max", capabilities: ["chat", "claude_max"] },
      ]),
    );
    expect(await getOrgId()).toBe("org_max");
  });

  it("falls back to the LAST org when no capabilities are present", async () => {
    // unofficial-claude-api heuristic: last entry is the active org far
    // more often than the first.
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, [
        { uuid: "org_first", name: "First" },
        { uuid: "org_last", name: "Last" },
      ]),
    );
    expect(await getOrgId()).toBe("org_last");
  });

  it("extracts org id from top-level 'organization' shape", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { organization: { id: "org_alt" } }),
    );
    expect(await getOrgId()).toBe("org_alt");
  });

  it("throws if no org in response", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(200, []));
    await expect(getOrgId()).rejects.toBeInstanceOf(ClaudeAIEndpointChangedError);
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

  it("targets the personal list-skills org path", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(200, { skills: [] }));
    await listOrgSkills("org_xyz");
    // Personal verb (capture-verified symmetry with upload-skill), not the
    // Team/Enterprise `list-org-skills` admin path.
    expect((globalThis.fetch as any).mock.calls[0][0]).toContain(
      "/api/organizations/org_xyz/skills/list-skills",
    );
  });

  it("sends the web-client platform header", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(200, { skills: [] }));
    await listOrgSkills("org_1");
    const headers = new Headers((globalThis.fetch as any).mock.calls[0][1].headers);
    expect(headers.get("anthropic-client-platform")).toBe("web_claude_ai");
  });
});

describe("uploadOrgSkill", () => {
  it("POSTs upload-skill with a single `file` field (capture-verified contract)", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        skill: { uuid: "skill_new", latest_version: "v1" },
      }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const result = await uploadOrgSkill("org_1", blob, "my-skill");
    expect(result).toEqual({ skill_id: "skill_new", version: "v1" });
    const call = (globalThis.fetch as any).mock.calls[0];
    // Real verb is `upload-skill` (not upload-org-skill) with overwrite=true.
    expect(call[0]).toContain("/skills/upload-skill?overwrite=true");
    const body = call[1].body;
    expect(body).toBeInstanceOf(FormData);
    // Single `file` field; no display_title (name comes from SKILL.md).
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(body.get("display_title")).toBeNull();
    expect(body.getAll("files[]").length).toBe(0);
    // And the web-client header is present.
    const headers = new Headers(call[1].headers);
    expect(headers.get("anthropic-client-platform")).toBe("web_claude_ai");
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

describe("ensureSkillNoteMarketplace", () => {
  it("reuses an existing SkillNote marketplace", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { marketplaces: [{ id: "mp_existing", name: "SkillNote" }] }),
    );
    const id = await ensureSkillNoteMarketplace("org_1");
    expect(id).toBe("mp_existing");
    // only the list call — no create
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    expect((globalThis.fetch as any).mock.calls[0][0]).toContain("list-account-marketplaces");
  });

  it("creates a manual marketplace when none exists", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce(jsonResponse(200, { marketplaces: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "mp_new", name: "SkillNote" }));
    const id = await ensureSkillNoteMarketplace("org_1");
    expect(id).toBe("mp_new");
    const createCall = (globalThis.fetch as any).mock.calls[1];
    expect(createCall[0]).toContain("create-account-marketplace");
    expect(JSON.parse(createCall[1].body)).toEqual({
      name: "SkillNote",
      source: "manual",
      source_url: "",
    });
  });
});

describe("uploadPluginBundle", () => {
  it("POSTs the ZIP as multipart with overwrite=true and parses the plugin", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { id: "plugin_1", name: "conventions", version: "0003" }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" });
    const res = await uploadPluginBundle("org_1", "mp_1", blob);
    expect(res.plugin_id).toBe("plugin_1");
    expect(res.version).toBe("0003");
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/marketplaces/mp_1/plugins/account-upload?overwrite=true");
    expect(call[1].body).toBeInstanceOf(FormData);
  });
});

describe("listAccountPlugins / setPluginEnabled", () => {
  it("lists plugins in a marketplace", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { plugins: [{ id: "p1", name: "devops" }] }),
    );
    const plugins = await listAccountPlugins("org_1", "mp_1");
    expect(plugins).toEqual([{ id: "p1", name: "devops" }]);
  });

  it("disables a plugin via PUT enabled", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await setPluginEnabled("org_1", "p1", false);
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toContain("/plugins/p1/enabled");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toEqual({ enabled: false });
  });
});
