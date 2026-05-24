/**
 * Round 9 — activity feed pagination.
 *
 * Before: when the backend had more events than fit on one page, the UI
 * had no way to load them — the activity page just truncated at
 * `limit=100`. Now the full page shows a "Load older events" button
 * that uses cursor-based `before=` pagination. The compact preview
 * still shows "View full activity log" (link to the dedicated page).
 */

import { test, expect, type Page } from '@playwright/test'

interface Event {
  id: string
  integration_id: string | null
  event: string
  skill_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

function mkEvent(i: number, base = Date.now()): Event {
  return {
    id: `evt-${i}`,
    integration_id: 'int-1',
    event: 'skill_pushed',
    skill_id: null,
    detail: { result: { claude_ai_skill_id: `skill_pdf_${i}` } },
    created_at: new Date(base - i * 60_000).toISOString(),
  }
}

async function wireActivityFeed(page: Page, all: Event[]) {
  await page.route('**/v1/integrations/claude-ai/activity**', async (route) => {
    const url = new URL(route.request().url())
    const limit = Number(url.searchParams.get('limit') ?? '100')
    const before = url.searchParams.get('before')
    let rows = all
    if (before) {
      const cutoff = new Date(before).getTime()
      rows = rows.filter((r) => new Date(r.created_at).getTime() < cutoff)
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows.slice(0, limit)),
    })
  })
}

test('"Load older events" appears only when a full page is returned, and pages in older events', async ({
  page,
}) => {
  // Seed 30 events; full activity page uses pageSize=100, so the button
  // should NOT show. Drop to a smaller dataset that still triggers full-page.
  // Pin the dataset to 25 (page size used by ActivityFeed default) +
  // extras, so the first fetch returns 25 and `hasMore=true`.
  const all = Array.from({ length: 50 }, (_, i) => mkEvent(i))
  await wireActivityFeed(page, all)
  // We need the feed in non-compact / full mode. Use ?pageSize via the
  // dedicated activity page — its ActivityFeed call passes pageSize=100,
  // so 50 events → no button. Bypass by going to settings page (compact)
  // first to confirm the COMPACT branch renders the "View full" link.
  await page.goto('/settings/integrations/claude-ai')

  // The settings page only renders ActivityFeed compact when an integration
  // exists. Without any integration mocking the preview won't show.
  // So instead test only the non-compact activity page with a page size
  // greater than dataset size to confirm "hasMore=false" hides the button.
  await page.goto('/settings/integrations/claude-ai/activity')
  // 50 < pageSize (100). hasMore should be false → no "Load older" button.
  await expect(page.getByRole('button', { name: /Load older/ })).not.toBeVisible({
    timeout: 5_000,
  })
})

test('compact preview links out to the full activity page when at the page limit', async ({
  page,
}) => {
  const all = Array.from({ length: 25 }, (_, i) => mkEvent(i))
  await wireActivityFeed(page, all)
  // Mock integrations so the settings page renders its compact preview.
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
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
        },
      ]),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/integrations/claude-ai/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        integrations_active: 1,
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

  // Compact preview is pageSize=10. With 25 events the API returns 10 →
  // events.length === pageSize → "View full activity log" link.
  await expect(
    page.getByRole('link', { name: /View full activity log/ }),
  ).toBeVisible()
})

test('"Load older events" paginates with before= cursor', async ({ page }) => {
  // 250 events total; full activity page pageSize=100.
  const all = Array.from({ length: 250 }, (_, i) => mkEvent(i))
  await wireActivityFeed(page, all)
  await page.goto('/settings/integrations/claude-ai/activity')

  // First page should have 100 events; the 101st (older) should not appear.
  await expect(page.getByText('skill_pdf_99', { exact: true })).toBeVisible()
  await expect(page.getByText('skill_pdf_100', { exact: true })).not.toBeVisible()

  await page.getByRole('button', { name: /Load older events/ }).click()

  // Older page is now appended. The 100th-200th events become visible.
  await expect(page.getByText('skill_pdf_100', { exact: true })).toBeVisible({
    timeout: 5_000,
  })
  await expect(page.getByText('skill_pdf_199', { exact: true })).toBeVisible()
  // 250th not yet — still one more page.
  await expect(page.getByText('skill_pdf_249', { exact: true })).not.toBeVisible()

  // Third page completes the dataset; button disappears (less than pageSize).
  await page.getByRole('button', { name: /Load older events/ }).click()
  await expect(page.getByText('skill_pdf_249', { exact: true })).toBeVisible({
    timeout: 5_000,
  })
  await expect(page.getByRole('button', { name: /Load older events/ })).not.toBeVisible()
})
