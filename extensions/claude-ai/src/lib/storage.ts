// Thin wrapper around chrome.storage.local for typed extension config.
//
// chrome.storage.local persists across browser restarts but is wiped if
// the extension is uninstalled — exactly the lifetime we want for the
// pairing state and the extension token. Synced storage (chrome.storage.sync)
// would tempt cross-device replay of the token; we deliberately avoid it.
//
// IMPORTANT: saveConfig + appendActivity do read-modify-write on a single
// storage key. Concurrent callers (e.g. the sync alarm firing while the
// popup also calls "Sync now") would clobber each other's patches because
// chrome.storage doesn't provide compare-and-swap. We serialize writes
// through a module-level promise chain so each save sees the previous
// merged state.

import type { ActivityEntry, ExtensionConfig } from "./types";

const KEY = "skillnote";
const MAX_ACTIVITY = 10;

let _writeQueue: Promise<unknown> = Promise.resolve();

/** Chain a critical-section task behind any pending writes. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = _writeQueue.then(task, task);
  // Keep the queue moving even if a task rejects — never block forever.
  _writeQueue = next.catch(() => undefined);
  return next;
}

export async function loadConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get(KEY);
  return (stored[KEY] as ExtensionConfig | undefined) ?? {};
}

export async function saveConfig(patch: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  return enqueue(async () => {
    const current = await loadConfig();
    const merged = { ...current, ...patch };
    await chrome.storage.local.set({ [KEY]: merged });
    return merged;
  });
}

export async function clearConfig(): Promise<void> {
  await enqueue(async () => {
    await chrome.storage.local.remove(KEY);
  });
}

export async function appendActivity(entry: ActivityEntry): Promise<void> {
  await enqueue(async () => {
    const cfg = await loadConfig();
    const ring = [...(cfg.recent_activity ?? []), entry].slice(-MAX_ACTIVITY);
    await chrome.storage.local.set({ [KEY]: { ...cfg, recent_activity: ring } });
  });
}

// ── Usage dedup ──────────────────────────────────────────────────────────────
// Skill invocations are detected by scanning conversation trees, which return
// the FULL history every time — so the same invocation appears on every scan.
// We persist the set of already-reported dedup keys (bounded ring) so each
// invocation is reported to SkillNote exactly once.

const SEEN_KEY = "skillnote:seen-invocations";
const MAX_SEEN = 1000;

/** Return only the dedup keys not seen before, and mark them seen.
 *  Atomic via the same write queue so concurrent ticks don't double-report. */
export async function filterAndMarkNewInvocations(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(SEEN_KEY);
    const seen: string[] = (stored[SEEN_KEY] as string[] | undefined) ?? [];
    const seenSet = new Set(seen);
    const fresh = keys.filter((k) => !seenSet.has(k));
    if (fresh.length === 0) return [];
    // Append fresh keys, keep the most recent MAX_SEEN.
    const next = [...seen, ...fresh].slice(-MAX_SEEN);
    await chrome.storage.local.set({ [SEEN_KEY]: next });
    return fresh;
  });
}
