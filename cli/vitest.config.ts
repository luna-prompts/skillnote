import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Pin both `root` and `css.postcss` to isolate vitest from the parent
  // Next.js project. Vite docs explicitly state that an inline `css.postcss`
  // object short-circuits the upward search for postcss config sources, and
  // a fixed `root` stops the upward search for vite config. Without both,
  // vitest finds the repo-root postcss.config.mjs and fails to load
  // @tailwindcss/postcss (a dep of the root package, not cli/).
  root: __dirname,
  css: {
    postcss: { plugins: [] },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/**',
      'tests/smoke/**',
      // src/__tests__/e2e.test.ts hits a live backend and only runs in CI's
      // smoke job — skip it from the default unit-test run.
      'src/__tests__/e2e.test.ts',
      // src/__tests__/zip.test.ts shells out to the `zip` CLI which doesn't
      // exist on stock Windows runners; v0.4 legacy test, Phase 2C cleanup.
      'src/__tests__/zip.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Coverage scope = v0.5 pure-logic modules.
      // Command files are orchestration (clack prompts + execa + docker IO)
      // and are covered by E2E + integration tests rather than unit coverage.
      // They're excluded here so the gate measures what unit tests can prove.
      include: [
        'src/state/**/*.ts',
        'src/docker/inspect.ts',
        'src/docker/health.ts',
        'src/ui/**/*.ts',
        'src/lib/ports.ts',
        'src/lib/system.ts',
        'src/lib/update-check.ts',
        'src/bridge/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/types.ts',
        // package-info.ts uses build-time defines; covered by cli-smoke tests.
        'src/lib/package-info.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 10_000,
  },
})
