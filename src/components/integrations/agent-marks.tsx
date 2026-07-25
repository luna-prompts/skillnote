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
  // OpenAI Codex — the official logomark, verbatim from the header of
  // developers.openai.com/codex (the OpenAI "blossom" knot Codex ships
  // under). The real Codex app icon is a WHITE blossom on a near-black
  // plate, so the plate and glyph are pinned to literal colors rather than
  // the `foreground`/`background` theme tokens: theme tokens flipped the
  // mark in dark mode into a black-blossom-on-white plate, which is both the
  // inverse of the real icon and a collision with OpenAIMark (which *is*
  // blossom-on-white). Pinned colors keep it correct — and distinct from
  // OpenAIMark — in both themes.
  return (
    <span
      role="img"
      aria-label="OpenAI Codex"
      className="flex items-center justify-center rounded-lg bg-[#0d0d0d] text-white"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={Math.round(size * 0.56)}
        height={Math.round(size * 0.56)}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M38.355 36.52v-9.415c0-.793.297-1.388.99-1.784l18.93-10.902c2.578-1.486 5.65-2.18 8.82-2.18 11.894 0 19.426 9.218 19.426 19.029 0 .694 0 1.486-.1 2.28L66.799 22.05c-1.189-.694-2.379-.694-3.568 0L38.355 36.52Zm44.202 36.67V50.694c0-1.388-.596-2.38-1.785-3.073L55.897 33.15l8.126-4.658c.694-.396 1.289-.396 1.982 0l18.93 10.902c5.452 3.172 9.118 9.91 9.118 16.452 0 7.531-4.46 14.47-11.496 17.344Zm-50.05-19.82-8.127-4.757c-.693-.396-.99-.99-.99-1.784V25.025c0-10.605 8.126-18.633 19.127-18.633 4.163 0 8.028 1.388 11.3 3.865l-19.525 11.3c-1.189.693-1.784 1.684-1.784 3.072v28.74ZM50 63.478l-11.645-6.541V43.062L50 36.522l11.645 6.54v13.875L50 63.477Zm7.483 30.129c-4.163 0-8.028-1.388-11.3-3.865l19.525-11.3c1.189-.693 1.784-1.684 1.784-3.071V46.629l8.226 4.757c.694.396.991.991.991 1.784v21.803c0 10.605-8.226 18.633-19.226 18.633v.001Zm-23.49-22.101-18.93-10.902c-5.45-3.172-9.117-9.91-9.117-16.451 0-7.632 4.559-14.47 11.595-17.344v22.596c0 1.388.595 2.379 1.784 3.072l24.777 14.37-8.126 4.659c-.694.396-1.289.396-1.982 0ZM32.905 87.76c-11.2 0-19.425-8.425-19.425-18.83 0-.794.1-1.587.198-2.38L33.2 77.85c1.189.693 2.379.693 3.568 0l24.876-14.37v9.415c0 .793-.298 1.388-.992 1.784L41.724 85.58c-2.576 1.486-5.649 2.18-8.82 2.18h.001Zm24.579 11.793c11.992 0 22.001-8.523 24.281-19.822C92.864 76.857 100 66.451 100 55.846c0-6.937-2.973-13.676-8.325-18.533.496-2.081.793-4.163.793-6.243 0-14.172-11.496-24.777-24.777-24.777-2.676 0-5.253.396-7.83 1.288C55.401 3.221 49.257.445 42.517.445c-11.992 0-22.001 8.523-24.281 19.822C7.136 23.14 0 33.547 0 44.152c0 6.938 2.973 13.676 8.325 18.533-.496 2.081-.793 4.163-.793 6.243 0 14.172 11.497 24.778 24.777 24.778 2.676 0 5.253-.397 7.83-1.289 4.459 4.36 10.604 7.136 17.344 7.136Z" />
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
