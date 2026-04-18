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

  test('NewCollectionModal surfaces 409 duplicate as inline error, modal stays open', async ({ page }) => {
    let postAttempts = 0
    await page.route('**/v1/collections', async route => {
      if (route.request().method() === 'POST') {
        postAttempts++
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'COLLECTION_EXISTS', message: 'Collection "dup-test" already exists' },
          }),
        })
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify([{ name: 'dup-test', count: 0, description: '' }]),
        })
      }
    })
    await page.route('**/v1/skills*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const dialog = page.getByRole('dialog')
    const name = dialog.getByPlaceholder(/e\.g\./i)
    await name.fill('dup-test')
    await dialog.getByRole('button', { name: /^create$/i }).click()

    // Modal must stay open
    await expect(dialog).toBeVisible()
    // Inline error visible
    await expect(dialog.getByText(/already exists/i)).toBeVisible()
    // localStorage ghost NOT written
    const meta = await page.evaluate(() => localStorage.getItem('skillnote:collections-meta'))
    expect(meta === null || !JSON.parse(meta)['dup-test']).toBe(true)
    expect(postAttempts).toBe(1)
  })

  test('NewCollectionModal falls back to local save on network error only', async ({ page }) => {
    await page.route('**/v1/collections', async route => {
      if (route.request().method() === 'POST') {
        await route.abort('failed')  // simulate network error
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify([]),
        })
      }
    })
    await page.route('**/v1/skills*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const dialog = page.getByRole('dialog')
    const name = dialog.getByPlaceholder(/e\.g\./i)
    await name.fill('offline-save')
    await dialog.getByRole('button', { name: /^create$/i }).click()

    // Modal closes (offline fallback preserves work)
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
    // localStorage DOES contain the entry
    const meta = await page.evaluate(() => localStorage.getItem('skillnote:collections-meta'))
    expect(meta).not.toBeNull()
    expect(JSON.parse(meta as string)['offline-save']).toBeTruthy()
  })
})
