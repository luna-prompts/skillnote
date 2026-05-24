// Anonymous failure telemetry. OFF by default. The user opts in via the
// options page. When opted in, we POST short error reports to the user's
// SkillNote backend (NOT to the SkillNote project) so the operator who
// runs SkillNote owns the data.
//
// What we send:
//   - error category (e.g. "endpoint_changed", "auth_failed")
//   - claude.ai endpoint that failed (URL path only, no body)
//   - extension version
//
// What we explicitly DON'T send:
//   - cookies, tokens, headers
//   - skill content, slugs, descriptions
//   - user-identifiable info beyond what's already in the extension token

import { loadConfig } from "./storage";

const EXT_VERSION = chrome.runtime.getManifest().version;

export async function reportTelemetry(category: string, detail: Record<string, string | number>): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.skillnote_url || !cfg.extension_token) return;
  try {
    await fetch(`${cfg.skillnote_url}/v1/integrations/claude-ai/extension/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.extension_token}`,
      },
      body: JSON.stringify({
        category,
        ext_version: EXT_VERSION,
        ts: new Date().toISOString(),
        detail,
      }),
    });
  } catch {
    // Telemetry must never throw — best effort only.
  }
}
