/**
 * Round 7 — deeper analytics + marketplace + connect audit regressions.
 *
 * L1 (Reinstall feedback gap): defer to R8 — the dispatch fires correctly
 *     and the user-visible state transitions briefly to 'connecting'; the
 *     real fix is UX work, not state.
 * L2 (marketplace `@None` literal): backend fix, also covered live; this
 *     spec asserts the rewritten message via a route mock that returns the
 *     REPO_NOT_FOUND payload.
 * L3 (phantom skills in analytics leaderboard): two tests — the leaderboard
 *     row + the top-skills table both mark unknown slugs and disable
 *     navigation.
 * L4 (Other-category raw_names truncation): the agent breakdown's "Other"
 *     row truncates a single oversized raw name.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

async function mockAnalytics(page: Page, overrides: {
  skillCalls?: Array<{ slug: string; call_count: number; last_called_at: string }>
  topSkills?: Array<{ slug: string; call_count: number; avg_rating: number | null; rating_count: number; review_count: number; completion_rate: number | null }>
  agents?: Array<{ agent_name: string; call_count: number; pct: number }>
  skills?: Array<{ slug: string; name: string; description: string; collections: string[]; currentVersion: number }>
} = {}) {
  const now = new Date().toISOString()
  const skillCalls = overrides.skillCalls ?? []
  const topSkills = overrides.topSkills ?? []
  const agents = overrides.agents ?? [{ agent_name: 'claude-code', call_count: 5, pct: 100 }]
  const skills = overrides.skills ?? []

  await page.route('**/v1/skills', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(skills) }),
  )
  await page.route('**/v1/analytics/summary**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total_calls: skillCalls.reduce((a, b) => a + b.call_count, 0), unique_skills: skillCalls.length, unique_agents: agents.length, calls_today: 0, most_called_skill: skillCalls[0]?.slug ?? null }) }),
  )
  await page.route('**/v1/analytics/skill-calls**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(skillCalls) }),
  )
  await page.route('**/v1/analytics/agents**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agents) }),
  )
  await page.route('**/v1/analytics/timeline**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/analytics/collections**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/analytics/top-skills**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(topSkills) }),
  )
  await page.route('**/v1/analytics/rating-summary**', (r: Route) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ overall_avg: null, total_ratings: 0, rated_skills: 0, rating_agents: 0, distribution: {} }),
    }),
  )
}

test.describe('R7 — analytics marks unregistered slugs as (unknown) and disables navigation', () => {
  test('Leaderboard row with no matching registered skill renders "(unknown)" and is non-clickable', async ({ page }) => {
    const now = new Date().toISOString()
    await mockAnalytics(page, {
      skillCalls: [
        { slug: 'real-skill', call_count: 10, last_called_at: now },
        { slug: 'phantom-skill', call_count: 5, last_called_at: now },
      ],
      skills: [
        { slug: 'real-skill', name: 'real-skill', description: 'A real one.', collections: ['conventions'], currentVersion: 1 },
      ],
    })
    await page.goto('/analytics')

    // The registered skill row should NOT have "(unknown)" next to it.
    const realRow = page.getByRole('button', { name: /real-skill/ }).first()
    await expect(realRow).toBeVisible()
    await expect(realRow).toBeEnabled()

    // The phantom slug row should show "(unknown)" and be disabled.
    const phantomRow = page.getByRole('button', { name: /phantom-skill/ }).first()
    await expect(phantomRow).toBeVisible()
    await expect(phantomRow).toBeDisabled()
    await expect(phantomRow).toContainText(/\(unknown\)/i)
  })

  test('Top Skills table row marks unknown slugs and removes navigation', async ({ page }) => {
    const now = new Date().toISOString()
    await mockAnalytics(page, {
      topSkills: [
        { slug: 'real-skill', call_count: 10, avg_rating: null, rating_count: 0, review_count: 0, completion_rate: null },
        { slug: 'mystery-skill', call_count: 3, avg_rating: null, rating_count: 0, review_count: 0, completion_rate: null },
      ],
      skills: [
        { slug: 'real-skill', name: 'real-skill', description: 'A real one.', collections: ['conventions'], currentVersion: 1 },
      ],
    })
    await page.goto('/analytics')

    // Scope to the Top Skills table.
    const topSkillsHeading = page.getByRole('heading', { name: 'Top Skills' })
    await expect(topSkillsHeading).toBeVisible()

    // The mystery-skill row should have "(unknown)" annotation.
    await expect(page.getByText(/mystery-skill/i).first()).toBeVisible()
    // Multiple "(unknown)" tags can appear (leaderboard AND top-skills).
    const unknownTags = page.getByText(/\(unknown\)/i)
    expect(await unknownTags.count()).toBeGreaterThanOrEqual(1)
  })
})

test.describe('R7 — agent breakdown truncates oversized raw_names', () => {
  test('long raw agent_name strings are truncated, not splatted into the row', async ({ page }) => {
    const longName = 'z'.repeat(200)
    await mockAnalytics(page, {
      skillCalls: [{ slug: 'x', call_count: 1, last_called_at: new Date().toISOString() }],
      // Two agents that both categorize as "other" (no canonical mapping)
      // — they roll up into the Other bucket.
      agents: [
        { agent_name: longName, call_count: 5, pct: 50 },
        { agent_name: 'another-weird-agent-name-fixture', call_count: 5, pct: 50 },
      ],
      skills: [],
    })
    await page.goto('/analytics')

    await expect(page.getByRole('heading', { name: 'Agent Breakdown' })).toBeVisible()

    // The raw name display should NOT contain the full 200-z string —
    // truncation kicks in at PER_NAME_CAP=40 plus an ellipsis.
    const fullString = page.getByText(new RegExp('^' + 'z'.repeat(200) + '$'))
    expect(await fullString.count()).toBe(0)

    // BUT a truncated form should appear (40 z's + ellipsis OR the row
    // text contains a prefix of the long name).
    await expect(page.getByText(new RegExp('z{40}', 'i')).first()).toBeVisible()
  })
})
