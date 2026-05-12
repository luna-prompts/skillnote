#!/usr/bin/env node
/**
 * Generate PWA icon PNGs from the source SVG.
 *
 * Why: Chrome's PWA install criteria require at least one 192×192 and one
 * 512×512 raster icon. SVGs are accepted by some browsers but rejected by
 * the install-prompt heuristic in others. Shipping PNGs makes the install
 * prompt fire reliably.
 *
 * Outputs (committed to public/):
 *   icon-192.png            — Chrome install + Android shortcut
 *   icon-512.png            — high-res manifest icon
 *   icon-512-maskable.png   — Android adaptive icon (safe area padded)
 *   apple-touch-icon.png    — iOS home-screen icon (180×180)
 *
 * Re-run with:  node scripts/generate-pwa-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const publicDir = join(root, 'public')
const sourceSvg = join(publicDir, 'icon-512.svg')

const TEAL = { r: 13, g: 148, b: 136, alpha: 1 } // #0d9488 (brand)
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

async function svgBuffer() {
  return readFile(sourceSvg)
}

async function flat(size, outputName) {
  // White background; icon centered + scaled to fit.
  const svg = await svgBuffer()
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: WHITE })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(join(publicDir, outputName), buf)
  return { name: outputName, size, bytes: buf.length }
}

async function maskable(size, outputName) {
  // Maskable icons need a "safe area" — the visible icon must fit in the
  // inner 80% so the OS can mask it to a circle / squircle without clipping.
  // We scale the SVG to ~70% and pad with the teal brand color.
  const inner = Math.round(size * 0.7)
  const svg = await svgBuffer()
  const iconBuf = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const buf = await sharp({
    create: { width: size, height: size, channels: 4, background: TEAL },
  })
    .composite([{ input: iconBuf, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(join(publicDir, outputName), buf)
  return { name: outputName, size, bytes: buf.length }
}

const targets = [
  flat(192, 'icon-192.png'),
  flat(512, 'icon-512.png'),
  maskable(512, 'icon-512-maskable.png'),
  flat(180, 'apple-touch-icon.png'),
]

const results = await Promise.all(targets)
for (const r of results) {
  console.log(`  ✓ ${r.name.padEnd(26)} ${r.size}×${r.size}  ${(r.bytes / 1024).toFixed(1)} KB`)
}
console.log(`\n  → ${results.length} icons written to public/`)
