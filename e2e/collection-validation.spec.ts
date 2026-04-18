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
    const dialog = page.getByRole('dialog')
    const name = dialog.getByPlaceholder(/e\.g\./i)
    await name.fill('Frontend')
    await name.blur()
    await expect(dialog.getByText(/lowercase/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })

  test('NewCollectionModal accepts lowercase slug and submits', async ({ page }) => {
    let postedBody: unknown = null
    await page.route('**/v1/collections', async route => {
      if (route.request().method() === 'POST') {
        postedBody = JSON.parse(route.request().postData() ?? '{}')
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
    const dialog = page.getByRole('dialog')
    const name = dialog.getByPlaceholder(/e\.g\./i)
    await name.fill('devops')
    const createBtn = dialog.getByRole('button', { name: /^create$/i })
    await expect(createBtn).toBeEnabled()
    await createBtn.click()
    await expect(dialog).not.toBeVisible()
    expect(postedBody).toEqual({ name: 'devops', description: '' })
  })

  test('NewCollectionModal rejects reserved word', async ({ page }) => {
    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const dialog = page.getByRole('dialog')
    const name = dialog.getByPlaceholder(/e\.g\./i)
    await name.fill('claude-stuff')
    await name.blur()
    await expect(dialog.getByText(/reserved word/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })

  test('NewCollectionModal rejects XML tags', async ({ page }) => {
    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const dialog = page.getByRole('dialog')
    const name = dialog.getByPlaceholder(/e\.g\./i)
    await name.fill('<script>')
    await name.blur()
    // The regex error fires first (uppercase S and <) — that's OK, still rejected
    await expect(dialog.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })
})
