/**
 * E2E: Collection name validation in NewCollectionModal
 *
 * All API calls are mocked via page.route() so tests run without a backend.
 */

import { test, expect } from '@playwright/test'

test.describe('Collection name validation', () => {
  test.beforeEach(async ({ page }) => {
    // Skills list (collections page calls syncSkillsFromApi on mount)
    await page.route('**/v1/skills', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      })
    })

    // Mock the collections list
    await page.route('**/v1/collections', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ name: 'frontend', count: 0, description: '' }]),
      })
    })
  })

  test('NewCollectionModal rejects uppercase names', async ({ page }) => {
    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const name = page.getByPlaceholder(/e\.g\./i)
    await name.fill('Frontend')
    await name.blur()
    await expect(page.getByText(/lowercase/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })

  test('NewCollectionModal accepts lowercase slug', async ({ page }) => {
    await page.route('**/v1/collections', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'devops', description: '',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }),
        })
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify([{ name: 'frontend', count: 0, description: '' }]),
        })
      }
    })

    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const name = page.getByPlaceholder(/e\.g\./i)
    await name.fill('devops')
    await expect(page.getByRole('button', { name: /^create$/i })).toBeEnabled()
  })

  test('NewCollectionModal rejects reserved word', async ({ page }) => {
    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const name = page.getByPlaceholder(/e\.g\./i)
    await name.fill('claude-stuff')
    await name.blur()
    await expect(page.getByText(/reserved word/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })
})
