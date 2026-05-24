/**
 * Round 12 — cookie_expired surfacing.
 *
 * Before: when an extension's claude.ai cookies expired, the integration
 * row showed "Status: cookie expired" with no next steps. Now there's a
 * prominent "Sign in to claude.ai" CTA in amber, and the matching
 * cookie_expired audit event is rendered with a Cookie icon in the
 * activity feed.
 */

import { test, expect, type Page } from '@playwright/test'

async function baseMocks(page: Page, integrations: any[] = [], events: any[] = []) {
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(integrations),
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
        integrations_active: integrations.filter((i) => i.status === 'active').length,
        integrations_with_errors: integrations.filter((i) => i.status === 'error').length,
        pending_ops_total: 0,
        failed_ops_total: 0,
        diverged_links_total: 0,
        last_audit_at: null,
        schema_version: '0020_claude_ai_polish',
      }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) }),
  )
}

test('cookie_expired integration shows a Sign-in-to-claude.ai button', async ({ page }) => {
  await baseMocks(page, [
    {
      id: 'int-1',
      browser_label: 'Chrome on Mac',
      status: 'cookie_expired',
      scope: 'both',
      claude_ai_org_id: null,
      last_sync_at: null,
      last_error: 'claude.ai session expired',
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 0,
      linked_skill_count: 4,
    },
  ])
  await page.goto('/settings/integrations/claude-ai')

  const cta = page.getByRole('link', { name: /Sign in to claude\.ai/i })
  await expect(cta).toBeVisible()
  // Opens in a new tab.
  expect(await cta.getAttribute('target')).toBe('_blank')
  expect(await cta.getAttribute('href')).toBe('https://claude.ai/login')
})

test('active integration does NOT show the re-sign-in CTA', async ({ page }) => {
  await baseMocks(page, [
    {
      id: 'int-2',
      browser_label: 'Edge on Windows',
      status: 'active',
      scope: 'both',
      claude_ai_org_id: 'org_1',
      last_sync_at: new Date().toISOString(),
      last_error: null,
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 0,
      linked_skill_count: 12,
    },
  ])
  await page.goto('/settings/integrations/claude-ai')
  await expect(
    page.getByRole('link', { name: /Sign in to claude\.ai/i }),
  ).not.toBeVisible()
})

test('cookie_expired event renders in the activity feed with explanatory label', async ({
  page,
}) => {
  const now = new Date().toISOString()
  await baseMocks(
    page,
    [],
    [
      {
        id: 'evt-1',
        integration_id: 'int-1',
        event: 'cookie_expired',
        skill_id: null,
        detail: { op_kind: 'upload', error: 'claude.ai 401' },
        created_at: now,
      },
    ],
  )
  await page.goto('/settings/integrations/claude-ai/activity')
  // Scope to the activity list — the same label also appears inside the
  // event-filter <option>, which would otherwise be matched (and be hidden).
  const list = page.locator('#activity-list')
  await expect(list.getByText(/claude\.ai session expired/i)).toBeVisible()
})
