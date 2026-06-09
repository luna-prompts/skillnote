/**
 * Iter 18 — analytics panel e2e.
 *
 * The analytics panel renders 7-day rollups: throughput numbers, a
 * sparkline, top-synced skills, and per-browser breakdown. It only
 * shows once at least one integration exists. Empty-state copy must
 * be friendlier than walls of zeros for users who just paired their
 * first browser.
 */

import { test, expect, type Page } from '@playwright/test'

interface Analytics {
  skills_synced_24h: number
  skills_synced_7d: number
  failed_24h: number
  failed_7d: number
  sync_success_rate_7d: number
  avg_attempts_per_sync_7d: number
  top_skills_7d: { skill_id: string; skill_slug: string; skill_name: string; sync_count: number }[]
  per_integration: { integration_id: string; integration_label: string | null; syncs_24h: number; failed_24h: number; last_sync_at: string | null }[]
  sparkline_7d: { date: string; syncs: number; failed: number }[]
}

async function wireBase(page: Page, integrations: any[] = [], analytics: Analytics | null = null) {
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
        pending_ops_total: 0,
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
      body: JSON.stringify({
        items: [],
        total: 0,
        pending_count: 0,
        in_progress_count: 0,
        oldest_age_seconds: null,
      }),
    }),
  )
  if (analytics) {
    await page.route('**/v1/integrations/claude-ai/analytics', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(analytics),
      }),
    )
  }
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

function dailySparkline(values: number[]): { date: string; syncs: number; failed: number }[] {
  const today = new Date()
  return values.map((v, i) => {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - (6 - i))
    return { date: d.toISOString().slice(0, 10), syncs: v, failed: 0 }
  })
}

test('analytics panel does NOT render without an integration', async ({ page }) => {
  await wireBase(page, [], null)
  await page.goto('/settings/integrations/claude-ai')
  await expect(page.getByTestId('claude-ai-analytics-panel')).not.toBeVisible()
})

test('analytics panel shows friendly empty-state when no syncs yet', async ({
  page,
}) => {
  await wireBase(page, [activeIntegration()], {
    skills_synced_24h: 0,
    skills_synced_7d: 0,
    failed_24h: 0,
    failed_7d: 0,
    sync_success_rate_7d: 1.0,
    avg_attempts_per_sync_7d: 0,
    top_skills_7d: [],
    per_integration: [],
    sparkline_7d: dailySparkline([0, 0, 0, 0, 0, 0, 0]),
  })
  await page.goto('/settings/integrations/claude-ai')

  const panel = page.getByTestId('claude-ai-analytics-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/No syncs yet/i)).toBeVisible()
  // Headline metrics are NOT rendered when noActivity → spares users
  // a wall of zeros.
  await expect(page.getByTestId('metric-24h')).not.toBeVisible()
})

test('analytics panel renders headline metrics + sparkline + top skills + per-browser table', async ({
  page,
}) => {
  await wireBase(page, [activeIntegration()], {
    skills_synced_24h: 142,
    skills_synced_7d: 893,
    failed_24h: 3,
    failed_7d: 5,
    sync_success_rate_7d: 0.994,
    avg_attempts_per_sync_7d: 1.04,
    top_skills_7d: [
      { skill_id: 'sk-a', skill_slug: 'pdf-extractor', skill_name: 'pdf-extractor', sync_count: 142 },
      { skill_id: 'sk-b', skill_slug: 'git-helper', skill_name: 'git-helper', sync_count: 98 },
    ],
    per_integration: [
      {
        integration_id: 'int-1',
        integration_label: 'Chrome on MacBook Pro',
        syncs_24h: 142,
        failed_24h: 3,
        last_sync_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    sparkline_7d: dailySparkline([10, 30, 50, 90, 200, 300, 213]),
  })
  await page.goto('/settings/integrations/claude-ai')

  const panel = page.getByTestId('claude-ai-analytics-panel')
  await expect(panel).toBeVisible()

  // Headline metrics with the right values.
  await expect(panel.getByTestId('metric-24h')).toContainText('142')
  await expect(panel.getByTestId('metric-7d')).toContainText('893')
  await expect(panel.getByTestId('metric-success')).toContainText('99.4%')
  await expect(panel.getByTestId('metric-avg-tries')).toContainText('1.04')

  // Failed counts surface alongside the headline numbers.
  await expect(panel.getByTestId('metric-24h')).toContainText('3 failed')

  // Top synced skills present with links to the skill page.
  const topList = panel.getByTestId('top-skills-list')
  await expect(topList.getByRole('link', { name: 'pdf-extractor' })).toBeVisible()
  await expect(topList.getByRole('link', { name: 'git-helper' })).toBeVisible()
  expect(
    await topList.getByRole('link', { name: 'pdf-extractor' }).getAttribute('href'),
  ).toBe('/skills/pdf-extractor')

  // Per-integration table renders with the right counts.
  const breakdown = panel.getByTestId('per-integration-breakdown')
  await expect(breakdown).toContainText('Chrome on MacBook Pro')
  await expect(breakdown).toContainText('142')

  // Sparkline is an SVG with the right aria-label shape.
  const spark = panel.getByTestId('analytics-sparkline')
  await expect(spark).toBeVisible()
  const label = await spark.getAttribute('aria-label')
  expect(label).toMatch(/7-day sync sparkline/i)
})

test('usage section shows claude.ai invocations when present', async ({ page }) => {
  await wireBase(page, [activeIntegration()], {
    skills_synced_24h: 5,
    skills_synced_7d: 12,
    failed_24h: 0,
    failed_7d: 0,
    sync_success_rate_7d: 1.0,
    avg_attempts_per_sync_7d: 1.0,
    top_skills_7d: [],
    per_integration: [
      {
        integration_id: 'int-1',
        integration_label: 'Chrome',
        syncs_24h: 5,
        failed_24h: 0,
        last_sync_at: new Date().toISOString(),
      },
    ],
    sparkline_7d: dailySparkline([0, 0, 0, 0, 2, 4, 6]),
    // Usage data — Claude invoked skills on claude.ai.
    invocations_24h: 9,
    invocations_7d: 27,
    top_used_skills_7d: [
      { skill_slug: 'secure-migrations', invocations: 14 },
      { skill_slug: 'testing-guide', invocations: 13 },
    ],
  } as any)
  await page.goto('/settings/integrations/claude-ai')

  const usage = page.getByTestId('usage-breakdown')
  await expect(usage).toBeVisible()
  await expect(usage).toContainText('9 in 24h')
  await expect(usage).toContainText('27 in 7d')
  const usedList = page.getByTestId('top-used-skills-list')
  await expect(usedList.getByRole('link', { name: 'secure-migrations' })).toBeVisible()
  await expect(usedList.getByText('14× used')).toBeVisible()
})

test('usage section is hidden when there are zero invocations', async ({ page }) => {
  await wireBase(page, [activeIntegration()], {
    skills_synced_24h: 5,
    skills_synced_7d: 12,
    failed_24h: 0,
    failed_7d: 0,
    sync_success_rate_7d: 1.0,
    avg_attempts_per_sync_7d: 1.0,
    top_skills_7d: [],
    per_integration: [
      { integration_id: 'int-1', integration_label: 'Chrome', syncs_24h: 5, failed_24h: 0, last_sync_at: new Date().toISOString() },
    ],
    sparkline_7d: dailySparkline([0, 0, 0, 0, 2, 4, 6]),
    invocations_24h: 0,
    invocations_7d: 0,
    top_used_skills_7d: [],
  } as any)
  await page.goto('/settings/integrations/claude-ai')
  await expect(page.getByTestId('claude-ai-analytics-panel')).toBeVisible()
  await expect(page.getByTestId('usage-breakdown')).not.toBeVisible()
})

test('success rate below 95% styles in amber, above stays emerald', async ({
  page,
}) => {
  await wireBase(page, [activeIntegration()], {
    skills_synced_24h: 50,
    skills_synced_7d: 80,
    failed_24h: 5,
    failed_7d: 12,
    sync_success_rate_7d: 0.87,
    avg_attempts_per_sync_7d: 1.2,
    top_skills_7d: [],
    per_integration: [],
    sparkline_7d: dailySparkline([0, 0, 0, 0, 10, 30, 50]),
  })
  await page.goto('/settings/integrations/claude-ai')
  const success = page.getByTestId('metric-success')
  await expect(success).toBeVisible()
  const cls = await success.locator('div').first().getAttribute('class')
  expect(cls ?? '').toContain('text-amber-600')
})
