/**
 * E2E: claude.ai integration settings page + pairing approval page.
 *
 * Phase 5 coverage. Mocks the backend's /v1/integrations/claude-ai/* surface
 * so this test runs without a live API.
 */

import { test, expect, type Page, type Route } from '@playwright/test'

interface IntegrationRow {
  id: string
  browser_label: string | null
  status: 'pending_approval' | 'active' | 'cookie_expired' | 'disconnected' | 'error'
  scope: 'personal' | 'organization' | 'both'
  claude_ai_org_id: string | null
  last_sync_at: string | null
  last_error: string | null
  conflict_policy: 'ask' | 'skillnote_wins' | 'claude_ai_wins'
  pending_op_count: number
  failed_op_count: number
  linked_skill_count: number
}

interface ConflictRow {
  link_id: string
  integration_id: string
  integration_label: string | null
  skillnote_skill_id: string | null
  skillnote_skill_slug: string | null
  skillnote_skill_name: string | null
  claude_ai_skill_id: string
  claude_ai_version: string | null
  last_seen_at: string | null
}

async function mockClaudeAI(
  page: Page,
  opts: {
    integrations?: IntegrationRow[]
    conflicts?: ConflictRow[]
    approveStatus?: number
    onDelete?: (route: Route) => void | Promise<void>
    onApprove?: (route: Route) => void | Promise<void>
    onResolve?: (route: Route) => void | Promise<void>
  } = {},
) {
  const integrations = opts.integrations ?? []
  const conflicts = opts.conflicts ?? []

  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(integrations),
    }),
  )
  await page.route(
    '**/v1/integrations/claude-ai/integrations/**',
    async (route) => {
      if (route.request().method() === 'DELETE') {
        if (opts.onDelete) return opts.onDelete(route)
        return route.fulfill({ status: 204, body: '' })
      }
      // PATCH passthrough — return updated row.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(integrations[0] ?? {}),
      })
    },
  )
  await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(conflicts),
    }),
  )
  await page.route(
    '**/v1/integrations/claude-ai/conflicts/*/resolve',
    async (route) => {
      if (opts.onResolve) return opts.onResolve(route)
      return route.fulfill({ status: 204, body: '' })
    },
  )
  await page.route(
    '**/v1/integrations/claude-ai/pair/approve',
    async (route) => {
      if (opts.onApprove) return opts.onApprove(route)
      return route.fulfill({ status: opts.approveStatus ?? 204, body: '' })
    },
  )
}

test.describe('/settings/integrations/claude-ai — main page', () => {
  test('renders empty state when no integrations paired', async ({ page }) => {
    await mockClaudeAI(page, { integrations: [] })
    await page.goto('/settings/integrations/claude-ai')

    await expect(
      page.getByRole('heading', { name: 'Sync to claude.ai' }),
    ).toBeVisible()
    await expect(
      page.getByText('No browsers connected yet'),
    ).toBeVisible()
    // Setup stepper is the discovery surface now — shown when no
    // integrations are active. Heading copy moved into the stepper.
    await expect(page.getByTestId('claude-ai-setup-stepper')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /Connect claude\.ai in 4 steps/ }),
    ).toBeVisible()
  })

  test('renders integration row with status pill and counters', async ({ page }) => {
    const row: IntegrationRow = {
      id: 'int-1',
      browser_label: 'Chrome on MacBook Pro',
      status: 'active',
      scope: 'both',
      claude_ai_org_id: 'org_01',
      last_sync_at: new Date().toISOString(),
      last_error: null,
      conflict_policy: 'ask',
      pending_op_count: 2,
      failed_op_count: 0,
      linked_skill_count: 12,
    }
    await mockClaudeAI(page, { integrations: [row] })
    await page.goto('/settings/integrations/claude-ai')

    await expect(page.getByText('Chrome on MacBook Pro')).toBeVisible()
    // Status is now human-friendly ("Connected"), not snake_case ("active").
    // Scope to the row so we don't match the stepper's "Connect" heading.
    const rowEl = page.getByTestId('integration-row-int-1')
    await expect(rowEl.getByLabel('Status: Connected')).toBeVisible()
    // Counter cards.
    await expect(page.getByText('Skills synced')).toBeVisible()
    await expect(page.getByText('12')).toBeVisible()
    // Disconnect button visible for active integrations.
    await expect(
      page.getByRole('button', { name: /Disconnect/i }),
    ).toBeVisible()
  })

  test('renders a friendly summary for a raw HTTP error, raw tucked behind details', async ({ page }) => {
    const row: IntegrationRow = {
      id: 'int-2',
      browser_label: 'Test',
      status: 'error',
      scope: 'both',
      claude_ai_org_id: null,
      last_sync_at: null,
      last_error: 'claude.ai endpoint returned 500',
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 3,
      linked_skill_count: 0,
    }
    await mockClaudeAI(page, { integrations: [row] })
    await page.goto('/settings/integrations/claude-ai')

    // Friendly summary shown; raw string is NOT the headline.
    await expect(page.getByTestId('integration-last-error-summary')).toContainText(
      'claude.ai returned an error (HTTP 500)',
    )
    // Raw detail is hidden until "Show details" is clicked.
    await expect(page.getByTestId('integration-last-error-detail')).toHaveCount(0)
    await page.getByTestId('integration-last-error-toggle').click()
    await expect(page.getByTestId('integration-last-error-detail')).toContainText(
      'claude.ai endpoint returned 500',
    )
  })

  test('translates a raw claude.ai JSON error into a human summary (no JSON dump)', async ({ page }) => {
    const row: IntegrationRow = {
      id: 'int-3',
      browser_label: 'Test',
      status: 'error',
      scope: 'both',
      claude_ai_org_id: null,
      last_sync_at: null,
      // The exact shape that previously dumped raw into the UI.
      last_error:
        'claude.ai /api/organizations/7d36e9d8/skills/upload-skill?overwrite=true returned 400 [{"type":"error","error":{"type":"invalid_request_error","message":"This skill name is already in use"}}]',
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 1,
      linked_skill_count: 0,
    }
    await mockClaudeAI(page, { integrations: [row] })
    await page.goto('/settings/integrations/claude-ai')

    const summary = page.getByTestId('integration-last-error-summary')
    await expect(summary).toContainText('already exists on claude.ai')
    // The raw JSON must NOT be the visible headline.
    await expect(summary).not.toContainText('invalid_request_error')
    await expect(summary).not.toContainText('{')
  })

  test('renders a conflict row with three resolution buttons', async ({ page }) => {
    const conflict: ConflictRow = {
      link_id: 'link-1',
      integration_id: 'int-1',
      integration_label: 'Chrome',
      skillnote_skill_id: 'sk-1',
      skillnote_skill_slug: 'pdf-extractor',
      skillnote_skill_name: 'pdf-extractor',
      claude_ai_skill_id: 'skill_ext_01',
      claude_ai_version: 'v3',
      last_seen_at: new Date().toISOString(),
    }
    await mockClaudeAI(page, { conflicts: [conflict] })
    await page.goto('/settings/integrations/claude-ai')

    // Conflict section heading.
    await expect(page.getByText(/Conflicts \(1\)/)).toBeVisible()
    await expect(page.getByText('pdf-extractor')).toBeVisible()

    // All three resolution buttons present.
    await expect(page.getByRole('button', { name: 'Keep SkillNote' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep claude.ai' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible()
  })

  test('clicking Keep SkillNote fires resolve POST', async ({ page }) => {
    const conflict: ConflictRow = {
      link_id: 'link-x',
      integration_id: 'int-1',
      integration_label: 'Chrome',
      skillnote_skill_id: 'sk-x',
      skillnote_skill_slug: 'my-skill',
      skillnote_skill_name: 'my-skill',
      claude_ai_skill_id: 'skill_ext_x',
      claude_ai_version: null,
      last_seen_at: null,
    }
    let resolveCalled: { url: string; body: string } | null = null
    await mockClaudeAI(page, {
      conflicts: [conflict],
      onResolve: async (route) => {
        resolveCalled = {
          url: route.request().url(),
          body: (route.request().postData() ?? ''),
        }
        await route.fulfill({ status: 204, body: '' })
      },
    })
    await page.goto('/settings/integrations/claude-ai')
    await page.getByRole('button', { name: 'Keep SkillNote' }).click()

    await expect.poll(() => resolveCalled).not.toBeNull()
    expect(resolveCalled!.url).toContain('/conflicts/link-x/resolve')
    expect(JSON.parse(resolveCalled!.body)).toEqual({ resolution: 'keep_skillnote' })
  })
})

test.describe('/settings/integrations/claude-ai/pair — approval page', () => {
  test('shows missing-code state when no ?code= param', async ({ page }) => {
    await mockClaudeAI(page)
    await page.goto('/settings/integrations/claude-ai/pair')
    await expect(page.getByText('No pairing code')).toBeVisible()
  })

  test('shows pairing code prominently when ?code= passed', async ({ page }) => {
    await mockClaudeAI(page)
    await page.goto('/settings/integrations/claude-ai/pair?code=ABCXYZ')

    await expect(
      page.getByRole('heading', { name: /Approve browser pairing/i }),
    ).toBeVisible()
    await expect(page.getByText('ABCXYZ')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('clicking Approve fires POST with the code', async ({ page }) => {
    let approveBody: string | null = null
    await mockClaudeAI(page, {
      onApprove: async (route) => {
        approveBody = route.request().postData()
        await route.fulfill({ status: 204, body: '' })
      },
    })
    await page.goto('/settings/integrations/claude-ai/pair?code=ZK4P9M')
    await page.getByRole('button', { name: 'Approve' }).click()

    await expect.poll(() => approveBody).not.toBeNull()
    expect(JSON.parse(approveBody!)).toEqual({ pairing_code: 'ZK4P9M' })
    // The heading is unique; the toast also contains "Browser approved"
    // so we must scope to the heading to avoid strict-mode collision.
    await expect(
      page.getByRole('heading', { name: 'Browser approved' }),
    ).toBeVisible()
  })

  test('shows error message when approval fails', async ({ page }) => {
    await mockClaudeAI(page, {
      onApprove: (route) =>
        route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'PAIRING_EXPIRED', message: 'Pairing code has expired' },
          }),
        }),
    })
    // 6-char code from the canonical alphabet so it passes client-side
    // validation and reaches the (mocked) backend that returns 410.
    await page.goto('/settings/integrations/claude-ai/pair?code=2H3JKM')
    await page.getByRole('button', { name: 'Approve' }).click()

    await expect(page.getByText(/Approval failed/i)).toBeVisible()
    await expect(page.getByText(/expired/i)).toBeVisible()
  })

  test('case-insensitive code input', async ({ page }) => {
    // Lowercase URL param should display uppercase. Use a code drawn
    // entirely from the canonical alphabet (no 0/1/I/L/O/U).
    await mockClaudeAI(page)
    await page.goto('/settings/integrations/claude-ai/pair?code=abcdef')
    await expect(page.getByText('ABCDEF')).toBeVisible()
  })
})
