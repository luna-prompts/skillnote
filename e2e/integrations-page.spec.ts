/**
 * E2E: /integrations page — Installed/Available row list.
 *
 * Mocks /v1/setup/agents to return mixed states and verifies the
 * Claude.ai/Linear-style row layout renders correctly.
 */

import { test, expect, type Page } from '@playwright/test'

interface AgentRow {
  agent: 'claude-code' | 'openclaw'
  state: 'pending' | 'active' | 'idle'
  installed_at: string | null
  last_active_at: string | null
  calls_24h: number
  calls_7d: number
}

async function mockSetup(page: Page, rows: AgentRow[]) {
  await page.route('**/v1/setup/agents', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    }),
  )
  await page.route('**/v1/analytics/skill-calls**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/openclaw/usage**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }),
  )
}

test.describe('/integrations — Installed/Available list', () => {
  test('header is native-styled (left-aligned h1, no marketing hero)', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
    await expect(page.getByText(/Install SkillNote into your AI coding agents/)).toBeVisible()
  })

  test('both pending → no Installed section, both rows under Available', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // No Installed section header when nothing is installed
    await expect(page.getByRole('heading', { name: /^Installed$/i })).toHaveCount(0)

    // Available section visible (the h2 specifically; row badges also say
    // "Available" so we scope to the heading to avoid strict-mode misses).
    await expect(page.getByRole('heading', { name: /^Available$/i })).toBeVisible()
    await expect(page.getByText('Claude Code', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('OpenClaw', { exact: true }).first()).toBeVisible()
  })

  test('one active, one pending — split across Installed and Available', async ({ page }) => {
    const recent = new Date(Date.now() - 2 * 60_000).toISOString()
    await mockSetup(page, [
      { agent: 'claude-code', state: 'active', installed_at: recent, last_active_at: recent, calls_24h: 47, calls_7d: 47 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Both section headers visible (h2 only, ignore row badges)
    await expect(page.getByRole('heading', { name: /^Installed$/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: /^Available$/i })).toBeVisible()

    // Connected badge appears on the active row
    await expect(page.getByText('Connected', { exact: false }).first()).toBeVisible()
  })

  test('clicking a row expands to reveal wire diagram + actions', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // First row defaults open when nothing's installed yet, so the
    // Connect button is already visible.
    await expect(page.getByRole('button', { name: /^Connect / }).first()).toBeVisible({
      timeout: 10_000,
    })

    // Click the SECOND row (collapsed by default) — its Connect button
    // should appear after expansion.
    const secondRow = page.getByRole('button', { expanded: false }).first()
    await secondRow.click()

    // Both Connect buttons now visible
    await expect(page.getByRole('button', { name: /Connect Claude Code/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Connect OpenClaw/ })).toBeVisible()
  })

  test('advanced install drawer exposes the curl command', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // First row defaults open. Its Advanced install toggle should be visible.
    const drawer = page.getByRole('button', { name: /Advanced install/ }).first()
    await expect(drawer).toBeVisible({ timeout: 10_000 })
    await drawer.click()

    await expect(page.locator('text=/curl -sf .*setup/agent/')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible()
  })
})
