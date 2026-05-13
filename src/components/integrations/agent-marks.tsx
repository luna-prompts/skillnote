/**
 * Brand-mark components for the Connect page.
 *
 * All three render inside a 64×64 visual frame so they line up identically
 * in the ProductCard. Each mark owns its own brand color; the surrounding
 * card is neutral.
 */

export function SkillNoteMark({ size = 56 }: { size?: number }) {
  // Luna Prompts' SkillNote mark — the existing PWA icon (icon-192.svg)
  // is the canonical SkillNote/Luna Prompts logomark on a dark square.
  return (
    <img
      src="/icon-192.svg"
      alt="SkillNote by Luna Prompts"
      width={size}
      height={size}
      className="block rounded-lg"
      draggable={false}
    />
  )
}

export function ClaudeCodeMark({ size = 56 }: { size?: number }) {
  // The actual @ClaudeDevs (Anthropic's Claude Code team) X/Twitter avatar:
  // pixel-robot mascot in Anthropic coral on a dark plate. Saved verbatim
  // from pbs.twimg.com to `/claude-mark.png` so the canvas color +
  // pixel-spacing match the canonical artwork exactly — no hand-redraw
  // attempt.
  return (
    <img
      src="/claude-mark.png"
      alt="Claude Code"
      width={size}
      height={size}
      className="block rounded-lg"
      draggable={false}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

export function OpenClawMark({ size = 56 }: { size?: number }) {
  // Canonical OpenClaw mark from the homarr-labs dashboard-icons project
  // (https://github.com/homarr-labs/dashboard-icons), which mirrors the
  // OpenClaw project's published brand assets. Replaces the hand-drawn
  // pixel-lobster placeholder we shipped earlier.
  return (
    <img
      src="/openclaw-mark.svg"
      alt="OpenClaw"
      width={size}
      height={size}
      className="block rounded-lg"
      draggable={false}
    />
  )
}
