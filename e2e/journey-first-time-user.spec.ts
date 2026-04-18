import { test, expect } from '@playwright/test'

test('first-time user imports wshobson/agents', async ({ page }) => {
  // Mock /v1/import/inspect
  await page.route('**/v1/import/inspect', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        source: { source_type: 'github', host: 'github.com', owner: 'wshobson', repo: 'agents', ref: 'main', resolved_sha: 'abc123' },
        kind: 'plugin',
        skills: [
          { name: 'python-expert', description: 'Python code-review heuristics' },
          { name: 'react-tuner', description: 'React perf hints' },
        ],
        warnings: [],
        suggested_collection_slug: 'wshobson-agents',
      }),
    })
  })

  // Mock /v1/import/apply
  await page.route('**/v1/import/apply', async route => {
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        source_id: 'src-1', collection_slug: 'wshobson-agents',
        imported: [{ name: 'python-expert', slug: 'python-expert' }, { name: 'react-tuner', slug: 'react-tuner' }],
        skipped: [],
      }),
    })
  })

  // Mock /v1/import/sources (empty initially, populated after apply)
  let listCount = 0
  await page.route('**/v1/import/sources', async route => {
    listCount++
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(listCount === 1 ? [] : [{
        id: 'src-1', url: 'github.com/wshobson/agents',
        host: 'github.com', owner: 'wshobson', repo: 'agents', ref: 'main',
        kind: 'plugin', collection_slug: 'wshobson-agents', pinned: false,
        imported_at_sha: 'abc123', upstream_sha: 'abc123',
        status: 'up_to_date', skill_count: 2,
      }]),
    })
  })

  await page.goto('/browse')
  await expect(page.getByText('Pull in skills from the community.')).toBeVisible()
  await page.getByRole('button', { name: /Paste a URL/i }).click()

  const input = page.getByPlaceholder(/wshobson\/agents/i)
  await input.fill('wshobson/agents')
  await input.blur()

  await expect(page.getByText(/github.com\/wshobson\/agents/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /python-expert/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /react-tuner/i })).toBeVisible()

  await page.getByRole('button', { name: /Import 2 skills/i }).click()
  await expect(page.getByText(/Imported 2 skills from wshobson\/agents/i)).toBeVisible({ timeout: 5000 })
})
