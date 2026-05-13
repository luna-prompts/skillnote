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
    // R9: drop the teal brand accent from PWA chrome. The standalone
    // window's titlebar uses `theme_color` directly (visible as a band
    // above the app), and Android / Chrome generate dock + home-screen
    // icon plates from it too. Pure black matches the icon-192/512 PNGs'
    // own black background exactly, so the titlebar and the icon read
    // as one continuous mark instead of "teal frame around black icon".
    background_color: '#ffffff',
    theme_color: '#000000',
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
