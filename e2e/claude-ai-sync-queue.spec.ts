/**
 * Iter 17 — sync-queue panel e2e.
 *
 * The panel answers "is my data flowing?" Non-tech users will look at
 * this more than any other surface when they're anxious about whether
 * the integration is working.
 */

import { test, expect, type Page } from '@playwright/test'

async function wireBase(page: Page, integrations: any[] = [], queue: any = null) {
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
        integrations_with_errors: 0,
        pending_ops_total: queue?.pending_count ?? 0,
        failed_ops_total: 0,
        diverged_links_total: 0,
        last_audit_at: null,
        schema_version: '0020_claude_ai_polish',
      }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/integrations/claude-ai/queue**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        queue ?? {
          items: [],
          total: 0,
          pending_count: 0,
          in_progress_count: 0,
          oldest_age_seconds: null,
        },
      ),
    }),
  )
}

function activeIntegration() {
  return {
    id: 'int-1',
    browser_label: 'Chrome on MacBook Pro',
    status: 'active',
    scope: 'both',
    claude_ai_org_id: null,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    conflict_policy: 'ask',
    pending_op_count: 0,
    failed_op_count: 0,
    linked_skill_count: 0,
  }
}

test('panel does not render before there is at least one integration', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')
  await expect(page.getByTestId('sync-queue-panel')).not.toBeVisible()
  await expect(page.getByTestId('sync-queue-empty')).not.toBeVisible()
})

test('empty queue renders the "all caught up" message when integration exists', async ({
  page,
}) => {
  await wireBase(page, [activeIntegration()], {
    items: [],
    total: 0,
    pending_count: 0,
    in_progress_count: 0,
    oldest_age_seconds: null,
  })
  await page.goto('/settings/integrations/claude-ai')
  await expect(page.getByTestId('sync-queue-empty')).toBeVisible()
  await expect(page.getByText(/Sync queue is clear/i)).toBeVisible()
})

test('non-empty queue lists pending + in-progress rows with skill names', async ({
  page,
}) => {
  const now = Date.now()
  await wireBase(page, [activeIntegration()], {
    items: [
      {
        id: 'op-1',
        kind: 'upload',
        status: 'in_progress',
        attempts: 0,
        last_error: null,
        created_at: new Date(now - 5_000).toISOString(),
        started_at: new Date(now - 1_000).toISOString(),
        integration_id: 'int-1',
        integration_label: 'Chrome on Mac',
        skill_id: 'sk-1',
        skill_slug: 'pdf-extractor',
        skill_name: 'pdf-extractor',
      },
      {
        id: 'op-2',
        kind: 'upload',
        status: 'pending',
        attempts: 2,
        last_error: 'temporary network blip',
        created_at: new Date(now - 30_000).toISOString(),
        started_at: null,
        integration_id: 'int-1',
        integration_label: 'Chrome on Mac',
        skill_id: 'sk-2',
        skill_slug: 'git-helper',
        skill_name: 'git-helper',
      },
    ],
    total: 2,
    pending_count: 1,
    in_progress_count: 1,
    oldest_age_seconds: 30,
  })
  await page.goto('/settings/integrations/claude-ai')

  const panel = page.getByTestId('sync-queue-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('1 pending')
  await expect(panel).toContainText('1 in progress')
  // Both skill names visible.
  await expect(panel.getByText('pdf-extractor')).toBeVisible()
  await expect(panel.getByText('git-helper')).toBeVisible()
  // The retried row exposes a "retry N" badge.
  await expect(panel.getByText(/^retry 2$/)).toBeVisible()
  // First (oldest) row should appear before second row in DOM order.
  const rows = panel.locator('li')
  await expect(rows.first()).toContainText('pdf-extractor')
})

test('stale-queue warning shows when oldest_age_seconds exceeds threshold', async ({
  page,
}) => {
  await wireBase(page, [activeIntegration()], {
    items: [
      {
        id: 'op-stuck',
        kind: 'upload',
        status: 'pending',
        attempts: 0,
        last_error: null,
        created_at: new Date(Date.now() - 600_000).toISOString(),
        started_at: null,
        integration_id: 'int-1',
        integration_label: 'Chrome on Mac',
        skill_id: 'sk-x',
        skill_slug: 'stuck-skill',
        skill_name: 'stuck-skill',
      },
    ],
    total: 1,
    pending_count: 1,
    in_progress_count: 0,
    oldest_age_seconds: 600,
  })
  await page.goto('/settings/integrations/claude-ai')

  const warning = page.getByTestId('sync-queue-stale-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText(/extension may be paused/i)
})

test('skill_slug links to the skill detail page', async ({ page }) => {
  await wireBase(page, [activeIntegration()], {
    items: [
      {
        id: 'op-link',
        kind: 'upload',
        status: 'pending',
        attempts: 0,
        last_error: null,
        created_at: new Date().toISOString(),
        started_at: null,
        integration_id: 'int-1',
        integration_label: 'Chrome on Mac',
        skill_id: 'sk-link',
        skill_slug: 'my-skill-slug',
        skill_name: 'my-skill-slug',
      },
    ],
    total: 1,
    pending_count: 1,
    in_progress_count: 0,
    oldest_age_seconds: 5,
  })
  await page.goto('/settings/integrations/claude-ai')

  const link = page.getByRole('link', { name: 'my-skill-slug' })
  await expect(link).toBeVisible()
  expect(await link.getAttribute('href')).toBe('/skills/my-skill-slug')
})
