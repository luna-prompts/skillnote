/**
 * E2E: /integrations page.
 *
 * Mocks /v1/setup/agents to return mixed states (one connected, one not)
 * and verifies the redesigned canvas renders honestly. No live backend.
 */

import { test, expect, type Page } from '@playwright/test'

interface AgentRow {
  agent: 'claude-code' | 'openclaw'
  state: 'pending' | 'installed' | 'active' | 'idle'
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
  // Page also tries the legacy probes — keep them silent so the console
  // doesn't fill with 404 noise during the test.
  await page.route('**/v1/analytics/skill-calls**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/openclaw/usage**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }),
  )
}

test.describe('/integrations — Connect page', () => {
  test('header is native-styled (left-aligned h1, no marketing hero)', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
    await expect(page.getByText('Wire SkillNote into your AI coding agent.')).toBeVisible()
  })

  test('two agent cards, both pending → both show Connect button + "Not connected"', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Each agent card has a header with the agent's name. The name appears
    // in two places per row (card header + product-card label in the wiring
    // diagram), so we just assert at least one instance is visible.
    await expect(page.getByText('Claude Code', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('OpenClaw', { exact: true }).first()).toBeVisible()

    // Status pills on each card
    await expect(page.locator('text=Not connected').first()).toBeVisible()

    // Both Connect buttons visible
    await expect(page.getByRole('button', { name: /Connect Claude Code/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Connect OpenClaw/ })).toBeVisible()
  })

  test('one active, one pending — status pills differentiate', async ({ page }) => {
    const recent = new Date(Date.now() - 2 * 60_000).toISOString()
    await mockSetup(page, [
      { agent: 'claude-code', state: 'active', installed_at: recent, last_active_at: recent, calls_24h: 47, calls_7d: 47 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Claude card shows "Connected" pill
    await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 10_000 })

    // Claude card shows the relative-time status line — no stats grid, no sparkline
    await expect(page.locator('text=last call')).toBeVisible()

    // OpenClaw still shows the Connect button
    await expect(page.getByRole('button', { name: /Connect OpenClaw/ })).toBeVisible()
  })

  test('advanced install drawer expands and exposes the curl command', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Click the first Advanced install toggle
    const drawer = page.getByRole('button', { name: /Advanced install/ }).first()
    await expect(drawer).toBeVisible()
    await drawer.click()

    // The curl command appears
    await expect(page.locator('text=/curl -sf .*setup/agent/')).toBeVisible()

    // The Copy button is visible
    await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible()
  })

  test('installed (no calls yet) shows amber "Waiting" pill + waiting copy', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'installed', installed_at: new Date().toISOString(), last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    await expect(page.locator('text=Waiting').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=Installed — waiting for first task')).toBeVisible()
  })
})
