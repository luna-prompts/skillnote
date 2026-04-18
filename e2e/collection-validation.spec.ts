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

  test('CollectionPicker inline create — 409 duplicate shows toast, no chip', async ({ page }) => {
    // Mock /v1/collections: GET returns an existing collection, POST always 409s
    await page.route('**/v1/collections', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'COLLECTION_EXISTS', message: 'Collection "dup-inline" already exists' },
          }),
        })
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify([{ name: 'existing-col', count: 0, description: '' }]),
        })
      }
    })
    // Skills list is empty so the "new skill" route renders cleanly
    await page.route('**/v1/skills*', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }))

    // /skills/new renders SkillEditTab in create mode, which embeds CollectionPicker
    await page.goto('/skills/new')

    // Inline CollectionPicker's trigger reads "Add collection" when no chips selected
    const addBtn = page.getByRole('button', { name: /^add collection$/i }).first()
    await expect(addBtn).toBeVisible({ timeout: 5000 })
    await addBtn.click()

    // Type a name that will 409 on create
    const search = page.getByPlaceholder(/search or create/i)
    await search.fill('dup-inline')

    // The "+ Create" row should appear — click it
    const createRow = page.getByRole('button', { name: /create ["\u201c]dup-inline["\u201d]/i })
    await expect(createRow).toBeVisible({ timeout: 2000 })
    await createRow.click()

    // Toast should appear with "already exists" content
    await expect(page.getByText(/already exists/i).first()).toBeVisible({ timeout: 5000 })

    // The chip "dup-inline" must NOT be rendered, because the API rejected.
    // Look specifically within the selected-chips row (the CollectionPicker root)
    // — the dropdown itself may still contain the text in the create-row button.
    // After rejection, dropdown stays open, so assert there is no chip with a
    // Remove button labelled for "dup-inline".
    await expect(
      page.getByRole('button', { name: /remove dup-inline/i })
    ).toHaveCount(0)

    // localStorage should NOT contain a ghost entry for dup-inline
    const meta = await page.evaluate(() => localStorage.getItem('skillnote:collections-meta'))
    expect(meta === null || !JSON.parse(meta)['dup-inline']).toBe(true)
  })
})
