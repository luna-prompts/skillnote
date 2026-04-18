// Journey: conflict rename
//
// Scenario: A user imports `wshobson/agents`. The inspect preview lists 3 skills,
// one of which (`python-expert`) collides with a skill the user already has locally.
// On apply, the backend renames the incoming skill to `python-expert-2` and the
// frontend shows an import-success toast that reflects the number imported.
import { test, expect } from '@playwright/test'

test('import auto-renames conflicting skill and imports all 3', async ({ page }) => {
  await page.route('**/v1/import/inspect', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: {
          source_type: 'github',
          host: 'github.com',
          owner: 'wshobson',
          repo: 'agents',
          ref: 'main',
          resolved_sha: 'abc123',
        },
        kind: 'plugin',
        skills: [
          { name: 'python-expert', description: 'Python review heuristics' },
          { name: 'react-tuner', description: 'React perf hints' },
          { name: 'go-doctor', description: 'Go profiling tips' },
        ],
        warnings: [],
        suggested_collection_slug: 'wshobson-agents',
      }),
    })
  })

  // Apply returns python-expert renamed to python-expert-2 because it conflicts
  // with an existing user-authored skill.
  await page.route('**/v1/import/apply', async route => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        source_id: 'src-rename-1',
        collection_slug: 'wshobson-agents',
        imported: [
          {
            name: 'python-expert-2',
            slug: 'python-expert-2',
            original_name: 'python-expert',
            renamed_reason: 'conflict',
          },
          { name: 'react-tuner', slug: 'react-tuner' },
          { name: 'go-doctor', slug: 'go-doctor' },
        ],
        skipped: [],
      }),
    })
  })

  // /v1/import/sources is called on page load and again after apply
  let listCount = 0
  await page.route('**/v1/import/sources', async route => {
    listCount++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        listCount === 1
          ? []
          : [
              {
                id: 'src-rename-1',
                url: 'github.com/wshobson/agents',
                host: 'github.com',
                owner: 'wshobson',
                repo: 'agents',
                ref: 'main',
                kind: 'plugin',
                collection_slug: 'wshobson-agents',
                pinned: false,
                imported_at_sha: 'abc123',
                upstream_sha: 'abc123',
                status: 'up_to_date',
                skill_count: 3,
              },
            ]
      ),
    })
  })

  await page.goto('/browse')
  await page.getByRole('button', { name: /Paste a URL/i }).click()

  const input = page.getByPlaceholder(/wshobson\/agents/i)
  await input.fill('wshobson/agents')
  await input.blur()

  // Preview lists all 3 skills
  await expect(page.getByRole('button', { name: /python-expert/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /react-tuner/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /go-doctor/i })).toBeVisible()

  await page.getByRole('button', { name: /Import 3 skills/i }).click()

  // Toast confirms the import — 3 skills imported from wshobson/agents
  await expect(page.getByText(/Imported 3 skills from wshobson\/agents/i)).toBeVisible({ timeout: 5000 })
})
