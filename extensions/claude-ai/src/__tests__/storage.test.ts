import { describe, expect, it } from "vitest";

import {
  appendActivity,
  clearConfig,
  loadConfig,
  saveConfig,
} from "../lib/storage";

describe("storage", () => {
  it("loadConfig returns empty object when nothing stored", async () => {
    const cfg = await loadConfig();
    expect(cfg).toEqual({});
  });

  it("saveConfig merges with existing state", async () => {
    await saveConfig({ skillnote_url: "https://example.com" });
    await saveConfig({ extension_token: "tok123" });
    const cfg = await loadConfig();
    expect(cfg).toMatchObject({
      skillnote_url: "https://example.com",
      extension_token: "tok123",
    });
  });

  it("clearConfig nukes everything", async () => {
    await saveConfig({ skillnote_url: "https://example.com" });
    await clearConfig();
    expect(await loadConfig()).toEqual({});
  });

  it("appendActivity caps the ring buffer at 10 entries", async () => {
    for (let i = 0; i < 15; i++) {
      await appendActivity({
        ts: new Date().toISOString(),
        kind: "push",
        message: `msg ${i}`,
      });
    }
    const cfg = await loadConfig();
    expect(cfg.recent_activity).toHaveLength(10);
    // The OLDEST entries should have been dropped — newest 10 retained.
    expect(cfg.recent_activity?.[0]?.message).toBe("msg 5");
    expect(cfg.recent_activity?.[9]?.message).toBe("msg 14");
  });

  it("appendActivity preserves entry kind", async () => {
    await appendActivity({ ts: "x", kind: "error", message: "oops" });
    const cfg = await loadConfig();
    expect(cfg.recent_activity?.[0]?.kind).toBe("error");
  });
});
