import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";

// Vite is used purely as a TypeScript bundler — no framework, no JSX.
// Each of the extension's three entry points (service worker, popup,
// options page) builds independently with the same bundler config.
//
// After build, the manifest and icons are copied from /public into /dist,
// alongside the static HTML files. The final /dist directory is the loadable
// unpacked extension.
export default defineConfig({
  // Treat src/ as the project root so popup.html/options.html land at
  // dist/popup.html (matching the manifest's "default_popup" reference)
  // instead of dist/src/popup.html.
  root: "src",
  // Explicitly disable PostCSS — the extension uses plain inline CSS only.
  // Without this, Vite picks up the parent SkillNote project's
  // postcss.config.mjs (which loads Tailwind) and the build fails because
  // those deps aren't installed in extensions/claude-ai/node_modules.
  css: {
    postcss: { plugins: [] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
        popup: resolve(__dirname, "src/popup.html"),
        options: resolve(__dirname, "src/options.html"),
      },
      preserveEntrySignatures: false,
      output: {
        // Service worker MUST be at the root of /dist as background.js, and
        // the content script as content.js — both referenced by fixed names
        // (background.js in the manifest; content.js by registerContentScripts).
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          if (chunkInfo.name === "content") return "content.js";
          return "[name]-[hash].js";
        },
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    target: "esnext",
    sourcemap: true,
  },
  plugins: [
    {
      name: "copy-static-files",
      closeBundle() {
        // Build the Chrome dist by default. For Firefox, run with
        // SKILLNOTE_TARGET=firefox to use firefox-manifest.json instead.
        // Chrome's MV3 service_worker doesn't work in Firefox yet — Firefox
        // requires `background.scripts` + module type.
        const dist = resolve(__dirname, "dist");
        mkdirSync(dist, { recursive: true });
        const target = process.env.SKILLNOTE_TARGET ?? "chrome";
        const manifestSrc =
          target === "firefox" ? "firefox-manifest.json" : "manifest.json";
        copyFileSync(
          resolve(__dirname, manifestSrc),
          resolve(dist, "manifest.json"),
        );
        const iconsSrc = resolve(__dirname, "public/icons");
        const iconsDst = resolve(dist, "icons");
        mkdirSync(iconsDst, { recursive: true });
        try {
          for (const f of readdirSync(iconsSrc)) {
            if (statSync(resolve(iconsSrc, f)).isFile()) {
              copyFileSync(resolve(iconsSrc, f), resolve(iconsDst, f));
            }
          }
        } catch {
          // Icons may not exist during early dev — skip silently.
        }
      },
    },
  ],
});
