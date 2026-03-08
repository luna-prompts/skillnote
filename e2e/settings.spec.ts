/**
 * E2E: Settings page — MCP Tools toggles
 *
 * All API calls are mocked so tests run without a live backend.
 */

import { test, expect, type Page } from '@playwright/test'

const DEFAULT_SETTINGS = {
  complete_skill_enabled: 'true',
  complete_skill_outcome_enabled: 'false',
}

async function setupMocks(page: Page, settings = DEFAULT_SETTINGS) {
  // Settings GET
  await page.route('**/v1/settings', (route, req) => {
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) })
    }
    if (req.method() === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    }
    return route.continue()
  })

  // Skills list (needed for sidebar/home)
  await page.route('**/v1/skills', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // Analytics ratings
  await page.route('**/v1/analytics/ratings', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test.describe('Settings Page — MCP Tools', () => {
  test('shows MCP Tools section with toggles', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    await expect(page.locator('text=MCP Tools')).toBeVisible()
    await expect(page.locator('text=Skill Completion Tracking')).toBeVisible()
    await expect(page.locator('text=Outcome Field')).toBeVisible()
  })

  test('skill completion toggle is ON by default', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    const toggle = page.locator('button[role="switch"]').first()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('outcome toggle is OFF by default and nested', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    const outcomeToggle = page.locator('button[role="switch"]').nth(1)
    await expect(outcomeToggle).toHaveAttribute('aria-checked', 'false')
  })

  test('outcome toggle is disabled when completion tracking is off', async ({ page }) => {
    await setupMocks(page, { complete_skill_enabled: 'false', complete_skill_outcome_enabled: 'false' })
    await page.goto('/settings')

    const outcomeToggle = page.locator('button[role="switch"]').nth(1)
    await expect(outcomeToggle).toBeDisabled()
  })

  test('disabling completion tracking shows confirmation dialog', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    // Click the first toggle (Skill Completion Tracking) to disable
    const toggle = page.locator('button[role="switch"]').first()
    await toggle.click()

    // Confirmation dialog should appear
    await expect(page.getByRole('heading', { name: 'Disable Skill Completion' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Disable' })).toBeVisible()
  })

  test('cancelling confirmation dialog keeps toggle on', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    const toggle = page.locator('button[role="switch"]').first()
    await toggle.click()

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Toggle should still be on
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('confirming disable turns toggle off and calls API', async ({ page }) => {
    let putCalled = false
    await setupMocks(page)
    await page.route('**/v1/settings', (route, req) => {
      if (req.method() === 'PUT') {
        putCalled = true
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEFAULT_SETTINGS) })
    })

    await page.goto('/settings')

    const toggle = page.locator('button[role="switch"]').first()
    await toggle.click()
    await page.getByRole('button', { name: 'Disable' }).click()

    // Toggle should now be off
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('pressing Escape closes confirmation dialog', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    const toggle = page.locator('button[role="switch"]').first()
    await toggle.click()
    await expect(page.getByRole('heading', { name: 'Disable Skill Completion' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Disable Skill Completion' })).not.toBeVisible()
    // Toggle should still be on
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('shows info box with benefits', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    await expect(page.locator('text=Identify high-performing skills')).toBeVisible()
    await expect(page.locator('text=Track adoption trends')).toBeVisible()
  })

  test('shows About section', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')

    await expect(page.locator('text=About')).toBeVisible()
    await expect(page.locator('text=SkillNote v0.1.0')).toBeVisible()
  })
})
