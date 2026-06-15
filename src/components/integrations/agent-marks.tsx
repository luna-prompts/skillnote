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

export function OpenAIMark({ size = 56 }: { size?: number }) {
  // OpenAI's monochrome "blossom" knot logomark on a white plate. Used as a
  // "coming soon" placeholder for a future OpenAI sync surface — rendered at
  // reduced opacity by callers, so it reads as not-yet-available.
  return (
    <img
      src="/openai-mark.svg"
      alt="OpenAI"
      width={size}
      height={size}
      className="block rounded-lg ring-1 ring-foreground/5"
      draggable={false}
    />
  )
}

export function ClaudeAIMark({ size = 56 }: { size?: number }) {
  // claude.ai (the web app) is the Claude "spark" — the coral sunburst
  // logomark on Anthropic's ivory plate — NOT the Claude Code pixel-robot
  // mascot. `/claude-ai-spark.svg` is our vector rendering of that mark so
  // the web product is visually distinct from the CLI at a glance.
  return (
    <img
      src="/claude-ai-spark.svg"
      alt="claude.ai"
      width={size}
      height={size}
      className="block rounded-lg ring-1 ring-foreground/5"
      draggable={false}
    />
  )
}
