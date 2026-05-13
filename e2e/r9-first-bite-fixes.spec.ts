/**
 * Round 9 — first-bite UX fixes.
 *
 * F28 — `?api=<url>` query-param is consumed on first paint, written to
 *       `localStorage['skillnote:api-url']`, and stripped from the URL.
 * F30 — PWA install prompt is gated on `visit-count >= 2`. Visit 1: no prompt.
 *       Visit 2: prompt is allowed (if the browser surfaces beforeinstallprompt).
 * F32 — `syncSkillsFromApi` drops "ghost skills" — local skills with
 *       `_syncedAt` set that aren't in the latest API response — while
 *       preserving "genuinely-local" skills (no `_syncedAt`).
 */
import { test, expect, type Page } from '@playwright/test'

const SEED_SKILLS = [
  {
    slug: 'r9-seed-a',
    name: 'r9-seed-a',
    description: 'seed A',
    collections: [],
    current_version: 1,
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    import_source_id: null,
    forked_from_source: false,
    source_path: null,
    origin: null,
  },
  {
    slug: 'r9-seed-b',
    name: 'r9-seed-b',
    description: 'seed B',
    collections: [],
    current_version: 1,
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    import_source_id: null,
    forked_from_source: false,
    source_path: null,
    origin: null,
  },
]

async function mockSkillsApi(page: Page) {
  await page.route('**/v1/skills', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SEED_SKILLS),
    }),
  )
  // Other endpoints touched on / load — return empty
  await page.route('**/v1/analytics/ratings', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/setup/agents', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/collections', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test.describe('R9 — first-bite UX fixes', () => {
  // Tests in this file rely on a fresh localStorage / visit-count.
  // Without isolation they cross-talk: F30's visit counter survives into
  // F32, F40's `?api=` override survives into F38, etc.
  test.beforeEach(async ({ page }) => {
    // Need an origin to clear storage from — go to a non-redirecting page first.
    await page.route('**/v1/skills', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/setup/agents', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.goto('/integrations')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.unrouteAll({ behavior: 'wait' })
  })

  test('F28: ?api=<url> query param persists to localStorage and is stripped', async ({ page }) => {
    await mockSkillsApi(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    const apiUrl = 'http://localhost:8082'
    await page.goto(`/?api=${encodeURIComponent(apiUrl)}`)

    // Wait for the bootstrap effect to run + URL to be replaced.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('skillnote:api-url'))).toBe(apiUrl)

    // Param has been stripped from the URL.
    expect(page.url()).not.toContain('api=')
  })

  test('F28: malformed api param is rejected (no localStorage write)', async ({ page }) => {
    await mockSkillsApi(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // javascript: scheme + malformed URL should NOT be persisted.
    await page.goto('/?api=javascript:alert(1)')

    await page.waitForFunction(() => !window.location.search.includes('api='), null, {
      timeout: 5000,
    })
    const stored = await page.evaluate(() => localStorage.getItem('skillnote:api-url'))
    expect(stored).toBeNull()
  })

  test('F30: PWA install prompt is suppressed on visit 1, eligible on visit 2', async ({ page }) => {
    await mockSkillsApi(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Visit 1
    await page.goto('/')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('skillnote:visit-count'))).toBe('1')
    const dialogVisit1 = await page.locator('[role="dialog"][aria-label*="Install"]').count()
    expect(dialogVisit1).toBe(0)

    // Visit 2 — counter increments, eligibility unlocked. The dialog itself
    // only renders if the browser surfaced beforeinstallprompt; this test
    // pins the gate, not the browser-side event.
    await page.goto('/')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('skillnote:visit-count'))).toBe('2')
  })

  test('F38: FirstRunGate stays on / when API has skills (even with empty localStorage)', async ({ page }) => {
    // Fresh-browser scenario: localStorage empty, API has seeded skills.
    // Prior behaviour: gate checked only `getSkills().length` (localStorage =
    // 0) and redirected to /integrations even though the API was healthy.
    // Fixed: now checks API /v1/skills too, so seeded skills count.
    await page.route('**/v1/skills', (r) =>
      r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(SEED_SKILLS),
      }),
    )
    await page.route('**/v1/setup/agents', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/collections', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/ratings', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')

    // Should land on /, NOT redirect to /integrations.
    await expect
      .poll(() => page.evaluate(() => location.pathname), { timeout: 5000 })
      .toBe('/')
  })

  test('F38: FirstRunGate redirects to /integrations when BOTH api skills + agents are empty', async ({ page }) => {
    // Cross-check: when the API has 0 skills AND 0 agents, the redirect
    // should still fire (it's the activation funnel for genuinely-empty
    // setups). Without this, F38 would over-correct and never redirect.
    await page.route('**/v1/skills', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/setup/agents', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/collections', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/ratings', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    // Visit a page that ISN'T `/` to set origin in the browser context, then
    // wipe storage, then navigate to `/` to fire the gate fresh.
    await page.goto('/integrations')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto('/')

    await expect
      .poll(() => page.evaluate(() => location.pathname), { timeout: 5000 })
      .toBe('/integrations')
  })

  test('F40/F43: <head> script captures ?api= synchronously, before first React fetch', async ({ page }) => {
    // The synchronous <head> script must write localStorage BEFORE any
    // React-side fetch reads it. The load-bearing assertion is that
    // `localStorage['skillnote:api-url']` is the overridden value
    // immediately after navigation completes — the head script runs
    // before client React hydrates, so by the time we can `page.evaluate`,
    // the override has landed.
    await page.route('**/v1/skills', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEED_SKILLS) }),
    )
    await page.route('**/v1/setup/agents', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/collections', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    // Override to a port the default-baked bundle does NOT use.
    await page.goto('/?api=http%3A%2F%2Flocalhost%3A8092')

    expect(
      await page.evaluate(() => localStorage.getItem('skillnote:api-url')),
    ).toBe('http://localhost:8092')
  })

  test('F52: corrupted localStorage[api-url] is rejected; getApiBaseUrl falls back', async ({ page }) => {
    // Garbage written to api-url should NOT become a relative URL fetched
    // against the page origin. Fix in `src/lib/api/client.ts:isValidApiUrl`
    // rejects anything not parseable as http(s) and self-heals the key.
    await page.route('**/v1/skills', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEED_SKILLS) }),
    )
    await page.route('**/v1/setup/agents', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem('skillnote:api-url', 'definitely-not-a-url')
      localStorage.setItem('skillnote:skills', '{this is not valid json')
    })
    await page.goto('/')

    // F52: the malformed api-url should have been wiped (self-heal).
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('skillnote:api-url')))
      .toBeNull()

    // F53: the malformed JSON in skills got wiped on read AND re-synced
    // from the API (we mocked 2 skills).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          try {
            const arr = JSON.parse(localStorage.getItem('skillnote:skills') ?? '[]')
            return Array.isArray(arr) ? arr.length : -1
          } catch {
            return -1
          }
        }),
      )
      .toBeGreaterThan(0)
  })

  test('F49: delete-skill dialog is an ARIA alertdialog', async ({ page }) => {
    // The delete confirm dialog used to be a bare div — screen readers and
    // accessibility scanners missed it. Now `role="alertdialog"` with
    // `aria-modal`, `aria-labelledby`, `aria-describedby`.
    await page.route('**/v1/skills', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEED_SKILLS) }),
    )
    await page.route('**/v1/skills/r9-seed-a', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...SEED_SKILLS[0], content_md: '# r9-seed-a', current_version: 1 }),
      }),
    )
    await page.route('**/v1/skills/r9-seed-a/comments', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/ratings/r9-seed-a', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    await page.route('**/v1/analytics/ratings/r9-seed-a/reviews**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/collections', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/skills/r9-seed-a')
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('button', { name: 'Delete Skill' }).click()

    // The dialog is now an alertdialog with the expected label/description.
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName(/Delete\s+/)
    await expect(dialog).toHaveAccessibleDescription(/permanently delete/i)
  })

  test('F50: backend-offline banner is role=status with aria-live polite', async ({ page }) => {
    // Pin the connection banner has a status role + polite aria-live so
    // screen readers announce connectivity changes without yelling.
    // To trigger offline we just need the connection status to be 'offline',
    // which is the module-level default until syncSkillsFromApi succeeds.
    await page.route('**/v1/skills', (r) => r.abort('failed'))
    await page.route('**/v1/setup/agents', (r) => r.abort('failed'))

    await page.goto('/')

    const banner = page.locator('[role="status"][aria-label="Backend connection status"]')
    await expect(banner).toBeVisible({ timeout: 5000 })
    await expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  test('F61: Disconnect modal has explicit Cancel + destructive buttons paired', async ({ page }) => {
    // Pins the connect-page focused round: destructive modals MUST offer a
    // visible Cancel beside the destructive action (not just X / ESC / click
    // outside) for keyboard + touch users.
    await page.route('**/v1/setup/agents', (r) =>
      r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { agent: 'claude-code', state: 'active', installed_at: '2026-05-13T00:00:00Z', last_active_at: null, calls_24h: 0, calls_7d: 0 },
          { agent: 'openclaw', state: 'pending', installed_at: null, last_active_at: null, calls_24h: 0, calls_7d: 0 },
        ]),
      }),
    )
    await page.route('**/v1/skills', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/integrations')

    // Expand the Connected row to surface the Disconnect button.
    await page.getByRole('button', { name: /Claude Code.*Connected/ }).click()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()

    const dialog = page.getByRole('alertdialog', { name: 'Disconnect Claude Code' })
    await expect(dialog).toBeVisible()
    // The pair: Cancel + destructive — both reachable + clearly labelled.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Disconnect Claude Code/ })).toBeVisible()
  })

  test('F32: previously-synced skill missing from API is dropped; genuinely-local survives', async ({ page }) => {
    await mockSkillsApi(page)
    // Seed localStorage BEFORE first navigation by using a route handler that
    // populates state. Easier: navigate once to set origin, then inject.
    await page.goto('/')
    await page.evaluate((apiSlugs) => {
      const fixtures = [
        {
          slug: 'r9-genuinely-local',
          title: 'r9-genuinely-local',
          description: 'no _syncedAt → survives reset',
          content_md: '# r9-genuinely-local',
          collections: [],
          current_version: 1,
          created_at: '2026-05-13T00:00:00Z',
          updated_at: '2026-05-13T00:00:00Z',
        },
        {
          slug: 'r9-ghost',
          title: 'r9-ghost',
          description: 'had _syncedAt, now api forgot → drop',
          content_md: '# r9-ghost',
          collections: [],
          current_version: 1,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:00Z',
          _syncedAt: '2026-05-12T00:00:00Z',
        },
        // Also include the seed skills so the merge has something on both sides.
        ...apiSlugs.map((slug) => ({
          slug,
          title: slug,
          description: '',
          content_md: '',
          collections: [],
          current_version: 1,
          created_at: '2026-05-13T00:00:00Z',
          updated_at: '2026-05-13T00:00:00Z',
          _syncedAt: '2026-05-12T00:00:00Z',
        })),
      ]
      localStorage.setItem('skillnote:skills', JSON.stringify(fixtures))
    }, SEED_SKILLS.map((s) => s.slug))

    // Reload to trigger syncSkillsFromApi() — that's where the cleanup happens.
    await page.goto('/')

    // Poll for the merge result.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const arr = JSON.parse(localStorage.getItem('skillnote:skills') ?? '[]')
          return arr.map((s: { slug: string }) => s.slug).sort()
        }),
      )
      .toEqual(['r9-genuinely-local', 'r9-seed-a', 'r9-seed-b'])
  })
})
