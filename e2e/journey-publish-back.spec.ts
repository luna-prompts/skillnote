// Journey: publish-back banner on an imported collection's detail page
//
// Scenario: A user opens `/collections/my-tools`, which is backed by an
// imported source. The detail page shows an "Imported from …" banner with
// the upstream host/owner/repo and a "Manage source" link back to /browse.
//
// The publish-back URL itself is a backend-rendered JSON endpoint, so we
// exercise its UI proxy: the banner + the underlying source metadata.
import { test, expect } from '@playwright/test'

test('imported collection shows Imported-from banner on detail page', async ({ page }) => {
  // Collection detail fetch
  await page.route('**/v1/collections/my-tools', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'my-tools',
        description: 'Imported from GitHub',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    })
  })

  // Collections list — used for prev/next nav
  await page.route('**/v1/collections', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ name: 'my-tools', count: 3, description: 'Imported from GitHub' }]),
    })
  })

  // Import sources — drives the "Imported from" banner
  await page.route('**/v1/import/sources', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'src-pub-1',
          url: 'github.com/my-org/my-tools',
          host: 'github.com',
          owner: 'my-org',
          repo: 'my-tools',
          ref: 'main',
          kind: 'plugin',
          collection_slug: 'my-tools',
          pinned: false,
          imported_at_sha: 'abc1234',
          upstream_sha: 'abc1234',
          status: 'up_to_date',
          skill_count: 3,
        },
      ]),
    })
  })

  // Skills list — collection page pulls from it
  await page.route('**/v1/skills', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.goto('/collections/my-tools')

  // Banner renders with the upstream repo and a "Manage source" link.
  // Scope the "Imported from" match to the banner row so we don't collide
  // with the collection description, which happens to contain the same phrase.
  const banner = page.getByText(/Imported from github\.com\/my-org\/my-tools/i)
  await expect(banner).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('link', { name: /Manage source/i })).toBeVisible()
})
