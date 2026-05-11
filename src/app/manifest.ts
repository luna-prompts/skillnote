import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SkillNote',
    short_name: 'SkillNote',
    description: 'Self-hosted skill registry for AI coding agents',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f7f8',
    theme_color: '#0d9488',
    // SVG icons are supported by Chrome, Edge, Safari (PWA install) and
    // satisfy the "any" purpose. Maskable purpose requires a raster fallback;
    // generate icon-512-maskable.png from the SVG once design lands.
    icons: [
      {
        src: '/icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
