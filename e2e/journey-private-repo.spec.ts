// Journey: private repo — 401 REPO_PRIVATE error in the ImportSheet
//
// Scenario: A user pastes the URL for a private GitHub repo. Inspect returns
// 401 with `error.code = REPO_PRIVATE` and a human-readable message asking
// for a GitHub token. The ImportSheet surfaces the error in its error slot.
import { test, expect } from '@playwright/test'

test('private repo inspect shows REPO_PRIVATE error', async ({ page }) => {
  // /v1/import/sources is called on browse mount — empty
  await page.route('**/v1/import/sources', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  // Inspect returns 401 REPO_PRIVATE
  await page.route('**/v1/import/inspect', async route => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'REPO_PRIVATE', message: 'Add a GitHub token to continue' },
      }),
    })
  })

  await page.goto('/browse')
  await page.getByRole('button', { name: /Paste a URL/i }).click()

  const input = page.getByPlaceholder(/wshobson\/agents/i)
  await input.fill('private-org/secret-repo')
  await input.blur()

  // ImportSheet shows the error message
  await expect(page.getByText(/Add a GitHub token to continue/i)).toBeVisible({ timeout: 5000 })
})
