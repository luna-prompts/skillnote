// Best-effort failure telemetry. Sent ONLY to the SkillNote backend this
// extension is paired with — i.e. the user's OWN self-hosted instance, never
// to a third party or the SkillNote project. Pairing the extension to that
// backend IS the consent point: telemetry is gated on an active pairing
// (skillnote_url + extension_token) and silently no-ops otherwise.
//
// What we send (low-sensitivity, so the operator can fix a broken connector):
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
