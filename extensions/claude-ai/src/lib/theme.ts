// Shared theme logic — the panel mirrors the light/dark of the page it docks
// beside (claude.ai / the SkillNote app). Pure + DOM-free so it's unit-tested.

/** Decide light vs dark from a CSS background-color string (the page's painted
 *  background), using ITU-R BT.601 perceived luma. Implementation-agnostic:
 *  works no matter HOW a page marks its theme, because it reads the resulting
 *  pixel color. Unparseable input (transparent, named colors, "") returns the
 *  `fallback` so callers can pass the page's declared color-scheme.
 *
 *  NOTE: background.ts has an INLINE copy of this 3-line formula inside its
 *  executeScript pull-path (a serialized function can't import into the page).
 *  Keep the two identical — this is the canonical, tested version. */
export function luminanceToTheme(
  bgColor: string,
  fallback: "dark" | "light" = "light",
): "dark" | "light" {
  const m = (bgColor || "").match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return fallback;
  const [r = 255, g = 255, b = 255] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? "dark" : "light";
}
