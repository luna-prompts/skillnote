# Extension dev scripts

## capture-endpoints.mjs

Phase 0 spike helper. Run against a HAR file you exported from Chrome
devtools while interacting with claude.ai's Customize → Skills section.
Produces a redacted markdown report documenting every endpoint observed.

### Steps

1. Open [claude.ai](https://claude.ai) in Chrome.
2. Sign in to your Team or Enterprise account.
3. Open devtools (⌘⌥I / Ctrl+Shift+I) → **Network** tab.
4. Enable **Preserve log** (top of Network panel).
5. Manually:
   - Click Customize → Skills (captures the list endpoint).
   - Upload a tiny test skill ZIP (captures the upload endpoint).
   - Delete the test skill (captures the delete endpoint).
   - Click the test skill's detail / download if present (captures
     fetch + download).
6. Right-click in the Network panel → **Save all as HAR with content**.
7. Run from this directory:

   ```bash
   node scripts/capture-endpoints.mjs /path/to/claude.har
   ```

8. Open `scripts/captured-endpoints.md`. Verify nothing sensitive
   leaked, then update:
   - `docs/claude-ai-endpoints.md` — replace TODOs with verified paths.
   - `extensions/claude-ai/src/lib/claude-ai-client.ts` — adjust path
     constants if they differ.
   - `extensions/claude-ai/manifest.json` — version bump.

9. Run the extension test suite: `npm test`.

10. Submit the updated extension to Chrome Web Store + Firefox AMO.

### Privacy

The script redacts cookie values and the Authorization header before
writing the markdown report. Still — review the output before committing
or sharing, since claude.ai's response bodies may contain personally
identifiable info (your name, org name, skill content).

Default-deny: the script writes to `scripts/captured-endpoints.md`
which is gitignored (added in `.gitignore` at repo root). The
maintainer copies the cleaned, redacted summary into the public
`docs/claude-ai-endpoints.md`.
