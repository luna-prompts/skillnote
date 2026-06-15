import { describe, expect, it } from "vitest";

import { appendActivity, loadConfig, saveConfig } from "../lib/storage";

describe("storage concurrency", () => {
  it("concurrent saveConfig calls don't lose patches", async () => {
    // Fire 50 concurrent saves with disjoint patches. Without the write
    // queue, the read-modify-write race loses some fields. With the
    // queue, all 50 patches accumulate.
    const patches = Array.from({ length: 50 }, (_, i) => ({
      [`field_${i}`]: `value_${i}`,
    }));

    await Promise.all(
      patches.map((p) => saveConfig(p as never)),
    );

    const final = await loadConfig();
    for (let i = 0; i < 50; i++) {
      expect((final as any)[`field_${i}`]).toBe(`value_${i}`);
    }
  });

  it("concurrent appendActivity calls preserve every entry", async () => {
    // Each entry is timestamped, so we can verify all 30 are present
    // (capped to MAX_ACTIVITY = 10, but the LAST 10 should be intact —
    // not a mix of duplicates from clobbered writes).
    await saveConfig({ recent_activity: [] });

    const calls = Array.from({ length: 30 }, (_, i) => ({
      ts: `2026-05-24T00:00:${String(i).padStart(2, "0")}Z`,
      kind: "push" as const,
      message: `event-${i}`,
    }));

    await Promise.all(calls.map((c) => appendActivity(c)));

    const cfg = await loadConfig();
    // Ring buffer cap is 10. The last 10 entries by appendActivity order
    // are what should remain — events 20..29.
    expect(cfg.recent_activity).toHaveLength(10);
    // The retained entries must all be unique (no clobbered duplicates).
    const messages = cfg.recent_activity?.map((e) => e.message) ?? [];
    const uniq = new Set(messages);
    expect(uniq.size).toBe(messages.length);
  });

  it("write queue survives a failing task", async () => {
    // A task that throws should not break subsequent saves.
    await saveConfig({ skillnote_url: "https://before.example" });

    // Mock chrome.storage.local.set to throw once.
    const originalSet = chrome.storage.local.set;
    let calls = 0;
    (chrome.storage.local.set as any) = async (...args: unknown[]) => {
      calls++;
      if (calls === 1) throw new Error("simulated failure");
      return (originalSet as any).apply(chrome.storage.local, args);
    };

    try {
      // First save: will throw inside the queue task.
      await expect(saveConfig({ skillnote_url: "fail" })).rejects.toThrow(
        "simulated failure",
      );
      // Second save: should still proceed.
      await saveConfig({ skillnote_url: "https://after.example" });
      const cfg = await loadConfig();
      expect(cfg.skillnote_url).toBe("https://after.example");
    } finally {
      (chrome.storage.local.set as any) = originalSet;
    }
  });
});
