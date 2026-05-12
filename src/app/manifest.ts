import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SkillNote',
    short_name: 'SkillNote',
    description: 'Self-hosted skill registry for AI coding agents',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#10b981',
    categories: ['developer', 'productivity', 'utilities'],
    icons: [
      // PNGs satisfy Chrome's install criteria (192 + 512 required).
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // Maskable variant: Android adaptive icons crop to circle/squircle;
      // visible art sits inside the inner 80% safe area.
      {
        src: '/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      // SVGs render crisply on high-density displays where supported.
      {
        src: '/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
