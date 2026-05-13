import { test, expect } from '@playwright/test'

/**
 * First-time user imports a marketplace repo end-to-end.
 *
 * Originally targeted `/browse`, which has since been renamed to
 * `/marketplace` and rebuilt around <ImportPanel> + <ImportWorkspace>.
 * The action button used to be "Paste a URL" / "Import 2 skills"; today
 * it's "Import" (to inspect) and then "Add N to collection" (to apply).
 * Success toast text changed from "Imported N skills from <owner/repo>"
 * to "Imported N skills into <collection_slug>".
 */
test('first-time user imports wshobson/agents', async ({ page }) => {
  // /marketplace fetches collections to seed the picker — return empty.
  await page.route('**/v1/collections', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.route('**/v1/import/inspect', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        source: { source_type: 'github', host: 'github.com', owner: 'wshobson', repo: 'agents', ref: 'main', resolved_sha: 'abc123' },
        kind: 'plugin',
        skills: [
          { name: 'python-expert', description: 'Python code-review heuristics' },
          { name: 'react-tuner', description: 'React perf hints' },
        ],
        warnings: [],
        suggested_collection_slug: 'wshobson-agents',
      }),
    })
  })

  await page.route('**/v1/import/apply', async route => {
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        source_id: 'src-1', collection_slug: 'wshobson-agents',
        imported: [{ name: 'python-expert', slug: 'python-expert' }, { name: 'react-tuner', slug: 'react-tuner' }],
        skipped: [],
      }),
    })
  })

  await page.goto('/marketplace')
  await expect(page.getByRole('heading', { name: /Install from a marketplace/i })).toBeVisible()

  // Type the shorthand and inspect.
  const input = page.getByRole('textbox', { name: 'Repository or URL' })
  await input.fill('wshobson/agents')
  // Anchor the regex so it does NOT match "Re-import" (compact-mode label).
  await page.getByRole('button', { name: /^Import$/ }).click()

  // Workspace appears once inspect resolves; both skills are pre-selected.
  await expect(page.getByText(/python-expert/).first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/react-tuner/).first()).toBeVisible()

  // The action button reads "Add N to collection" — N = selectionCount.
  await page.getByRole('button', { name: /Add 2 to collection/i }).click()

  await expect(
    page.getByText(/Imported 2 skills into wshobson-agents/i),
  ).toBeVisible({ timeout: 5000 })
})

/**
 * Reviewer-flagged Major (R9): the happy-path test above mocks
 * `suggested_collection_slug: 'wshobson-agents'`, so `normalizedSlug` is
 * never empty and the "Add N to collection" button is always enabled.
 * In production the backend returns `suggested_collection_slug: null`
 * for several inputs (sanitised owners, local paths). The button is
 * gated on `!normalizedSlug` (ImportWorkspace.tsx:784) — so a real user
 * who pastes a URL that produces no slug will see the button stay
 * disabled until they type one. This second test pins that branch.
 */
test('null suggested_collection_slug keeps Add button disabled until user types', async ({ page }) => {
  await page.route('**/v1/collections', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.route('**/v1/import/inspect', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        source: { source_type: 'github', host: 'github.com', owner: 'wshobson', repo: 'agents', ref: 'main', resolved_sha: 'abc123' },
        kind: 'plugin',
        skills: [{ name: 'python-expert', description: 'Python code-review heuristics' }],
        warnings: [],
        // Critical: production returns null for some shapes — exercise that branch.
        suggested_collection_slug: null,
      }),
    })
  })

  await page.goto('/marketplace')
  const input = page.getByRole('textbox', { name: 'Repository or URL' })
  await input.fill('wshobson/agents')
  await page.getByRole('button', { name: /^Import$/ }).click()

  // Skill renders in the workspace.
  await expect(page.getByText(/python-expert/).first()).toBeVisible({ timeout: 5000 })

  // The action button label is now "Track source" (because hasSkills && no slug
  // means buttonLabel falls back to that branch) OR "Add 1 to collection"
  // depending on selectionCount — but both are disabled while normalizedSlug
  // is empty. Locate the action button by its disabled state, not by label.
  const actionButton = page
    .locator('footer button')
    .filter({ hasText: /Add 1 to collection|Track source/i })
    .first()
  await expect(actionButton).toBeDisabled()
})
