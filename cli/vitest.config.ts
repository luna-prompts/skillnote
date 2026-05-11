import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Top-level CSS config: pin an empty PostCSS pipeline so vite doesn't
  // walk up to the repo root and try to load the Next.js web app's
  // postcss.config.mjs (which requires @tailwindcss/postcss — a module
  // that lives in the root package, not in cli/). The CLI has no CSS.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/**',
      'tests/smoke/**',
      // src/__tests__/e2e.test.ts hits a live backend and only runs in CI's
      // smoke job — skip it from the default unit-test run.
      'src/__tests__/e2e.test.ts',
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
