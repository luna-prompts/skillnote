// Pure presentation logic shared by the popup and options page.
//
// Everything here is deliberately DOM-free and side-effect-free so it can be
// unit-tested in a plain Node environment (see __tests__/view.test.ts) and
// reused identically across both extension surfaces. The rendering code in
// popup.ts / options.ts owns the markup; this module owns the *decisions*.

import type { ActivityEntry, ExtensionConfig } from "./types";

/** Top-level state the UI renders. Distinct from the backend's
 *  IntegrationStatus — this is what the *extension* knows locally. */
export type ConnectionState =
  | "setup" // no SkillNote URL yet
  | "pairing" // handshake in flight, awaiting approval
  | "connected" // active token + claude.ai session healthy
  | "needs_signin" // active token but signed out of claude.ai
  | "error"; // active token but last sync errored

export type Tone = "ok" | "warn" | "err" | "info" | "muted";

/** Derive the single source-of-truth UI state from stored config.
 *
 * Order matters: a fresh install with no URL is "setup"; an in-flight
 * handshake is "pairing"; only once a token exists do we distinguish
 * healthy / signed-out / errored. The signed-out check comes BEFORE the
 * error check so a lapsed cookie reads as the calm "Sign in" state even if
 * a stale error string lingers. */
export function deriveConnectionState(cfg: ExtensionConfig): ConnectionState {
  if (!cfg.skillnote_url) return "setup";
  if (cfg.pairing) return "pairing";
  if (cfg.extension_token) {
    if (cfg.claude_session_active === false) return "needs_signin";
    if (cfg.last_error) return "error";
    return "connected";
  }
  // URL set but neither token nor pairing — treat as setup (e.g. a
  // disconnect cleared the token).
  return "setup";
}

export interface StatusMeta {
  label: string;
  tone: Tone;
}

/** Pill label + tone for a connection state. */
export function statusMeta(state: ConnectionState): StatusMeta {
  switch (state) {
    case "setup":
      return { label: "Set up", tone: "warn" };
    case "pairing":
      return { label: "Pairing", tone: "info" };
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "needs_signin":
      return { label: "Sign in", tone: "warn" };
    case "error":
      return { label: "Error", tone: "err" };
  }
}

/** Best-effort host extraction. Falls back to a cleaned-up string rather
 *  than throwing on malformed URLs. */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** Compact "Xs/m/h/d ago" relative time. Tolerant of invalid input and
 *  clock skew (future timestamps read as "just now"). `now` is injected so
 *  the function stays pure and testable. */
export function formatRelativeTime(
  iso: string | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const diff = now - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface Countdown {
  /** "9:58" style mm:ss, or "expired". */
  text: string;
  expired: boolean;
  /** True in the final 60s — UI can warn (amber). */
  urgent: boolean;
}

/** Time remaining until a pairing code expires, as mm:ss. */
export function formatCountdown(
  expiresAtIso: string | undefined,
  now: number = Date.now(),
): Countdown {
  if (!expiresAtIso) return { text: "", expired: false, urgent: false };
  const end = new Date(expiresAtIso).getTime();
  if (Number.isNaN(end)) return { text: "", expired: false, urgent: false };
  const remaining = end - now;
  if (remaining <= 0) return { text: "expired", expired: true, urgent: true };
  const total = Math.floor(remaining / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return {
    text: `${mm}:${ss.toString().padStart(2, "0")}`,
    expired: false,
    urgent: total <= 60,
  };
}

export interface ActivityMeta {
  /** Single-glyph marker rendered before the message. */
  glyph: string;
  tone: Tone;
  /** Accessible label for the glyph. */
  label: string;
}

/** Glyph + tone for an activity entry kind. */
export function activityMeta(kind: ActivityEntry["kind"]): ActivityMeta {
  switch (kind) {
    case "push":
      return { glyph: "↑", tone: "ok", label: "Pushed" };
    case "pull":
      return { glyph: "↓", tone: "info", label: "Pulled" };
    case "delete":
      return { glyph: "✕", tone: "muted", label: "Deleted" };
    case "used":
      return { glyph: "✦", tone: "info", label: "Used" };
    case "error":
      return { glyph: "!", tone: "err", label: "Error" };
    default:
      return { glyph: "•", tone: "muted", label: "Activity" };
  }
}

/** Derive a sensible default browser label from a user-agent string.
 *  Pure (UA injected) so it can be unit-tested across platforms. */
export function defaultBrowserLabel(ua: string): string {
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  // OS — order matters. Mobile + ChromeOS must be checked BEFORE the generic
  // Mac/Linux/X11 tests: iOS UAs contain "Mac OS X", Android + ChromeOS UAs
  // contain "Linux"/"X11", so the broad checks would otherwise mislabel them.
  let os = "";
  if (/CrOS/.test(ua)) os = " on ChromeOS";
  else if (/Android/.test(ua)) os = " on Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = " on iOS";
  else if (/Windows|Win64|Win32|WOW64/.test(ua)) os = " on Windows";
  else if (/Macintosh|Mac OS X/.test(ua)) os = " on macOS";
  else if (/Linux|X11/.test(ua)) os = " on Linux";
  return `${browser}${os}`;
}

/** Normalize a user-entered SkillNote URL to its bare ORIGIN
 *  (scheme://host[:port]) — never a path/query/hash.
 *
 *  Why origin, not the raw string: people often paste the address bar while
 *  on a SkillNote page (e.g. ".../collections"). If we kept that path, every
 *  API call would become ".../collections/v1/..." and 404 — a confusing total
 *  failure. Returning the origin makes "paste whatever URL you're looking at"
 *  Just Work.
 *
 *  Also lenient about a missing scheme — "localhost:3000" or
 *  "skillnote.acme.com" are common pastes. Loopback/LAN hosts default to
 *  http; everything else to https (production should be TLS). Returns null if
 *  it still can't be parsed as an http(s) URL. */
export function normalizeSkillnoteUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // Prepend a scheme when the input has none ("://" absent). Pick http for
  // local/loopback/LAN/IPv6-literal hosts, https otherwise.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(s);
    s = (local ? "http://" : "https://") + s;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin; // drops path/query/hash; lowercases scheme + host
  } catch {
    return null;
  }
}
