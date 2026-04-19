// Journey: fork warning on first edit of an imported skill
//
// Scenario: A user opens an imported skill that has never been edited locally
// (`import_source_id` is set, `forked_from_source` is false). They switch to
// the edit tab, modify content, and hit Save. Because the skill is still
// tracking upstream, a fork-confirm modal appears explaining that editing
// creates a local fork. They click "Fork and save" to proceed.
import { test, expect } from '@playwright/test'

test('editing an imported skill surfaces the fork-confirm modal', async ({ page }) => {
  const skillSlug = 'python-expert'

  // Mock the skill detail endpoint — imported, not yet forked
  await page.route(`**/v1/skills/${skillSlug}`, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'skill-1',
        name: 'python-expert',
        slug: skillSlug,
        description: 'Python code-review heuristics',
        content_md: '# Python Expert\n\nOriginal upstream content.',
        collections: ['wshobson-agents'],
        current_version: 1,
        extra_frontmatter: '',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        import_source_id: 'src-fork-1',
        forked_from_source: false,
        source_path: 'github.com/wshobson/agents/skills/python-expert',
      }),
    })
  })

  // /v1/skills list (used by skills-store sync + command palette)
  await page.route('**/v1/skills', async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          name: 'python-expert',
          slug: skillSlug,
          description: 'Python code-review heuristics',
          collections: ['wshobson-agents'],
          content_md: '# Python Expert\n\nOriginal upstream content.',
          currentVersion: 1,
          import_source_id: 'src-fork-1',
          forked_from_source: false,
          source_path: 'github.com/wshobson/agents/skills/python-expert',
        },
      ]),
    })
  })

  // Comments and ratings are best-effort; respond with empty shapes.
  await page.route(`**/v1/skills/${skillSlug}/comments`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.route(`**/v1/analytics/ratings/${skillSlug}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ avg_rating: 0, rating_count: 0, versions: [] }),
    })
  })
  await page.route(`**/v1/analytics/ratings/${skillSlug}/reviews*`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  await page.goto(`/skills/${skillSlug}`)

  // Enter edit mode via the "Edit Skill" button
  await page.getByRole('button', { name: /Edit Skill/i }).first().click()

  // Wait for the edit UI to render — the name input shows the current title
  await expect(page.getByRole('button', { name: /Save as v2/i })).toBeVisible()

  // Modify the description so the edit is definitely dirty — the description
  // textarea is reachable via its current value.
  const desc = page.locator('textarea').first()
  await desc.fill('Python code-review heuristics (edited)')

  // Click save — should open the fork-confirm modal, NOT the save-confirm modal
  await page.getByRole('button', { name: /Save as v2/i }).click()

  // Fork-confirm modal copy
  await expect(page.getByRole('dialog', { name: /Fork this skill/i })).toBeVisible()
  await expect(page.getByText(/github\.com\/wshobson\/agents/i)).toBeVisible()

  // "Fork and save" continues the flow
  await expect(page.getByRole('button', { name: /Fork and save/i })).toBeVisible()
})
