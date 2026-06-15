import { defineConfig } from "vitest/config";

// Separate config for tests (the production vite.config.ts is for building the
// extension bundle). Vitest auto-merges with vite.config.ts otherwise, which
// would inherit the Manifest-V3-specific rollup input/output settings.
export default defineConfig({
  // Disable PostCSS — same reason as vite.config.ts: the parent SkillNote
  // project's postcss.config.mjs references Tailwind, which isn't installed
  // in extensions/claude-ai/node_modules.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
  },
});
