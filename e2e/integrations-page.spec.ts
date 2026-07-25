/**
 * E2E: /integrations — Browse (grid cards) + Connected (row list)
 *
 * Browse and Connected use deliberately different layouts:
 *   - Browse  → grid of portrait <AgentCard>s with Install button
 *   - Connected → vertical list of compact <AgentListRow>s with expand
 *
 * The same mock data flows through both — only the layout differs.
 */

import { test, expect, type Page } from '@playwright/test'

interface AgentRow {
  agent: 'claude-code' | 'openclaw' | 'codex'
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

/**
 * Scope a locator to ONE Browse card.
 *
 * Every catalog card is rendered inside its own `<li>`, and the agent name
 * lives in a `<p>` whose text is exactly the label — so `has: exact text`
 * picks out a single card without matching another card's description prose
 * (e.g. Codex's description also contains the word "Codex"). Without this,
 * page-wide `getByText('Connected')` assertions would pass even if the state
 * were painted onto the wrong agent's card.
 */
function browseCard(page: Page, label: string) {
  return page.locator('li').filter({ has: page.getByText(label, { exact: true }) })
}

test.describe('/integrations — Browse cards + Connected rows', () => {
  test('header is minimal — h1 only, no marketing subtitle', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // The page is titled "Connect" (the integrations route is the URL, not the brand).
    await expect(page.getByRole('heading', { name: 'Connect', level: 1 })).toBeVisible()
    await expect(page.getByText(/Browse the catalog/)).toHaveCount(0)
  })

  test('default tab is Connected even when nothing is connected (R9 Connect round)', async ({ page }) => {
    // Connected is now the primary surface — first-time users land on the
    // rich empty state that explains what connecting buys them and offers a
    // Browse-agents CTA. Previously this test asserted Browse-default.
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    const connectedTab = page.getByRole('tab', { name: /Connected/ })
    await expect(connectedTab).toHaveAttribute('data-state', 'active', { timeout: 10_000 })

    // Empty state copy + CTAs
    await expect(page.getByText(/No agents connected yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Browse agents/ })).toBeVisible()
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

    // Connected tab uses the row list — assert on its compact status text
    await expect(page.getByText(/Connected.*ago/).first()).toBeVisible()
  })

  test('Connected tab shows rich empty state when zero agents wired (R9 Connect round)', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')

    // Already the default tab — no click needed.
    await expect(page.getByText(/No agents connected yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Browse agents/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible()
  })

  test('Browse tab shows portrait cards with "Official" badge + Install affordance', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')
    // R9 Connect round: Connected is the default tab; click Browse to get
    // to the portrait-cards surface that this test asserts on.
    await page.getByRole('tab', { name: /Browse/ }).click()

    // Badge on each card — uppercase OFFICIAL chip
    const officialBadges = page.getByText('Official', { exact: true })
    await expect(officialBadges.first()).toBeVisible()
    // At least one per agent (Anthropic's "official" CLI description also
    // contains the word, so we don't pin the count).
    expect(await officialBadges.count()).toBeGreaterThanOrEqual(2)

    // Each card has an "Install" affordance (the role-button div in the footer)
    const installButtons = page.getByText('Install', { exact: true })
    await expect(installButtons.first()).toBeVisible()
  })

  test('Browse cards swap to "Connected" footer state when agent is active', async ({ page }) => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    await mockSetup(page, [
      { agent: 'claude-code', state: 'active', installed_at: recent, last_active_at: recent, calls_24h: 1, calls_7d: 1 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')
    // Default tab is Connected when ≥1 wired — switch back to Browse manually
    await page.getByRole('tab', { name: /Browse/ }).click()

    // Claude's card shows "Connected" in the footer; the other catalog cards
    // (OpenClaw, Codex) show "Install" — use .first() since there are now
    // multiple Install affordances in the catalog.
    await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Install', { exact: true }).first()).toBeVisible()
  })

  test('Browse tab includes the Codex card with an Install affordance', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'codex', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')
    await page.getByRole('tab', { name: /Browse/ }).click()

    // The Codex catalog card is present alongside the others.
    await expect(page.getByText('Codex', { exact: true }).first()).toBeVisible()
    // Three browse cards → at least three Install affordances.
    expect(await page.getByText('Install', { exact: true }).count()).toBeGreaterThanOrEqual(3)
  })

  test('Codex card swaps to Connected footer when active', async ({ page }) => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'codex', state: 'active', installed_at: recent, last_active_at: recent, calls_24h: 3, calls_7d: 3 },
    ])
    await page.goto('/integrations')
    await page.getByRole('tab', { name: /Browse/ }).click()

    // Scoped per card: "Connected" must be on the CODEX card specifically.
    // A page-wide `.first()` assertion would still pass if the active state
    // were cross-wired onto Claude Code's card, so assert both directions.
    await expect(
      browseCard(page, 'Codex').getByText('Connected', { exact: true }),
    ).toBeVisible()
    await expect(
      browseCard(page, 'Claude Code').getByText('Install', { exact: true }),
    ).toBeVisible()
    await expect(
      browseCard(page, 'OpenClaw').getByText('Install', { exact: true }),
    ).toBeVisible()
    // …and no other card leaked the connected state. (A page-wide count
    // would over-match: the "Connected" TAB TRIGGER also has a bare
    // "Connected" text node — which is precisely why the unscoped
    // `getByText('Connected').first()` assertion was weak.)
    await expect(
      browseCard(page, 'Claude Code').getByText('Connected', { exact: true }),
    ).toHaveCount(0)
    await expect(
      browseCard(page, 'OpenClaw').getByText('Connected', { exact: true }),
    ).toHaveCount(0)
  })

  test('Codex install flow renders the `--agent codex` command', async ({ page }) => {
    await mockSetup(page, [
      { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
      { agent: 'codex', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')
    await page.getByRole('tab', { name: /Browse/ }).click()

    // Install on the Codex card opens the ConnectModal at its confirm step.
    // `exact` is required: the card's own <button> wrapper takes its
    // accessible name from its contents, so it matches /Install/ too.
    await browseCard(page, 'Codex')
      .getByRole('button', { name: 'Install', exact: true })
      .click()
    const modal = page.getByRole('dialog', { name: 'Install Codex' })
    await expect(modal).toBeVisible()

    // "Manual install" reveals the copy-paste one-liner. It must target the
    // codex agent — a wrong `--agent` value would silently install the wrong
    // plugin for anyone who copies the command instead of using the bridge.
    await modal.getByRole('button', { name: /Manual install/ }).click()
    await expect(modal.locator('code').first()).toContainText('--agent codex')
  })

  test('Connected row click expands to wire diagram + Reinstall/Disconnect', async ({ page }) => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    await mockSetup(page, [
      { agent: 'claude-code', state: 'active', installed_at: recent, last_active_at: recent, calls_24h: 1, calls_7d: 1 },
      { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
    ])
    await page.goto('/integrations')
    await expect(page.getByRole('tab', { name: /Connected/ })).toHaveAttribute('data-state', 'active', { timeout: 10_000 })

    // Click the Claude Code row — should be the only row on Connected tab
    await page.getByRole('button', { name: /Claude Code/ }).first().click()

    // Reinstall / Disconnect text-buttons live in the expanded panel
    await expect(page.getByRole('button', { name: 'Reinstall' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible()
  })
})
