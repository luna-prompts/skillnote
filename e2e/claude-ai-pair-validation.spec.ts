/**
 * Round 12 — pair-page robustness.
 *
 *  - Validates ?code= shape client-side BEFORE the user clicks Approve
 *    (saves them from a confusing backend 404 round-trip).
 *  - Posts an install ping to /v1/setup/installs on approval so the
 *    Connect page's install counters tick. Previously web-paired
 *    browsers were invisible to that counter.
 */

import { test, expect } from '@playwright/test'

test('malformed pair code shows an explanation, not the Approve button', async ({
  page,
}) => {
  await page.goto('/settings/integrations/claude-ai/pair?code=NOT-VALID')
  await expect(
    page.getByRole('heading', { name: /pairing code doesn’t look right/i }),
  ).toBeVisible()
  // Approve button must not render for invalid codes.
  await expect(page.getByRole('button', { name: /^Approve$/ })).not.toBeVisible()
})

test('lowercase pair code is normalized to uppercase and accepted', async ({ page }) => {
  // 'abcdef' → 'ABCDEF' after .toUpperCase(); every glyph is in the alphabet.
  await page.goto('/settings/integrations/claude-ai/pair?code=abcdef')
  await expect(
    page.getByRole('heading', { name: /Approve browser pairing/i }),
  ).toBeVisible()
  // And the rendered code should display the uppercase form.
  await expect(page.getByText(/^ABCDEF$/)).toBeVisible()
})

test('code containing a 0 (zero) is rejected — not in the alphabet', async ({ page }) => {
  await page.goto('/settings/integrations/claude-ai/pair?code=A0CDEF')
  await expect(
    page.getByRole('heading', { name: /pairing code doesn’t look right/i }),
  ).toBeVisible()
})

test('code shorter than 6 chars is rejected', async ({ page }) => {
  await page.goto('/settings/integrations/claude-ai/pair?code=ABCDE')
  await expect(
    page.getByRole('heading', { name: /pairing code doesn’t look right/i }),
  ).toBeVisible()
})

test('valid 6-char code from the alphabet shows the Approve UI', async ({ page }) => {
  // Pure-alphabet sample: all uppercase, no 0/1/I/L/O/U.
  await page.goto('/settings/integrations/claude-ai/pair?code=2H3JKM')
  await expect(
    page.getByRole('heading', { name: /Approve browser pairing/i }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Approve$/ })).toBeVisible()
})

test('missing code renders the empty-state branch (different from malformed)', async ({
  page,
}) => {
  await page.goto('/settings/integrations/claude-ai/pair')
  await expect(page.getByRole('heading', { name: /No pairing code/i })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /pairing code doesn’t look right/i }),
  ).not.toBeVisible()
})

test('Approve fires both the approve POST and a /v1/setup/installs ping', async ({
  page,
}) => {
  let approveCalled = false
  let installPingPayload: Record<string, unknown> | null = null

  await page.route('**/v1/integrations/claude-ai/pair/approve', async (route) => {
    approveCalled = true
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/v1/setup/installs', async (route) => {
    installPingPayload = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'i1', agent: 'claude-ai', installed_at: new Date().toISOString() }),
    })
  })

  await page.goto('/settings/integrations/claude-ai/pair?code=2H3JKM')
  await page.getByRole('button', { name: /^Approve$/ }).click()

  await expect.poll(() => approveCalled).toBe(true)
  await expect.poll(() => installPingPayload).not.toBeNull()
  expect(installPingPayload).toEqual({ agent: 'claude-ai' })
})

test('Approve still completes if the install-ping fails (best-effort)', async ({
  page,
}) => {
  await page.route('**/v1/integrations/claude-ai/pair/approve', (route) =>
    route.fulfill({ status: 204, body: '' }),
  )
  await page.route('**/v1/setup/installs', (route) =>
    route.fulfill({ status: 500, body: 'down' }),
  )

  await page.goto('/settings/integrations/claude-ai/pair?code=2H3JKM')
  await page.getByRole('button', { name: /^Approve$/ }).click()

  // The success state must still appear; telemetry failure is silent.
  await expect(page.getByRole('heading', { name: /Browser approved/ })).toBeVisible({
    timeout: 5_000,
  })
})
