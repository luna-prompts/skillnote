import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('a11y — /browse page', () => {
  test('empty state has no critical a11y violations', async ({ page }) => {
    await page.route('**/v1/import/sources', async route => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/browse')
    await page.getByText(/Pull in skills/i).waitFor({ state: 'visible' })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // color-contrast: sidebar footer + muted-foreground/40 hint text are
      // intentional design-system choices; deferred for v1.
      .disableRules(['color-contrast'])
      .analyze()

    const violations = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )
    expect(violations, `Violations:\n${violations.map(v => `  - ${v.id} (${v.impact}): ${v.description}`).join('\n')}`).toEqual([])
  })

  test('sources list state has no critical a11y violations', async ({ page }) => {
    await page.route('**/v1/import/sources', async route => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          id: 'src-a11y-1', url: 'github.com/test/repo',
          host: 'github.com', owner: 'test', repo: 'repo', ref: 'main',
          kind: 'plugin', collection_slug: 'test-repo', pinned: false,
          imported_at_sha: 'abc1234', upstream_sha: 'abc1234',
          status: 'up_to_date', skill_count: 3,
        }]),
      })
    })

    await page.goto('/browse')
    await page.getByText(/test\/repo/i).waitFor({ state: 'visible' })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // color-contrast: sidebar footer + source-card muted text are
      // intentional design-system choices; deferred for v1.
      .disableRules(['color-contrast'])
      .analyze()

    const violations = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )
    expect(violations, `Violations:\n${violations.map(v => `  - ${v.id} (${v.impact}): ${v.description}`).join('\n')}`).toEqual([])
  })
})
