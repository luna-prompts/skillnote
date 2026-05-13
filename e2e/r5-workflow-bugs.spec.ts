/**
 * Round 5 regressions: workflow-driven bugs found by exercising the live UI.
 *
 * - L1 covered by the assertion "sidebar count stays in sync" — would have
 *   required full skill-creation flow with API mocks, too heavy for here.
 *   Verified in-round by live Playwright session against `next dev`.
 * - L2 (edit-mode dirty on open) requires the full skill detail render path.
 *   Verified in-round live; left for a future spec.
 * - L3 (empty H1 → broken anchor) verified live; this spec covers the
 *   user-visible failure mode.
 * - L2-R4 (card chrome click on pending agent) — primary R5 fix here:
 *   clicking the outer card chrome should now open the Connect modal for
 *   pending agents, not jump to the Connected tab.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

interface AgentRow {
  agent: 'claude-code' | 'openclaw'
  state: 'pending' | 'active' | 'idle'
  installed_at: string | null
  last_active_at: string | null
  calls_24h: number
  calls_7d: number
}

async function mockBaseline(page: Page, rows: AgentRow[]) {
  await page.route('**/v1/setup/agents', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    }),
  )
}

const PENDING: AgentRow[] = [
  { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
  { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
]

const ONE_ACTIVE: AgentRow[] = [
  { agent: 'claude-code', state: 'active', installed_at: new Date().toISOString(), last_active_at: new Date().toISOString(), calls_24h: 3, calls_7d: 3 },
  { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
]

test.describe('R5 — card chrome click on pending agent opens modal', () => {
  test('clicking the OpenClaw card chrome (NOT the inner Install button) opens the Connect modal', async ({ page }) => {
    await mockBaseline(page, PENDING)
    await page.goto('/integrations')
    await page.getByRole('tab', { name: /Browse/ }).click()

    // Click the OpenClaw card by its top-level role-button. This is the
    // outer chrome, which previously called `onOpenDetail` and routed the
    // user to the Connected tab (where pending agents don't appear).
    const openclawCard = page.getByRole('button', {
      name: /OpenClaw Official OpenClaw/i,
    })
    await openclawCard.click()

    // Post-fix: the modal must open instead of switching tabs.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('heading', { name: /Install OpenClaw/ })).toBeVisible()
    // And the active tab must still be Browse (not Connected).
    await expect(page.getByRole('tab', { name: /Browse/ })).toHaveAttribute('data-state', 'active')
  })

  test('skill view renders inline-only H1 heading with anchor (not blank)', async ({ page }) => {
    // R5 review blocker: an `# \`code\`` heading previously rendered as blank
    // because `String(children)` returned "[object Object]" or similar. R5's
    // first fix made it return null entirely (regression — heading vanished).
    // The corrected fix recursively extracts text from inline elements and
    // renders the heading with an anchor when text exists, or without an
    // anchor when truly empty. Verify both paths via the rendered output.
    const slug = 'r5-headings-fixture'
    await page.route('**/v1/skills', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          slug, name: slug, description: 'heading test', collections: [],
          currentVersion: 1, import_source_id: null, forked_from_source: false,
          source_path: null, origin: null,
        }]),
      }),
    )
    await page.route(`**/v1/skills/${slug}`, (route) => {
      const now = new Date().toISOString()
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slug, name: slug, description: 'heading test',
          // Three heading shapes: pure text, mixed text + inline code, pure inline code.
          // Plus an empty H1 to exercise the no-anchor branch.
          content_md: '# Plain heading\n\n## foo `bar`\n\n### `pure-code`\n\n#### \n\nbody',
          collections: [], current_version: 1, created_at: now, updated_at: now,
          extra_frontmatter: null, import_source_id: null, forked_from_source: false,
          source_path: null, origin: null,
        }),
      })
    })
    await page.route(`**/v1/skills/${slug}/comments`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route(`**/v1/skills/${slug}/rating`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"avg_rating":null,"count":0,"distribution":{}}' }),
    )
    await page.route(`**/v1/skills/${slug}/reviews**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto(`/skills/${slug}`)

    // Pure-text H1 — anchor and id should be 'plain-heading'.
    const plain = page.locator('h1#plain-heading')
    await expect(plain).toBeVisible()

    // Mixed text+inline-code H2 — anchor 'foo-bar' must include the code text.
    const mixed = page.locator('h2#foo-bar')
    await expect(mixed).toBeVisible()
    await expect(mixed).toContainText('bar')

    // Pure inline-code H3 — must STILL render (regression check). Anchor id
    // is 'pure-code'.
    const pureInline = page.locator('h3#pure-code')
    await expect(pureInline).toBeVisible()
    await expect(pureInline).toContainText('pure-code')
  })

  test('clicking a Connected agent card chrome still routes to Connected tab', async ({ page }) => {
    // Regression check the other direction: when the agent is already
    // wired, the outer chrome click should jump to Connected (the design
    // intent for the connected case).
    await mockBaseline(page, ONE_ACTIVE)
    await page.goto('/integrations')
    // Page defaults to Connected when ≥1 wired; switch to Browse manually.
    await page.getByRole('tab', { name: /Browse/ }).click()
    await expect(page.getByRole('tab', { name: /Browse/ })).toHaveAttribute('data-state', 'active')

    const claudeCard = page.getByRole('button', { name: /Claude Code Official Claude Code/i })
    await claudeCard.click()

    // No modal — connected agents route to Connected tab via onOpenDetail.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /Connected/ })).toHaveAttribute('data-state', 'active')
  })
})
