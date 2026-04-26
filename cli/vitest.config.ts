import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    css: false,
  },
  css: { postcss: { plugins: [] } },
})
