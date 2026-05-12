/**
 * Brand-mark SVG components for the agents shown on the Connect page.
 *
 * Two principles:
 *   1. Each mark renders inside a 64×64 viewBox so they line up identically
 *      in the ProductCard regardless of glyph shape.
 *   2. The marks accept no color prop — they own their brand color. The card
 *      surrounding them is neutral; the mark provides the visual identity.
 */

export function SkillNoteMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SkillNote"
      role="img"
    >
      <rect width="64" height="64" rx="14" fill="#0a0a0a" />
      <path
        d="M22 18 L22 46 M26 18 L26 30 C26 34, 30 34, 33 34 C40 34, 42 30, 42 26 C42 22, 40 18, 33 18 L26 18 Z"
        stroke="#fafafa"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M30 34 L30 46"
        stroke="#10b981"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ClaudeCodeMark({ size = 56 }: { size?: number }) {
  // Anthropic's brand uses a warm coral. The mark below is a stylized
  // "sunburst-C" — recognizable as Anthropic-family without being a
  // pixel-perfect copy of their wordmark.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Claude Code"
      role="img"
    >
      <rect width="64" height="64" rx="14" fill="#f4ede4" />
      <g stroke="#cc785c" strokeWidth="2.4" strokeLinecap="round">
        <line x1="32" y1="14" x2="32" y2="22" />
        <line x1="32" y1="42" x2="32" y2="50" />
        <line x1="14" y1="32" x2="22" y2="32" />
        <line x1="42" y1="32" x2="50" y2="32" />
        <line x1="20" y1="20" x2="24.5" y2="24.5" />
        <line x1="39.5" y1="39.5" x2="44" y2="44" />
        <line x1="44" y1="20" x2="39.5" y2="24.5" />
        <line x1="20" y1="44" x2="24.5" y2="39.5" />
      </g>
      <circle cx="32" cy="32" r="7" fill="#cc785c" />
    </svg>
  )
}

export function OpenClawMark({ size = 56 }: { size?: number }) {
  // A paw, but stylized — three pads on top, one wide pad below, in a
  // calm slate (neither competing for attention with Claude's coral nor
  // SkillNote's monogram).
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="OpenClaw"
      role="img"
    >
      <rect width="64" height="64" rx="14" fill="#1f2937" />
      <g fill="#e5e7eb">
        <ellipse cx="22" cy="24" rx="4" ry="5.5" />
        <ellipse cx="32" cy="20" rx="4" ry="5.5" />
        <ellipse cx="42" cy="24" rx="4" ry="5.5" />
        <ellipse cx="50" cy="34" rx="3.5" ry="5" />
        <path
          d="M22 38 C22 32, 42 32, 42 38 C44 42, 42 48, 36 48 L28 48 C22 48, 20 42, 22 38 Z"
          fill="#e5e7eb"
        />
      </g>
    </svg>
  )
}
