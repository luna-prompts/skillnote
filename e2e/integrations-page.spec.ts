/**
 * E2E: /integrations — Browse/Connected tab pattern.
 *
 * Mocks /v1/setup/agents and asserts on the Notion-style two-tab layout:
 *   - Browse tab lists every supported agent.
 *   - Connected tab lists only agents in active/idle state.
 *   - Default tab is Connected when at least one agent is wired,
 *     Browse otherwise.
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

test.describe('/integrations — Browse/Connected tabs', () => {
  test('header is native-styled', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
    await expect(page.getByText(/Browse the catalog/)).toBeVisible()
  })

  test('default tab is Browse when nothing is connected', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    const browseTab = page.getByRole('tab', { name: /Browse/ })
    await expect(browseTab).toHaveAttribute('data-state', 'active', { timeout: 10_000 })

    // Both agents listed in browse
    await expect(page.getByText('Claude Code', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('OpenClaw', { exact: true }).first()).toBeVisible()
  })

  test('default tab is Connected when at least one agent is wired', async ({ page }) => {
    const recent = new Date(Date.now() - 2 * 60_000).toISOString()
    await mockSetup(page, [
      { agent: 'claude-code', state: 'active', installed_at: recent, last_active_at: recent, calls_24h: 47, calls_7d: 47 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    const connectedTab = page.getByRole('tab', { name: /Connected/ })
    await expect(connectedTab).toHaveAttribute('data-state', 'active', { timeout: 10_000 })

    // Connected tab shows the active agent, not the pending one
    await expect(page.getByText('Claude Code', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Connected.*ago/).first()).toBeVisible()
  })

  test('Connected tab shows empty state when zero agents wired', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Switch to Connected tab manually
    await page.getByRole('tab', { name: /Connected/ }).click()

    await expect(page.getByText(/No agents connected yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Browse integrations/ })).toBeVisible()
  })

  test('clicking a pending row expands to reveal description + platforms + Connect button (no wire yet)', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Click the Claude Code row
    await page.getByRole('button', { name: /Claude Code/ }).first().click()

    // Description + platform chip visible
    await expect(page.getByText(/agentic coding workflows/i)).toBeVisible()
    await expect(page.getByText('macOS', { exact: true }).first()).toBeVisible()

    // Connect button visible
    await expect(page.getByRole('button', { name: /Connect Claude Code/ })).toBeVisible()
  })

  test('advanced install drawer exposes the curl command', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Expand the first row
    await page.getByRole('button', { name: /Claude Code/ }).first().click()
    await page.getByRole('button', { name: /Advanced install/ }).first().click()

    await expect(page.locator('text=/curl -sf .*setup/agent/')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible()
  })
})
