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
  // Anthropic's "A" mark from Bootstrap Icons (MIT). Coral fill matches
  // Anthropic's brand palette (#cc785c). Renders crisp at any size.
  return (
    <div
      className="flex items-center justify-center rounded-lg"
      style={{ width: size, height: size, backgroundColor: '#f4ede4' }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        width={size * 0.55}
        height={size * 0.55}
        aria-label="Claude Code"
        role="img"
        style={{ color: '#cc785c' }}
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M9.218 2h2.402L16 12.987h-2.402zM4.379 2h2.512l4.38 10.987H8.82l-.895-2.308h-4.58l-.896 2.307H0L4.38 2.001zm2.755 6.64L5.635 4.777 4.137 8.64z"
        />
      </svg>
    </div>
  )
}

export function OpenClawMark({ size = 56 }: { size?: number }) {
  // OpenClaw's pixel-lobster mark from openclaw/openclaw docs/assets.
  return (
    <img
      src="/openclaw-mark.svg"
      alt="OpenClaw"
      width={size}
      height={size}
      className="block rounded-lg"
      draggable={false}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
