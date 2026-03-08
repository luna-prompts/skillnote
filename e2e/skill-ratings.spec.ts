import { test, expect } from '@playwright/test'

test.describe('Skill Ratings', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the skills API
    await page.route('**/v1/skills', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { name: 'React Component', slug: 'react-component', description: 'Build React components', collections: [], currentVersion: 3 },
          { name: 'API Design', slug: 'api-design', description: 'Design REST APIs', collections: [], currentVersion: 1 },
        ]),
      }),
    )

    // Mock ratings list
    await page.route('**/v1/analytics/ratings', (route) => {
      if (route.request().url().includes('ratings/')) return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { slug: 'react-component', avg_rating: 4.3, rating_count: 18 },
        ]),
      })
    })
  })

  test('shows star rating on skill cards in grid view', async ({ page }) => {
    await page.goto('/')
    // Switch to grid view
    const gridButton = page.locator('button[aria-label="Grid view"]')
    if (await gridButton.isVisible()) await gridButton.click()

    // Check that star rating is visible for rated skill
    const card = page.locator('a[href="/skills/react-component"]')
    await expect(card.locator('text=4.3')).toBeVisible()
  })

  test('shows star rating on skill list items', async ({ page }) => {
    await page.goto('/')
    const listItem = page.locator('a[href="/skills/react-component"]')
    await expect(listItem.locator('text=4.3')).toBeVisible()
  })

  test('shows rating detail on skill detail page', async ({ page }) => {
    // Mock skill detail
    await page.route('**/v1/skills/react-component', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '1',
          name: 'React Component',
          slug: 'react-component',
          description: 'Build React components',
          content_md: '# React Component\n\nInstructions here.',
          collections: [],
          current_version: 3,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        }),
      }),
    )

    // Mock comments
    await page.route('**/v1/skills/react-component/comments', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    // Mock rating detail
    await page.route('**/v1/analytics/ratings/react-component', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slug: 'react-component',
          avg_rating: 4.3,
          rating_count: 18,
          versions: [
            { version: 3, avg_rating: 2.1, rating_count: 5 },
            { version: 2, avg_rating: 4.8, rating_count: 8 },
            { version: 1, avg_rating: 4.0, rating_count: 5 },
          ],
        }),
      }),
    )

    await page.goto('/skills/react-component')

    // Overall rating in meta pills
    await expect(page.locator('text=4.3')).toBeVisible()

    // Per-version breakdown (on lg+ screens)
    await expect(page.locator('text=Rating by Version')).toBeVisible()
    await expect(page.locator('text=v3').first()).toBeVisible()
    await expect(page.locator('text=2.1')).toBeVisible()
  })
})
