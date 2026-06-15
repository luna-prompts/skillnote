import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listConversationSkillInvocations } from "../lib/claude-ai-client";

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listConversationSkillInvocations", () => {
  it("detects a skill read in a tool_use block (capture-verified shape)", async () => {
    // Mirrors the real conversation tree: a tool_use reading the skill file.
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        name: "Refactor auth flow",
        chat_messages: [
          {
            uuid: "msg-1",
            content: [
              {
                type: "tool_use",
                uuid: "tool-abc",
                name: "bash",
                input: {
                  path: "/mnt/skills/user/secure-migrations/SKILL.md",
                  description: "Reading the secure-migrations skill",
                },
              },
            ],
          },
        ],
      }),
    );
    const { invocations: invs, title } = await listConversationSkillInvocations("org_1", "conv_1");
    expect(invs).toHaveLength(1);
    const first = invs[0]!;
    expect(first.slug).toBe("secure-migrations");
    expect(first.namespace).toBe("user");
    expect(first.dedupKey).toBe("tool-abc");
    expect(title).toBe("Refactor auth flow"); // conversation title captured for analytics
  });

  it("extracts the slug regardless of namespace (user/org/anthropic)", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        messages: [
          { content: [{ uuid: "t1", input: { path: "/mnt/skills/org/team-skill/SKILL.md" } }] },
          { content: [{ uuid: "t2", input: { path: "/mnt/skills/anthropic/pdf/SKILL.md" } }] },
        ],
      }),
    );
    const { invocations: invs } = await listConversationSkillInvocations("org_1", "conv_1");
    const slugs = invs.map((i) => i.slug).sort();
    expect(slugs).toEqual(["pdf", "team-skill"]);
  });

  it("strips the plugin prefix for plugin-group skill mounts", async () => {
    // Skills delivered inside the SkillNote plugin group mount as
    // /mnt/skills/plugins/<plugin>:<slug>/SKILL.md — the slug must map back
    // to the registry slug, and the plugin name is captured separately.
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        chat_messages: [
          {
            content: [
              {
                type: "tool_use",
                uuid: "tool-plugin",
                input: { path: "/mnt/skills/plugins/skillnote:secure-migrations/SKILL.md" },
              },
            ],
          },
        ],
      }),
    );
    const { invocations: invs } = await listConversationSkillInvocations("org_1", "conv_1");
    expect(invs).toHaveLength(1);
    const first = invs[0]!;
    expect(first.slug).toBe("secure-migrations");
    expect(first.namespace).toBe("plugins");
    expect(first.pluginName).toBe("skillnote");
    expect(first.dedupKey).toBe("tool-plugin");
  });

  it("ignores non-skill file reads and plain text", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        chat_messages: [
          { content: [{ type: "text", text: "hello /mnt/skills/foo not a real path" }] },
          { content: [{ type: "tool_use", uuid: "x", input: { path: "/mnt/user/data/notes.md" } }] },
          { content: [{ type: "tool_use", uuid: "y", input: { command: "ls" } }] },
        ],
      }),
    );
    const { invocations: invs } = await listConversationSkillInvocations("org_1", "conv_1");
    expect(invs).toEqual([]);
  });

  it("finds multiple skill reads across deeply nested structures", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          conversation: {
            messages: [
              {
                content: [
                  { uuid: "a", input: { path: "/mnt/skills/user/docker-deploy/SKILL.md" } },
                  { uuid: "b", input: { path: "/mnt/skills/user/testing-guide/SKILL.md" } },
                ],
              },
            ],
          },
        },
      }),
    );
    const { invocations: invs } = await listConversationSkillInvocations("org_1", "conv_1");
    expect(invs.map((i) => i.slug).sort()).toEqual(["docker-deploy", "testing-guide"]);
  });

  it("requests the tree with render_all_tools so tool blocks are present", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse(200, { chat_messages: [] }));
    await listConversationSkillInvocations("org_x", "conv_y");
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/organizations/org_x/chat_conversations/conv_y");
    expect(url).toContain("render_all_tools=true");
    // And the web-client header is attached (cookie auth requirement).
    const headers = new Headers((globalThis.fetch as any).mock.calls[0][1].headers);
    expect(headers.get("anthropic-client-platform")).toBe("web_claude_ai");
  });
});
