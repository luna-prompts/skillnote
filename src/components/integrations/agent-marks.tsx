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

export function CodexMark({ size = 56 }: { size?: number }) {
  // OpenAI Codex — a terminal-native coding agent, so its mark is a monochrome
  // `>_` shell-prompt glyph on a rounded plate. Unlike the brand-art img marks
  // above, this is an inline SVG drawn in currentColor so it themes with the
  // neutral card chrome (dark plate in light mode, light plate in dark mode)
  // instead of carrying a fixed brand color.
  return (
    <span
      className="flex items-center justify-center rounded-lg bg-foreground text-background"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={Math.round(size * 0.52)}
        height={Math.round(size * 0.52)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* chevron prompt + cursor underscore */}
        <path d="m6 8 4 4-4 4" />
        <path d="M13 16h5" />
      </svg>
    </span>
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
