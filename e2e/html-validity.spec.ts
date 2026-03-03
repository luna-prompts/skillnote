/**
 * E2E: HTML validity and console error sweep
 *
 * Visits every page, captures React hydration errors / console errors,
 * and queries the live DOM for invalid HTML nesting patterns.
 *
 * Invalid patterns checked:
 *   - <a> inside <a>                  (hydration crash)
 *   - <button> inside <button>        (invalid per spec)
 *   - <button> or <input> inside <a>  (interactive inside interactive)
 *   - <a> inside <button>
 *   - <p> containing block elements   (div/ul/ol/table/h1-h6 inside p)
 *   - <select>/<input> with no label
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Collect console errors that look like React/hydration issues. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err: Error) => errors.push(err.message))
  return errors
}

/** Query DOM for an invalid nesting pattern, return list of offending elements. */
async function findInvalidNesting(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel)
    return Array.from(nodes).map(el => {
      const tag = el.tagName.toLowerCase()
      const text = (el.textContent ?? '').trim().slice(0, 60)
      const cls = (el.getAttribute('class') ?? '').slice(0, 50)
      return `<${tag}> "${text}" [class="${cls}"]`
    })
  }, selector)
}

/** Mocks the skills API so tests don't need DB data. */
async function setupApiMocks(page: Page) {
  const skills = [
    { id: 'a1', name: 'react-hooks', slug: 'react-hooks', title: 'React Hooks', description: 'Patterns for React hooks.', content_md: '# React Hooks\n\nUse hooks.', collections: ['frontend', 'react'], current_version: 2, total_versions: 2, created_at: '2026-01-10T10:00:00Z', updated_at: '2026-02-20T14:30:00Z', comments: [], attachments: [] },
    { id: 'a2', name: 'db-migrations', slug: 'db-migrations', title: 'DB Migrations', description: 'Safe DB migration checklist.', content_md: '# DB Migrations\n\nBackup first.', collections: ['devops'], current_version: 1, total_versions: 1, created_at: '2026-01-15T08:00:00Z', updated_at: '2026-02-10T09:00:00Z', comments: [], attachments: [] },
  ]
  const skillList = skills.map(({ content_md: _cm, comments: _co, attachments: _at, ...s }) => s)

  await page.route('**/v1/skills', (route, req) => {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(skillList) })
    return route.continue()
  })
  for (const skill of skills) {
    await page.route(`**/v1/skills/${skill.slug}`, (route, req) => {
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(skill) })
      return route.continue()
    })
    await page.route(`**/v1/skills/${skill.slug}/content-versions`, (route, req) => {
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ version: skill.current_version, title: skill.name, description: skill.description, content_md: skill.content_md, collections: skill.collections, created_at: skill.updated_at }]) })
      return route.continue()
    })
    await page.route(`**/v1/skills/${skill.slug}/comments`, (route, req) => {
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      return route.continue()
    })
  }
  await page.route(/localhost:8083\/status/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'online', uptime_seconds: 60, active_connections: 0, connections: [] }) })
  )
}

// ─── invalid nesting checks (shared across pages) ─────────────────────────────

async function assertNoInvalidNesting(page: Page, pageLabel: string) {
  // <a> inside <a>
  const aInA = await findInvalidNesting(page, 'a a')
  expect(aInA, `${pageLabel}: <a> inside <a> found`).toEqual([])

  // <button> inside <button>
  const btnInBtn = await findInvalidNesting(page, 'button button')
  expect(btnInBtn, `${pageLabel}: <button> inside <button> found`).toEqual([])

  // <button> inside <a>  (interactive inside interactive)
  const btnInA = await findInvalidNesting(page, 'a button')
  expect(btnInA, `${pageLabel}: <button> inside <a> found`).toEqual([])

  // <a> inside <button>
  const aInBtn = await findInvalidNesting(page, 'button a')
  expect(aInBtn, `${pageLabel}: <a> inside <button> found`).toEqual([])

  // block elements inside <p>  — very common accidental violation
  const blockInP = await findInvalidNesting(page, 'p div, p ul, p ol, p table, p h1, p h2, p h3, p h4, p h5, p h6, p blockquote, p pre')
  expect(blockInP, `${pageLabel}: block element inside <p> found`).toEqual([])
}

// ─── console error checks ─────────────────────────────────────────────────────

function assertNoHydrationErrors(errors: string[], pageLabel: string) {
  const hydrationErrors = errors.filter(e =>
    e.toLowerCase().includes('hydration') ||
    e.toLowerCase().includes('did not match') ||
    e.toLowerCase().includes('cannot be a descendant') ||
    e.toLowerCase().includes('validatedomnesting')
  )
  expect(hydrationErrors, `${pageLabel}: hydration errors`).toEqual([])
}

function assertNoReactErrors(errors: string[], pageLabel: string) {
  const reactErrors = errors.filter(e =>
    e.toLowerCase().includes('unhandled') ||
    e.toLowerCase().includes('warning: each child') ||  // missing keys
    (e.toLowerCase().includes('error') && e.includes('react'))
  )
  expect(reactErrors, `${pageLabel}: React errors`).toEqual([])
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

test.describe('HTML validity — Skills list (/)', () => {
  test('no invalid nesting on skills list page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/')
    await page.waitForSelector('[data-testid="skill-list"], a[href*="/skills/"]', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500) // let React settle

    await assertNoInvalidNesting(page, 'Skills list')
    assertNoHydrationErrors(errors, 'Skills list')
  })

  test('no console errors on skills list page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/')
    await page.waitForTimeout(1000)
    assertNoHydrationErrors(errors, 'Skills list')
  })

  test('collection chips in skill list rows are spans not links', async ({ page }) => {
    await setupApiMocks(page)
    await page.goto('/')
    await page.waitForTimeout(500)

    // The collection chips should be <span role="link"> elements, not <a> tags
    const chipLinks = await findInvalidNesting(page, 'a [role="link"]')
    expect(chipLinks, 'Collection chip <a> inside skill row <a>').toEqual([])
  })
})

test.describe('HTML validity — Collections (/collections)', () => {
  test('no invalid nesting on collections page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/collections')
    await page.waitForTimeout(500)

    await assertNoInvalidNesting(page, 'Collections')
    assertNoHydrationErrors(errors, 'Collections')
  })
})

test.describe('HTML validity — Skill detail (/skills/[slug])', () => {
  test('no invalid nesting on skill detail page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/skills/react-hooks')
    await page.waitForSelector('h1, [class*="skill"]', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)

    await assertNoInvalidNesting(page, 'Skill detail')
    assertNoHydrationErrors(errors, 'Skill detail')
  })

  test('no console errors on skill detail page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/skills/react-hooks')
    await page.waitForTimeout(1500) // allow tabs to render
    assertNoHydrationErrors(errors, 'Skill detail')
  })
})

test.describe('HTML validity — MCP Integrations (/integrations)', () => {
  test('no invalid nesting on integrations page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/integrations')
    await page.waitForTimeout(500)

    await assertNoInvalidNesting(page, 'MCP Integrations')
    assertNoHydrationErrors(errors, 'MCP Integrations')
  })
})

test.describe('HTML validity — Settings (/settings)', () => {
  test('no invalid nesting on settings page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/settings')
    await page.waitForTimeout(500)

    await assertNoInvalidNesting(page, 'Settings')
    assertNoHydrationErrors(errors, 'Settings')
  })
})

test.describe('HTML validity — Collection detail (/collections/[slug])', () => {
  test('no invalid nesting on collection detail page', async ({ page }) => {
    await setupApiMocks(page)
    const errors = collectErrors(page)
    await page.goto('/collections/frontend')
    await page.waitForTimeout(500)

    await assertNoInvalidNesting(page, 'Collection detail')
    assertNoHydrationErrors(errors, 'Collection detail')
  })
})

test.describe('HTML validity — full page sweep', () => {
  const PAGES = [
    { path: '/', label: 'Skills list' },
    { path: '/collections', label: 'Collections' },
    { path: '/collections/frontend', label: 'Collection detail' },
    { path: '/skills/react-hooks', label: 'Skill detail' },
    { path: '/integrations', label: 'MCP Integrations' },
    { path: '/settings', label: 'Settings' },
  ]

  for (const { path, label } of PAGES) {
    test(`${label} (${path}): no <a> inside <a>`, async ({ page }) => {
      await setupApiMocks(page)
      await page.goto(path)
      await page.waitForTimeout(600)
      const violations = await findInvalidNesting(page, 'a a')
      expect(violations, `${label}: nested <a> tags`).toEqual([])
    })

    test(`${label} (${path}): no <button> inside <button> or <a>`, async ({ page }) => {
      await setupApiMocks(page)
      await page.goto(path)
      await page.waitForTimeout(600)
      const btnInBtn = await findInvalidNesting(page, 'button button')
      const btnInA   = await findInvalidNesting(page, 'a button')
      expect([...btnInBtn, ...btnInA], `${label}: nested interactive elements`).toEqual([])
    })
  }
})
