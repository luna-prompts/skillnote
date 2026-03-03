/**
 * E2E: Integrations page — scope selector dropdown and config panel
 *
 * All API calls are mocked so tests run without a live backend.
 */

import { test, expect, type Page } from '@playwright/test'

// ─── FIXTURES ─────────────────────────────────────────────────────────────────

const SKILLS = [
  { id: 'a1', name: 'react-hooks', slug: 'react-hooks', description: 'React hooks patterns.', content_md: '# React Hooks', collections: ['frontend', 'react'], current_version: 1, total_versions: 1, created_at: '2026-01-10T10:00:00Z', updated_at: '2026-02-20T14:30:00Z' },
  { id: 'a2', name: 'db-migrations', slug: 'db-migrations', description: 'Safe DB migrations.', content_md: '# DB Migrations', collections: ['devops'], current_version: 2, total_versions: 2, created_at: '2026-01-15T08:00:00Z', updated_at: '2026-02-10T09:00:00Z' },
  { id: 'a3', name: 'docker-setup', slug: 'docker-setup', description: 'Docker basics.', content_md: '# Docker', collections: ['devops'], current_version: 1, total_versions: 1, created_at: '2026-01-20T08:00:00Z', updated_at: '2026-02-12T09:00:00Z' },
]

const MCP_STATUS_OFFLINE = { detail: 'Not Found' }
const MCP_STATUS_ONLINE  = { status: 'online', uptime_seconds: 300, active_connections: 1, connections: [
  { id: 'conn-1', connected_at: Date.now() / 1000 - 30, duration_seconds: 30, user_agent: 'claude-code/1.0', remote: '127.0.0.1', scope: null },
]}

// ─── MOCK SETUP ────────────────────────────────────────────────────────────────

async function setupMocks(page: Page, mcpOnline = false) {
  // skills list
  await page.route('**/v1/skills', (route, req) => {
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SKILLS) })
    }
    return route.continue()
  })

  // MCP status — intercept by host:port (not path glob, since port is part of hostname)
  await page.route(/localhost:8083\/status/, (route) => {
    if (mcpOnline) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MCP_STATUS_ONLINE) })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(MCP_STATUS_OFFLINE) })
  })
}

async function goToIntegrations(page: Page) {
  await page.goto('/integrations')
  // Wait for skills to be rendered — scope selector should appear
  await page.waitForSelector('button:has-text("All Skills"), button:has-text("skills")', { timeout: 10000 })
}

// ─── TESTS: PAGE LOAD ─────────────────────────────────────────────────────────

test.describe('Integrations page — load', () => {
  test('renders page heading', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)
    await expect(page.locator('h1:has-text("MCP Integrations")')).toBeVisible()
  })

  test('renders scope selector with total skill count', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)
    const btn = page.locator('button').filter({ hasText: /All Skills/ })
    await expect(btn).toBeVisible()
    // Should show "3 skills"
    await expect(btn).toContainText('3 skills')
  })

  test('renders agent tabs', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)
    for (const label of ['OpenClaw', 'Claude Code', 'Cursor', 'OpenHands', 'Universal']) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible()
    }
  })
})

// ─── TESTS: SCOPE SELECTOR DROPDOWN ──────────────────────────────────────────

test.describe('Scope selector dropdown', () => {
  test('opens when trigger is clicked', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    // Click the scope selector button
    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    // Dropdown search input (unique placeholder "...collections...") should now be visible
    await expect(page.locator('input[placeholder*="collections"]').first()).toBeVisible({ timeout: 3000 })
  })

  test('shows all 3 collections derived from skills', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    // Collections: frontend, react, devops
    await expect(page.getByText('frontend', { exact: true }).first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('react', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('devops', { exact: true }).first()).toBeVisible()
  })

  test('closes when Escape is pressed', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    const searchInput = page.locator('input[placeholder*="collections"]').first()
    await expect(searchInput).toBeVisible({ timeout: 3000 })

    await page.keyboard.press('Escape')
    await expect(searchInput).not.toBeVisible({ timeout: 3000 })
  })

  test('closes when clicking outside', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    const searchInput = page.locator('input[placeholder*="collections"]').first()
    await expect(searchInput).toBeVisible({ timeout: 3000 })

    // Click somewhere else on the page
    await page.locator('h1').click()
    await expect(searchInput).not.toBeVisible({ timeout: 3000 })
  })

  test('selecting a collection updates the trigger label', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    // Click on "frontend" collection
    await page.getByText('frontend', { exact: true }).first().click()

    // Trigger should now show "frontend"
    await expect(page.locator('button').filter({ hasText: /frontend/ }).first()).toBeVisible()
    // Dropdown should have closed
    await expect(page.locator('input[placeholder*="collections"]').first()).not.toBeVisible({ timeout: 3000 })
  })

  test('selecting a collection updates skill count in trigger', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    // "devops" has 2 skills (db-migrations + docker-setup)
    await page.getByText('devops', { exact: true }).first().click()

    // Trigger should show "2 skills"
    const updatedTrigger = page.locator('button').filter({ hasText: /devops/ }).first()
    await expect(updatedTrigger).toContainText('2 skills')
  })

  test('clear X button resets to All Skills', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    // Select a collection first
    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()
    await page.getByText('frontend', { exact: true }).first().click()

    // X clear button should be visible in the trigger now
    const clearBtn = page.locator('button').filter({ hasText: /frontend/ }).locator('svg').first()
    // The X button is inside the trigger
    const triggerWithCollection = page.locator('button').filter({ hasText: /frontend/ }).first()
    // Click the X (it's a span[role=button] inside the trigger)
    await triggerWithCollection.locator('[role="button"]').click()

    // Should be back to All Skills
    await expect(page.locator('button').filter({ hasText: /All Skills/ })).toBeVisible()
  })

  test('dropdown is rendered above config panel (not behind it)', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    // The dropdown div should be visible and the collection items clickable
    const frontendOption = page.getByText('frontend', { exact: true }).first()
    await expect(frontendOption).toBeVisible({ timeout: 3000 })

    // Check that the dropdown is not obscured — clicking it should work
    await frontendOption.click()
    await expect(page.locator('button').filter({ hasText: /frontend/ }).first()).toBeVisible()
  })

  test('search filters collections', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    const searchInput = page.locator('input[placeholder*="collections"]').first()
    await expect(searchInput).toBeVisible({ timeout: 3000 })

    await searchInput.fill('dev')

    // Only "devops" should be visible, not "frontend" or "react"
    await expect(page.getByText('devops', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('frontend', { exact: true }).first()).not.toBeVisible()
    await expect(page.getByText('react', { exact: true }).first()).not.toBeVisible()
  })

  test('search with no matches shows empty state', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    const searchInput = page.locator('input[placeholder*="collections"]').first()
    await expect(searchInput).toBeVisible({ timeout: 3000 })

    await searchInput.fill('zzzznotexist')
    await expect(page.getByText('No collections match').first()).toBeVisible()
  })

  test('keyboard: ArrowDown moves focus to first collection', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()

    const searchInput = page.locator('input[placeholder*="collections"]').first()
    await expect(searchInput).toBeVisible({ timeout: 3000 })

    // Press ArrowDown twice to get off "All Skills" row
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    // Some collection should be selected now (trigger no longer says "All Skills")
    const updatedTrigger = page.locator('button').first()
    // The trigger text should NOT contain "All Skills" after Enter-selecting
    await expect(page.locator('button').filter({ hasText: /All Skills/ })).not.toBeVisible({ timeout: 3000 })
  })
})

// ─── TESTS: CONFIG PANEL ──────────────────────────────────────────────────────

test.describe('Config panel', () => {
  test('shows MCP URL for openclaw agent', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)
    await expect(page.getByText('localhost:8083/mcp').first()).toBeVisible()
  })

  test('switching agent tab changes file path shown', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    await page.locator('button:has-text("Cursor")').first().click()
    await expect(page.getByText('.cursor/mcp.json').first()).toBeVisible()
  })

  test('selecting a collection appends ?collections= to URL', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    // Select devops collection
    const trigger = page.locator('button').filter({ hasText: /All Skills/ })
    await trigger.click()
    await page.getByText('devops', { exact: true }).first().click()

    await expect(page.getByText(/collections=devops/).first()).toBeVisible()
  })

  test('copy URL button shows "Copied" feedback', async ({ page }) => {
    await setupMocks(page)
    await goToIntegrations(page)

    // Find the "Copy URL" button
    const copyUrlBtn = page.locator('button:has-text("Copy URL")').first()
    await expect(copyUrlBtn).toBeVisible()
    await copyUrlBtn.click()

    // Should briefly show "Copied"
    await expect(page.locator('button:has-text("Copied")').first()).toBeVisible({ timeout: 3000 })
  })
})

// ─── TESTS: CONNECTIONS PANEL ─────────────────────────────────────────────────

test.describe('Connections panel', () => {
  test('shows offline state when MCP server unreachable', async ({ page }) => {
    await setupMocks(page, false)
    await goToIntegrations(page)
    await expect(page.getByText('MCP server not reachable').first()).toBeVisible({ timeout: 8000 })
  })

  test('shows online state when MCP server is reachable', async ({ page }) => {
    await setupMocks(page, true)
    await goToIntegrations(page)
    // The "online" text is rendered inside the connections panel header
    // Use getByText with exact match to avoid partial matches
    await expect(page.getByText('online', { exact: true }).first()).toBeVisible({ timeout: 8000 })
  })

  test('shows connection when MCP is online with active connections', async ({ page }) => {
    await setupMocks(page, true)
    await goToIntegrations(page)
    // Mock returns 1 active connection — "Filter N connections" placeholder appears in search bar
    // This confirms the connection list is populated
    await expect(page.locator('input[placeholder*="connections"]').first()).toBeVisible({ timeout: 8000 })
  })
})
