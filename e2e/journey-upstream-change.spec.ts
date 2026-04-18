// Journey: upstream change (resync flow)
//
// Scenario: A user has already imported `wshobson/agents`. They visit /browse.
// The source card shows an amber "2 new · 1 changed" drift pill. They click it.
// A DiffDrawer opens listing 2 new + 1 changed skill. They click "Apply 3 changes"
// and see a success toast.
import { test, expect } from '@playwright/test'

test('upstream change shows drift + DiffDrawer apply flow', async ({ page }) => {
  // Mock /v1/import/sources — source with drift status
  await page.route('**/v1/import/sources', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'src-drift-1',
          url: 'github.com/wshobson/agents',
          host: 'github.com',
          owner: 'wshobson',
          repo: 'agents',
          ref: 'main',
          kind: 'plugin',
          collection_slug: 'wshobson-agents',
          pinned: false,
          imported_at_sha: 'old1234',
          upstream_sha: 'new5678',
          status: 'drift',
          skill_count: 5,
          drift_summary: { new: 2, changed: 1, removed: 0 },
        },
      ]),
    })
  })

  // Mock the /refresh endpoint — preview returns the diff, apply returns a success payload
  await page.route('**/v1/import/sources/src-drift-1/refresh', async route => {
    const postData = route.request().postDataJSON()
    if (postData.mode === 'preview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source_id: 'src-drift-1',
          from_sha: 'old1234',
          to_sha: 'new5678',
          new: [
            { name: 'new-skill-1', description: 'Brand new skill' },
            { name: 'new-skill-2', description: 'Another new one' },
          ],
          changed: [{ name: 'updated-skill', description: 'Content changed upstream', forked_from_source: false }],
          removed: [],
        }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ applied: 3 }),
      })
    }
  })

  await page.goto('/browse')
  await expect(page.getByText(/wshobson/i).first()).toBeVisible()

  // Click the drift pill — it renders as "2 new · 1 changed"
  await page.getByRole('button', { name: /2 new.*1 changed/i }).click()

  // DiffDrawer opens
  await expect(page.getByText(/Upstream changes/i)).toBeVisible()
  await expect(page.getByText('new-skill-1')).toBeVisible()
  await expect(page.getByText('new-skill-2')).toBeVisible()
  await expect(page.getByText('updated-skill')).toBeVisible()

  // Apply 3 changes
  await page.getByRole('button', { name: /Apply 3 changes/i }).click()
  await expect(page.getByText(/Applied 3 changes/i)).toBeVisible({ timeout: 5000 })
})
