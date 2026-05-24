/**
 * Round 7 — conflict policy switcher (per-integration) and
 * optimistic conflict resolve. Before this round, users with many
 * conflicts had to manually resolve each one because no UI exposed
 * `conflict_policy`. The switcher lets them pick "SkillNote wins" /
 * "claude.ai wins" so the backend auto-resolves future conflicts.
 */

import { test, expect, type Page } from '@playwright/test'

interface MockIntegration {
  id: string
  browser_label: string
  status: string
  scope: 'personal' | 'organization' | 'both'
  claude_ai_org_id: string | null
  last_sync_at: string | null
  last_error: string | null
  conflict_policy: 'ask' | 'skillnote_wins' | 'claude_ai_wins'
  pending_op_count: number
  failed_op_count: number
  linked_skill_count: number
}

interface MockState {
  integration: MockIntegration
  patchCalls: Array<{ id: string; body: Record<string, unknown> }>
  conflicts: Array<{
    link_id: string
    integration_id: string
    integration_label: string | null
    skillnote_skill_id: string | null
    skillnote_skill_slug: string | null
    skillnote_skill_name: string | null
    claude_ai_skill_id: string
    claude_ai_version: string | null
    last_seen_at: string | null
  }>
  resolveCalls: Array<{ link_id: string; resolution: string }>
}

function makeState(): MockState {
  return {
    integration: {
      id: 'int-1',
      browser_label: 'Chrome on Mac',
      status: 'active',
      scope: 'both',
      claude_ai_org_id: null,
      last_sync_at: null,
      last_error: null,
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 0,
      linked_skill_count: 0,
    },
    patchCalls: [],
    conflicts: [],
    resolveCalls: [],
  }
}

async function wireMocks(page: Page, state: MockState) {
  await page.route('**/v1/integrations/claude-ai/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        integrations_active: 1,
        integrations_with_errors: 0,
        pending_ops_total: 0,
        failed_ops_total: 0,
        diverged_links_total: state.conflicts.length,
        last_audit_at: null,
        schema_version: '0020_claude_ai_polish',
      }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([state.integration]),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/integrations/*', async (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/').pop()!
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      state.patchCalls.push({ id, body })
      if (body.conflict_policy) state.integration.conflict_policy = body.conflict_policy
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.integration),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.integration),
    })
  })
  await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.conflicts),
    }),
  )
  await page.route(
    '**/v1/integrations/claude-ai/conflicts/*/resolve',
    async (route) => {
      const url = new URL(route.request().url())
      const m = url.pathname.match(/conflicts\/([^/]+)\/resolve/)
      const link_id = m?.[1] ?? ''
      const body = JSON.parse(route.request().postData() ?? '{}')
      state.resolveCalls.push({ link_id, resolution: body.resolution })
      state.conflicts = state.conflicts.filter((c) => c.link_id !== link_id)
      return route.fulfill({ status: 204, body: '' })
    },
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  )
}

test.describe('conflict policy switcher', () => {
  test('renders all three options with the current value pressed', async ({ page }) => {
    const state = makeState()
    state.integration.conflict_policy = 'skillnote_wins'
    await wireMocks(page, state)
    await page.goto('/settings/integrations/claude-ai')

    const group = page.getByRole('radiogroup', { name: /Conflict resolution policy/i })
    await expect(group).toBeVisible()
    await expect(group.getByRole('radio', { name: 'Ask me' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await expect(group.getByRole('radio', { name: 'SkillNote wins' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(group.getByRole('radio', { name: /claude\.ai wins/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  test('clicking a different policy fires PATCH and updates aria-checked', async ({ page }) => {
    const state = makeState() // starts as 'ask'
    await wireMocks(page, state)
    await page.goto('/settings/integrations/claude-ai')

    await page.getByRole('radio', { name: 'claude.ai wins' }).click()

    await expect.poll(() => state.patchCalls).toEqual([
      { id: 'int-1', body: { conflict_policy: 'claude_ai_wins' } },
    ])
    await expect(
      page.getByRole('radio', { name: 'claude.ai wins' }),
    ).toHaveAttribute('aria-checked', 'true')
    await expect(
      page.getByRole('radio', { name: 'Ask me' }),
    ).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking the already-active option does not fire PATCH', async ({ page }) => {
    const state = makeState()
    state.integration.conflict_policy = 'ask'
    await wireMocks(page, state)
    await page.goto('/settings/integrations/claude-ai')

    await page.getByRole('radio', { name: 'Ask me' }).click()
    // Wait long enough that any patch would have landed.
    await page.waitForTimeout(300)
    expect(state.patchCalls).toEqual([])
  })
})

test.describe('bulk resolve all', () => {
  test('"Resolve all" menu only renders when 2+ conflicts exist', async ({ page }) => {
    const state = makeState()
    state.conflicts.push({
      link_id: 'l1',
      integration_id: 'int-1',
      integration_label: 'Chrome',
      skillnote_skill_id: 'sk-1',
      skillnote_skill_slug: 'one',
      skillnote_skill_name: 'one',
      claude_ai_skill_id: 'c-1',
      claude_ai_version: null,
      last_seen_at: new Date().toISOString(),
    })
    await wireMocks(page, state)
    await page.goto('/settings/integrations/claude-ai')

    // 1 conflict — bulk menu hidden.
    await expect(page.getByText(/Conflicts \(1\)/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Resolve all/ })).not.toBeVisible()

    // Add a second conflict and re-load.
    state.conflicts.push({
      link_id: 'l2',
      integration_id: 'int-1',
      integration_label: 'Chrome',
      skillnote_skill_id: 'sk-2',
      skillnote_skill_slug: 'two',
      skillnote_skill_name: 'two',
      claude_ai_skill_id: 'c-2',
      claude_ai_version: null,
      last_seen_at: new Date().toISOString(),
    })
    await page.reload()
    await expect(page.getByRole('button', { name: /Resolve all \(2\)/ })).toBeVisible()
  })

  test('clicking Keep SkillNote in the menu fires resolve for every conflict and clears the section', async ({
    page,
  }) => {
    const state = makeState()
    state.conflicts = ['a', 'b', 'c'].map((slug) => ({
      link_id: `link-${slug}`,
      integration_id: 'int-1',
      integration_label: 'Chrome',
      skillnote_skill_id: `sk-${slug}`,
      skillnote_skill_slug: slug,
      skillnote_skill_name: slug,
      claude_ai_skill_id: `c-${slug}`,
      claude_ai_version: null,
      last_seen_at: new Date().toISOString(),
    }))
    await wireMocks(page, state)
    await page.goto('/settings/integrations/claude-ai')

    await page.getByRole('button', { name: /Resolve all \(3\)/ }).click()
    await page.getByRole('menuitem', { name: /Keep SkillNote.*for all/i }).click()

    await expect.poll(() =>
      state.resolveCalls.map((r) => r.link_id).sort(),
    ).toEqual(['link-a', 'link-b', 'link-c'])
    // Section disappears (since `conflicts` is mock-cleared by the route).
    await expect(page.getByText(/^Conflicts \(/)).not.toBeVisible()
  })

  test('menu closes on Escape without firing any resolve', async ({ page }) => {
    const state = makeState()
    state.conflicts = ['a', 'b'].map((slug) => ({
      link_id: `link-${slug}`,
      integration_id: 'int-1',
      integration_label: 'Chrome',
      skillnote_skill_id: `sk-${slug}`,
      skillnote_skill_slug: slug,
      skillnote_skill_name: slug,
      claude_ai_skill_id: `c-${slug}`,
      claude_ai_version: null,
      last_seen_at: new Date().toISOString(),
    }))
    await wireMocks(page, state)
    await page.goto('/settings/integrations/claude-ai')

    await page.getByRole('button', { name: /Resolve all \(2\)/ }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).not.toBeVisible()
    expect(state.resolveCalls).toEqual([])
  })
})

test.describe('optimistic conflict resolve', () => {
  test('Keep SkillNote removes the row immediately without waiting for poll', async ({
    page,
  }) => {
    const state = makeState()
    state.conflicts.push({
      link_id: 'link-x',
      integration_id: 'int-1',
      integration_label: 'Chrome on Mac',
      skillnote_skill_id: 'sk-1',
      skillnote_skill_slug: 'pdf-extractor',
      skillnote_skill_name: 'pdf-extractor',
      claude_ai_skill_id: 'skill_ext_1',
      claude_ai_version: 'v2',
      last_seen_at: new Date().toISOString(),
    })
    // Make resolve slow so we can verify optimism specifically.
    await page.route(
      '**/v1/integrations/claude-ai/conflicts/*/resolve',
      async (route) => {
        const url = new URL(route.request().url())
        const m = url.pathname.match(/conflicts\/([^/]+)\/resolve/)
        const link_id = m?.[1] ?? ''
        const body = JSON.parse(route.request().postData() ?? '{}')
        state.resolveCalls.push({ link_id, resolution: body.resolution })
        state.conflicts = state.conflicts.filter((c) => c.link_id !== link_id)
        // Pause 800ms before responding to simulate network latency.
        await new Promise((r) => setTimeout(r, 800))
        return route.fulfill({ status: 204, body: '' })
      },
    )
    await wireMocks(page, state) // health/integrations/conflicts/activity routes
    await page.goto('/settings/integrations/claude-ai')

    await expect(page.getByText('pdf-extractor')).toBeVisible()
    await page.getByRole('button', { name: 'Keep SkillNote' }).click()
    // The row should disappear within ~50ms of the click — way before the
    // 800ms backend response.
    await expect(page.getByText('pdf-extractor')).not.toBeVisible({
      timeout: 500,
    })
  })
})
