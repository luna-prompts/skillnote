// Journey: unlink a source but keep the imported skills as local-only
//
// Scenario: A user visits /browse, opens a source's ⋯ menu, picks
// "Unlink source...". A confirmation modal offers two options:
// "Keep skills as local-only" vs "Remove skills too". They pick keep.
// After the DELETE, the toast confirms and the source disappears from the list.
import { test, expect } from '@playwright/test'

test('unlink source with keep-skills option', async ({ page }) => {
  let listCount = 0
  await page.route('**/v1/import/sources', async route => {
    listCount++
    // First call returns the source; subsequent calls (after unlink) return empty.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        listCount === 1
          ? [
              {
                id: 'src-unlink-1',
                url: 'github.com/wshobson/agents',
                host: 'github.com',
                owner: 'wshobson',
                repo: 'agents',
                ref: 'main',
                kind: 'plugin',
                collection_slug: 'wshobson-agents',
                pinned: false,
                imported_at_sha: 'abc1234',
                upstream_sha: 'abc1234',
                status: 'up_to_date',
                skill_count: 4,
              },
            ]
          : []
      ),
    })
  })

  // DELETE with remove_skills=false — keep-skills branch
  await page.route('**/v1/import/sources/src-unlink-1*', async route => {
    const url = route.request().url()
    expect(url).toContain('remove_skills=false')
    expect(route.request().method()).toBe('DELETE')
    await route.fulfill({ status: 204, body: '' })
  })

  await page.goto('/browse')

  // Source card visible
  await expect(page.getByText(/wshobson\/agents/i)).toBeVisible()

  // Open the ⋯ menu
  await page.getByRole('button', { name: /Source actions/i }).click()
  // Click "Unlink source..."
  await page.getByRole('menuitem', { name: /Unlink source/i }).click()

  // Confirm modal shows both options
  await expect(page.getByRole('dialog', { name: /Unlink source/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Keep skills as local-only/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Remove skills too/i })).toBeVisible()

  // Pick "keep skills as local-only"
  await page.getByRole('button', { name: /Keep skills as local-only/i }).click()

  // Toast confirms the unlink
  await expect(page.getByText(/skills kept as local-only/i)).toBeVisible({ timeout: 5000 })

  // Source gone from the list
  await expect(page.getByText(/wshobson\/agents/i)).not.toBeVisible({ timeout: 5000 })
})
