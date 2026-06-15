/**
 * E2E: polish layer — activity feed page, health card, per-skill sync badge.
 *
 * All routes mock the backend so the test runs against `npm run dev`
 * without a live backend.
 */

import { test, expect, type Page, type Route } from '@playwright/test'

interface HealthMetrics {
  integrations_active: number
  integrations_with_errors: number
  pending_ops_total: number
  failed_ops_total: number
  diverged_links_total: number
  last_audit_at: string | null
  schema_version: string
}

interface AuditEvent {
  id: string
  integration_id: string | null
  event: string
  skill_id: string | null
  skill_slug?: string | null
  detail: Record<string, unknown>
  created_at: string
}

async function mockEverything(
  page: Page,
  opts: {
    health?: HealthMetrics
    activity?: AuditEvent[]
    integrations?: unknown[]
    conflicts?: unknown[]
    onToggleSkill?: (route: Route) => void | Promise<void>
  } = {},
) {
  const defaultHealth: HealthMetrics = {
    integrations_active: 3,
    integrations_with_errors: 0,
    pending_ops_total: 2,
    failed_ops_total: 0,
    diverged_links_total: 0,
    last_audit_at: new Date().toISOString(),
    schema_version: '0020_claude_ai_polish',
  }
  await page.route('**/v1/integrations/claude-ai/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.health ?? defaultHealth),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.activity ?? []),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.integrations ?? []),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.conflicts ?? []),
    }),
  )
  await page.route(
    '**/v1/integrations/claude-ai/skills/*/sync',
    async (route) => {
      if (opts.onToggleSkill) return opts.onToggleSkill(route)
      return route.fulfill({ status: 204, body: '' })
    },
  )
}

test.describe('Health card on the settings page', () => {
  // The HealthCard renders only once an integration exists (first run leads
  // with the setup stepper, not an empty dashboard), so each case wires one.
  const ROW = {
    id: 'hc-1',
    browser_label: 'Chrome',
    status: 'active' as const,
    scope: 'both' as const,
    claude_ai_org_id: null,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    conflict_policy: 'ask' as const,
    pending_op_count: 0,
    failed_op_count: 0,
    linked_skill_count: 3,
  }

  test('renders healthy state with a Healthy status chip', async ({ page }) => {
    await mockEverything(page, {
      integrations: [ROW],
      health: {
        integrations_active: 5,
        integrations_with_errors: 0,
        pending_ops_total: 0,
        failed_ops_total: 0,
        diverged_links_total: 0,
        last_audit_at: new Date().toISOString(),
        schema_version: '0020_claude_ai_polish',
      },
    })
    await page.goto('/settings/integrations/claude-ai')
    await expect(page.getByText('claude.ai sync status')).toBeVisible()
    await expect(page.getByTestId('health-stat-active')).toContainText('5')
    // Internal schema name must NOT leak to the customer; a human status
    // chip shows instead.
    await expect(page.getByTestId('health-status-chip')).toContainText('Healthy')
    await expect(page.getByText(/schema 0020/)).toHaveCount(0)
  })

  test('renders warning state for diverged conflicts', async ({ page }) => {
    await mockEverything(page, {
      integrations: [ROW],
      health: {
        integrations_active: 3,
        integrations_with_errors: 0,
        pending_ops_total: 0,
        failed_ops_total: 0,
        diverged_links_total: 4,
        last_audit_at: null,
        schema_version: '0020_claude_ai_polish',
      },
    })
    await page.goto('/settings/integrations/claude-ai')
    await expect(page.getByTestId('health-status-chip')).toContainText('Degraded')
    await expect(page.getByTestId('health-stat-conflicts')).toContainText('4')
  })

  test('renders error state when integrations have errors', async ({ page }) => {
    await mockEverything(page, {
      integrations: [ROW],
      health: {
        integrations_active: 2,
        integrations_with_errors: 1,
        pending_ops_total: 0,
        failed_ops_total: 2,
        diverged_links_total: 0,
        last_audit_at: null,
        schema_version: '0020_claude_ai_polish',
      },
    })
    await page.goto('/settings/integrations/claude-ai')
    await expect(page.getByText('With errors')).toBeVisible()
    await expect(page.getByTestId('health-status-chip')).toContainText('Needs attention')
  })
})

test.describe('Activity feed page', () => {
  test('renders empty state with friendly copy', async ({ page }) => {
    await mockEverything(page, { activity: [] })
    await page.goto('/settings/integrations/claude-ai/activity')
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
    await expect(page.getByText(/No activity yet/)).toBeVisible()
  })

  test('renders a list of events with icons + timestamps', async ({ page }) => {
    const now = new Date()
    const events: AuditEvent[] = [
      {
        id: 'e1',
        integration_id: 'int-1',
        event: 'pair_started',
        skill_id: null,
        detail: { browser_label: 'Chrome on Mac' },
        created_at: new Date(now.getTime() - 60_000).toISOString(),
      },
      {
        id: 'e2',
        integration_id: 'int-1',
        event: 'skill_pushed',
        skill_id: 'sk-1',
        detail: { op_kind: 'upload', result: { claude_ai_skill_id: 'skill_01ABCDEF' } },
        created_at: new Date(now.getTime() - 30_000).toISOString(),
      },
      {
        id: 'e3',
        integration_id: 'int-1',
        event: 'op_failed',
        skill_id: 'sk-2',
        detail: { op_kind: 'upload', attempts: 3, error: 'claude.ai 500' },
        created_at: now.toISOString(),
      },
    ]
    await mockEverything(page, { activity: events })
    await page.goto('/settings/integrations/claude-ai/activity')

    // "Pairing started" and "Sync operation failed" labels also exist as
    // <option> entries in the filter dropdown, so they're not unique.
    // Assert via unique detail strings that only appear in the rendered
    // feed rows, not the dropdown.
    await expect(page.getByText('Chrome on Mac')).toBeVisible()
    await expect(page.getByText('skill_01ABCDEF')).toBeVisible()
    // The op_failed event's detail shows the error message.
    await expect(page.getByText(/claude\.ai 500/)).toBeVisible()
  })

  test('shows human skill names, not opaque IDs, and friendly failure reasons', async ({ page }) => {
    const now = new Date()
    const events: AuditEvent[] = [
      {
        id: 'h1',
        integration_id: 'int-1',
        event: 'skill_pushed',
        skill_id: 'sk-1',
        skill_slug: 'testing-guide',
        detail: { op_kind: 'upload', result: { claude_ai_skill_id: 'skill_01XQ9FQT8bcoyurjoHJa8KW1' } },
        created_at: new Date(now.getTime() - 30_000).toISOString(),
      },
      {
        id: 'h2',
        integration_id: 'int-1',
        event: 'op_failed',
        skill_id: 'sk-2',
        skill_slug: null,
        detail: {
          op_kind: 'upload',
          attempts: 1,
          // Raw claude.ai error body — must NOT surface verbatim.
          error:
            'claude.ai /api/organizations/7d36e9d8/skills/upload-skill?overwrite=true returned 400 [{"type":"error","error":{"type":"invalid_request_error","message":"This skill name is already in use"}}]',
        },
        created_at: now.toISOString(),
      },
    ]
    await mockEverything(page, { activity: events })
    await page.goto('/settings/integrations/claude-ai/activity')

    // The human skill slug is shown; the opaque claude.ai id is NOT.
    await expect(page.getByText('testing-guide')).toBeVisible()
    await expect(page.getByText(/skill_01XQ9FQT/)).toHaveCount(0)
    // The failure row shows a human reason, not the raw URL/JSON.
    await expect(page.getByText(/already exists on claude\.ai/)).toBeVisible()
    await expect(page.getByText(/upload-skill\?overwrite/)).toHaveCount(0)
  })

  test('filter by event narrows the list', async ({ page }) => {
    // Wire a custom route FIRST so it captures every query string. The
    // mockEverything call below uses page.route too — Playwright matches
    // most-recently-registered first, so the explicit handler wins.
    let lastQuery = ''
    await mockEverything(page, { activity: [] })
    await page.route('**/v1/integrations/claude-ai/activity**', (route) => {
      lastQuery = new URL(route.request().url()).search
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })
    await page.goto('/settings/integrations/claude-ai/activity')

    await page.getByRole('combobox').selectOption('pair_started')
    await expect.poll(() => lastQuery).toContain('event=pair_started')
  })

  test('search filter narrows visible rows', async ({ page }) => {
    const events: AuditEvent[] = [
      {
        id: 'e1',
        integration_id: 'i1',
        event: 'skill_pushed',
        skill_id: null,
        detail: { result: { claude_ai_skill_id: 'skill_PDF_extractor' } },
        created_at: new Date().toISOString(),
      },
      {
        id: 'e2',
        integration_id: 'i1',
        event: 'skill_pushed',
        skill_id: null,
        detail: { result: { claude_ai_skill_id: 'skill_image_resizer' } },
        created_at: new Date().toISOString(),
      },
    ]
    await mockEverything(page, { activity: events })
    await page.goto('/settings/integrations/claude-ai/activity')

    await expect(page.getByText('skill_PDF_extractor')).toBeVisible()
    await expect(page.getByText('skill_image_resizer')).toBeVisible()

    await page.getByPlaceholder('Search activity…').fill('PDF')
    await expect(page.getByText('skill_PDF_extractor')).toBeVisible()
    await expect(page.getByText('skill_image_resizer')).not.toBeVisible()
  })
})

test.describe('Disconnect confirmation dialog', () => {
  test('shows confirmation dialog before disconnecting', async ({ page }) => {
    let deleteCalled = false
    await mockEverything(page, {
      integrations: [
        {
          id: 'int-1',
          browser_label: 'Chrome on Mac',
          status: 'active',
          scope: 'both',
          claude_ai_org_id: null,
          last_sync_at: new Date().toISOString(),
          last_error: null,
          conflict_policy: 'ask',
          pending_op_count: 0,
          failed_op_count: 0,
          linked_skill_count: 3,
        } as never,
      ],
      onDelete: async (route) => {
        deleteCalled = true
        await route.fulfill({ status: 204, body: '' })
      },
    })
    await page.goto('/settings/integrations/claude-ai')

    // Click Disconnect — dialog should open, NOT immediately fire the request.
    await page.getByRole('button', { name: /Disconnect$/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /Disconnect Chrome on Mac/ }),
    ).toBeVisible()
    // The request must NOT have fired yet.
    expect(deleteCalled).toBe(false)

    // Cancel — dialog closes, no request.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(deleteCalled).toBe(false)
  })

  test('Escape key closes the dialog without disconnecting', async ({ page }) => {
    let deleteCalled = false
    await mockEverything(page, {
      integrations: [
        {
          id: 'int-1',
          browser_label: 'Chrome',
          status: 'active',
          scope: 'both',
          claude_ai_org_id: null,
          last_sync_at: null,
          last_error: null,
          conflict_policy: 'ask',
          pending_op_count: 0,
          failed_op_count: 0,
          linked_skill_count: 0,
        } as never,
      ],
      onDelete: async (route) => {
        deleteCalled = true
        await route.fulfill({ status: 204, body: '' })
      },
    })
    await page.goto('/settings/integrations/claude-ai')
    await page.getByRole('button', { name: /Disconnect$/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(deleteCalled).toBe(false)
  })

  test('Confirm button fires the DELETE request', async ({ page }) => {
    // Capture every DELETE matching our integration row so we can prove
    // the request fired (vs. mockEverything's onDelete which only fires
    // after the URL matcher resolves).
    let deleteRequests: string[] = []
    await page.route(
      '**/v1/integrations/claude-ai/integrations/int-disc',
      async (route) => {
        if (route.request().method() === 'DELETE') {
          deleteRequests.push(route.request().url())
          return route.fulfill({ status: 204, body: '' })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{}',
        })
      },
    )
    await mockEverything(page, {
      integrations: [
        {
          id: 'int-disc',
          browser_label: 'Firefox',
          status: 'active',
          scope: 'both',
          claude_ai_org_id: null,
          last_sync_at: null,
          last_error: null,
          conflict_policy: 'ask',
          pending_op_count: 0,
          failed_op_count: 0,
          linked_skill_count: 0,
        } as never,
      ],
    })
    await page.goto('/settings/integrations/claude-ai')
    await page.getByRole('button', { name: /Disconnect$/ }).click()
    // The Confirm button inside the dialog (NOT the row button — the dialog
    // takes focus when open).
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click()
    await expect.poll(() => deleteRequests.length).toBeGreaterThan(0)
  })

  test('dialog has correct ARIA attributes', async ({ page }) => {
    await mockEverything(page, {
      integrations: [
        {
          id: 'int-aria',
          browser_label: 'Edge',
          status: 'active',
          scope: 'both',
          claude_ai_org_id: null,
          last_sync_at: null,
          last_error: null,
          conflict_policy: 'ask',
          pending_op_count: 0,
          failed_op_count: 0,
          linked_skill_count: 0,
        } as never,
      ],
    })
    await page.goto('/settings/integrations/claude-ai')
    await page.getByRole('button', { name: /Disconnect$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'disconnect-dialog-title')
    await expect(dialog).toHaveAttribute('aria-describedby', 'disconnect-dialog-body')
  })
})

test.describe('Load error banner', () => {
  test('shows banner when refresh fails after a successful load', async ({ page }) => {
    let callCount = 0
    await page.route('**/v1/integrations/claude-ai/integrations', (route) => {
      callCount++
      if (callCount === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
      }
      // Subsequent calls fail.
      return route.fulfill({ status: 500, body: 'oops' })
    })
    await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/integrations/claude-ai/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          integrations_active: 0,
          integrations_with_errors: 0,
          pending_ops_total: 0,
          failed_ops_total: 0,
          diverged_links_total: 0,
          last_audit_at: null,
          schema_version: '0020_claude_ai_polish',
        }),
      }),
    )

    await page.goto('/settings/integrations/claude-ai')

    // Click Refresh — second call fails.
    await page.getByRole('button', { name: /^Refresh$/ }).click()
    await expect(page.getByText(/Last refresh failed/)).toBeVisible()
  })
})

test.describe('Recent activity preview on settings page', () => {
  test('only shows when at least one integration exists', async ({ page }) => {
    await mockEverything(page, { integrations: [], activity: [] })
    await page.goto('/settings/integrations/claude-ai')
    // No connected browsers → no recent-activity preview.
    await expect(page.getByText('Recent activity')).not.toBeVisible()
  })

  test('renders preview when integrations exist', async ({ page }) => {
    await mockEverything(page, {
      integrations: [
        {
          id: 'int-1',
          browser_label: 'Chrome on Mac',
          status: 'active',
          scope: 'both',
          claude_ai_org_id: null,
          last_sync_at: new Date().toISOString(),
          last_error: null,
          conflict_policy: 'ask',
          pending_op_count: 0,
          failed_op_count: 0,
          linked_skill_count: 3,
        },
      ],
      activity: [
        {
          id: 'e1',
          integration_id: 'int-1',
          event: 'pair_redeemed',
          skill_id: null,
          detail: {},
          created_at: new Date().toISOString(),
        },
      ],
    })
    await page.goto('/settings/integrations/claude-ai')
    await expect(page.getByText('Recent activity')).toBeVisible()
    await expect(page.getByText('Browser connected')).toBeVisible()
    // "View all →" link to the full activity page.
    await expect(page.getByRole('link', { name: /View all/ })).toBeVisible()
  })
})
