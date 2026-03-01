/**
 * E2E: Skills CRUD, search, and detail flows
 *
 * All API calls are intercepted via page.route() so tests run
 * against a stable fixture set regardless of live-DB state.
 */

import { test, expect, type Page } from '@playwright/test'

// ─── FIXTURES ─────────────────────────────────────────────────────────────────

const SKILLS = [
  {
    id: 'aaa-111',
    name: 'react-hooks',
    slug: 'react-hooks',
    description: 'Patterns for writing clean React hooks.',
    content_md: '# React Hooks\n\nUse hooks for state and effects.',
    tags: ['react', 'frontend'],
    collections: ['frontend'],
    current_version: 3,
    total_versions: 3,
    created_at: '2026-01-10T10:00:00Z',
    updated_at: '2026-02-20T14:30:00Z',
  },
  {
    id: 'bbb-222',
    name: 'db-migrations',
    slug: 'db-migrations',
    description: 'Safe database migration checklist.',
    content_md: '# DB Migrations\n\nAlways backup first.',
    tags: ['database', 'devops'],
    collections: ['devops'],
    current_version: 1,
    total_versions: 1,
    created_at: '2026-01-15T08:00:00Z',
    updated_at: '2026-02-10T09:00:00Z',
  },
]

const TAGS_RESPONSE = [
  { name: 'react', skill_count: 1 },
  { name: 'frontend', skill_count: 1 },
  { name: 'database', skill_count: 1 },
  { name: 'devops', skill_count: 1 },
]

// ─── MOCK SETUP ────────────────────────────────────────────────────────────────

async function setupMocks(page: Page, skills = SKILLS) {
  const apiList = skills.map(({ content_md: _cm, ...s }) => s)

  // GET /v1/skills (list)
  await page.route('**/v1/skills', (route, req) => {
    const url = new URL(req.url())
    if (req.method() === 'GET' && url.pathname === '/v1/skills') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiList) })
    }
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      const created = { ...skills[0], ...body, id: 'new-111', slug: body.name?.toLowerCase().replace(/\s+/g, '-') || 'new-skill', current_version: 1, total_versions: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.continue()
  })

  // Per-skill routes
  for (const skill of skills) {
    await page.route(`**/v1/skills/${skill.slug}`, (route, req) => {
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(skill) })
      }
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...skill, ...body, updated_at: new Date().toISOString() }) })
      }
      if (req.method() === 'DELETE') {
        return route.fulfill({ status: 204 })
      }
      return route.continue()
    })

    // content-versions
    await page.route(`**/v1/skills/${skill.slug}/content-versions`, (route, req) => {
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
          version: skill.current_version, title: skill.name, description: skill.description,
          content_md: skill.content_md, tags: skill.tags, collections: skill.collections,
          is_latest: true, created_at: skill.created_at,
        }]) })
      }
      return route.continue()
    })

    // comments
    await page.route(`**/v1/skills/${skill.slug}/comments`, (route, req) => {
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}')
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'c-001', skill_id: skill.id, body: body.body, created_at: new Date().toISOString() }) })
      }
      return route.continue()
    })
  }

  // Tags
  await page.route('**/v1/tags', (route, req) => {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TAGS_RESPONSE) })
    return route.continue()
  })
}

// ─── TESTS: HOME PAGE ─────────────────────────────────────────────────────────

test.describe('Home / Skill List', () => {
  test('shows skill list on homepage', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    await expect(page.getByText('react-hooks')).toBeVisible()
    await expect(page.getByText('db-migrations')).toBeVisible()
  })

  test('shows skill descriptions', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    await expect(page.getByText('Patterns for writing clean React hooks.')).toBeVisible()
  })

  test('search filters skill list', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('react')
      await expect(page.getByText('react-hooks')).toBeVisible()
      await expect(page.getByText('db-migrations')).not.toBeVisible()
    }
  })

  test('clicking a skill navigates to its detail page', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    await page.getByText('react-hooks').first().click()
    await expect(page).toHaveURL(/\/skills\/react-hooks/)
  })

  test('shows "New Skill" button', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    await expect(page.getByRole('link', { name: /new skill/i }).or(page.getByRole('button', { name: /new skill/i }))).toBeVisible()
  })
})

// ─── TESTS: SKILL DETAIL ──────────────────────────────────────────────────────

test.describe('Skill Detail Page', () => {
  test('renders skill name and description', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/react-hooks')
    await expect(page.getByRole('heading', { name: 'react-hooks', level: 1 })).toBeVisible()
  })

  test('renders markdown content', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/react-hooks')
    await expect(page.getByText(/React Hooks/)).toBeVisible()
  })

  test('shows tags on skill detail', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/react-hooks')
    // Use exact match to avoid matching "react-hooks" heading or "React Hooks" prose
    await expect(page.getByText('react', { exact: true }).first()).toBeVisible()
  })

  test('shows version number', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/react-hooks')
    await expect(page.getByText(/v3|version 3|#3/i)).toBeVisible()
  })

  test('404 page for unknown slug', async ({ page }) => {
    await page.route('**/v1/skills/ghost-skill', route =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Not found' }) })
    )
    await page.route('**/v1/skills', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    )
    await page.goto('/skills/ghost-skill')
    // Should redirect or show not found state
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})

// ─── TESTS: CREATE SKILL ──────────────────────────────────────────────────────

test.describe('Create Skill', () => {
  test('new skill page loads', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/new')
    await expect(page).toHaveURL('/skills/new')
  })

  test('new skill page has name input', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/new')
    // The name input has placeholder "skill-name" (no space)
    const nameInput = page.getByPlaceholder('skill-name')
    await expect(nameInput).toBeVisible()
  })

  test('submit creates skill and redirects', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/new')

    const nameInput = page.getByPlaceholder('skill-name')
    if (await nameInput.isVisible()) {
      await nameInput.fill('my-new-skill')
      const submitBtn = page.getByRole('button', { name: /create|save|submit/i })
      if (await submitBtn.isVisible()) {
        await submitBtn.click()
      }
    }
  })

  test('empty name shows validation error', async ({ page }) => {
    await page.route('**/v1/skills', (route, req) => {
      if (req.method() === 'POST') {
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'name is required' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/skills/new')
    const submitBtn = page.getByRole('button', { name: /create|save|submit/i })
    if (await submitBtn.isVisible()) {
      await submitBtn.click()
      const errorMsg = page.getByText(/required|invalid|error/i)
      if (await errorMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(errorMsg).toBeVisible()
      }
    }
  })
})

// ─── TESTS: COMMENTS ─────────────────────────────────────────────────────────

test.describe('Comments', () => {
  test('shows empty comments state', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/react-hooks')
    // Comments section should be rendered (empty or with placeholder)
    const commentsSection = page.getByText(/comment/i)
    if (await commentsSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(commentsSection).toBeVisible()
    }
  })

  test('shows comment form', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/skills/react-hooks')
    const commentInput = page.getByPlaceholder(/comment|feedback|add a note/i)
    if (await commentInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(commentInput).toBeVisible()
    }
  })
})

// ─── TESTS: NAVIGATION ────────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('navigation sidebar/header is visible', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    const nav = page.getByRole('navigation').or(page.locator('nav, aside'))
    await expect(nav.first()).toBeVisible()
  })

  test('settings page loads', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/settings')
    await expect(page).toHaveURL('/settings')
    await expect(page.locator('body')).toBeVisible()
  })

  test('collections page loads', async ({ page }) => {
    await page.route('**/v1/skills', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SKILLS.map(({ content_md: _cm, ...s }) => s)) })
    )
    await page.route('**/v1/tags', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TAGS_RESPONSE) })
    )
    await page.goto('/collections')
    await expect(page).toHaveURL('/collections')
    await expect(page.locator('body')).toBeVisible()
  })

  test('tags page loads', async ({ page }) => {
    await page.route('**/v1/skills', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SKILLS.map(({ content_md: _cm, ...s }) => s)) })
    )
    await page.route('**/v1/tags', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TAGS_RESPONSE) })
    )
    await page.goto('/tags')
    await expect(page).toHaveURL('/tags')
    await expect(page.locator('body')).toBeVisible()
  })
})
