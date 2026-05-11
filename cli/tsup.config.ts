import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: false,
  sourcemap: true,
  shims: true,
  banner: { js: '#!/usr/bin/env node' },
  // Bundle most deps but mark these as external to keep them resolvable at runtime.
  external: ['dockerode'],
  // Inject build-time constants so package version is reliable regardless of
  // installation layout (npm pack, npx, monorepo, etc.).
  define: {
    __SKILLNOTE_VERSION__: JSON.stringify(pkg.version),
    __SKILLNOTE_NAME__: JSON.stringify(pkg.name),
  },
  esbuildOptions(options) {
    options.legalComments = 'inline'
  },
})
