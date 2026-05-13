/**
 * E2E: /integrations Connect modal — accessibility invariants added in R2.
 *
 * Covers C8: focus moves into the modal container on open. Without this,
 * keyboard users tab from wherever the trigger button left them, instead of
 * landing inside the dialog (violates WCAG 2.4.3 Focus Visible / SC 4.1.2
 * Name, Role, Value expectations for dialog focus management).
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

async function mockBaseline(page: Page, rows: AgentRow[]) {
  await page.route('**/v1/setup/agents', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    }),
  )
}

const PENDING: AgentRow[] = [
  { agent: 'claude-code', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
  { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
]

test.describe('/integrations Connect modal — a11y', () => {
  test('opening the modal moves focus into the dialog container', async ({ page }) => {
    await mockBaseline(page, PENDING)
    await page.goto('/integrations')
    await page.getByRole('tab', { name: /Browse/ }).click()
    await page.getByText('Install', { exact: true }).first().click()

    await expect(page.getByRole('dialog')).toBeVisible()
    // Wait for the modal's focus-on-open microtask to land.
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const active = document.activeElement
      return !!dialog && !!active && (active === dialog || dialog.contains(active))
    }, { timeout: 2_000 })

    const inDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const active = document.activeElement
      return !!dialog && !!active && (active === dialog || dialog.contains(active))
    })
    expect(inDialog).toBe(true)
  })
})
