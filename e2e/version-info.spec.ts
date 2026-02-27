import { test, expect, type Page } from '@playwright/test'

// Minimal skill data matching the Skill type — enough to render the detail page
const SEED_SKILLS = [
  {
    slug: 'react-component-patterns',
    title: 'react-component-patterns',
    description: 'Best practices for building reusable React components.',
    content_md: '# React Patterns\n\nSome content here.',
    tags: ['react', 'typescript'],
    collections: ['Frontend'],
    current_version: 3,
    created_at: '2026-02-10T10:00:00Z',
    updated_at: '2026-02-20T14:30:00Z',
    comments: [],
  },
  {
    slug: 'api-error-handling',
    title: 'api-error-handling',
    description: 'Standardized error handling for REST APIs.',
    content_md: '# API Error Handling\n\nContent here.',
    tags: ['api', 'typescript'],
    collections: ['Backend'],
    current_version: 1,
    created_at: '2026-02-08T10:00:00Z',
    updated_at: '2026-02-19T09:00:00Z',
    comments: [],
  },
]

const SKILL_SLUG = 'react-component-patterns'
const SKILL_URL = `/skills/${SKILL_SLUG}`
const NEW_SKILL_URL = '/skills/new'

// Seed localStorage before each test — also mock API so sync doesn't overwrite
async function seedStorage(page: Page) {
  // Mock /v1/skills list to return seeded data in API format
  const apiSkills = SEED_SKILLS.map(s => ({
    name: s.title,
    slug: s.slug,
    description: s.description,
    tags: s.tags,
    collections: s.collections,
    currentVersion: s.current_version,
  }))
  await page.route('**/v1/skills', (route, request) => {
    // Only intercept the list endpoint, not /v1/skills/<slug>
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/v1/skills') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiSkills) })
    }
    return route.continue()
  })
  // Mock individual skill detail endpoints
  for (const skill of SEED_SKILLS) {
    await page.route(`**/v1/skills/${skill.slug}`, (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: skill.slug,
            name: skill.title,
            slug: skill.slug,
            description: skill.description,
            content_md: skill.content_md,
            tags: skill.tags,
            collections: skill.collections,
            current_version: skill.current_version,
            created_at: skill.created_at,
            updated_at: skill.updated_at,
          }),
        })
      }
      if (request.method() === 'PATCH') {
        // Accept updates and return updated skill
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: skill.slug,
            name: skill.title,
            slug: skill.slug,
            description: skill.description,
            content_md: skill.content_md,
            tags: skill.tags,
            collections: skill.collections,
            current_version: skill.current_version + 1,
            created_at: skill.created_at,
            updated_at: new Date().toISOString(),
          }),
        })
      }
      return route.continue()
    })
    // Mock content-versions endpoint
    await page.route(`**/v1/skills/${skill.slug}/content-versions`, (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            version: skill.current_version,
            title: skill.title,
            description: skill.description,
            content_md: skill.content_md,
            tags: skill.tags,
            collections: skill.collections,
            is_latest: true,
            created_at: skill.created_at,
          }]),
        })
      }
      return route.continue()
    })
    // Mock comments endpoint
    await page.route(`**/v1/skills/${skill.slug}/comments`, (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      return route.continue()
    })
  }
  // Navigate to a page first so we can access localStorage on the right origin
  await page.goto('/')
  await page.evaluate((skills) => {
    localStorage.setItem('skillnote:skills', JSON.stringify(skills))
  }, SEED_SKILLS)
}

async function enterEditMode(page: Page) {
  await page.goto(SKILL_URL)
  await page.waitForLoadState('networkidle')
  // Click the Edit button in the header
  await page.getByRole('button', { name: 'Edit' }).click()
  // Wait for the fullscreen editor overlay to appear
  await expect(page.locator('.fixed.inset-0')).toBeVisible()
}

// ─── SETUP ─────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await seedStorage(page)
})

// ─── SECTION 1: Slug line shows version info ──────────────────────

test.describe('Version transition in top bar', () => {
  test('edit mode shows "v3 → v4" in the top bar', async ({ page }) => {
    await enterEditMode(page)
    // Version transition is in the top bar (header)
    const topBar = page.locator('.fixed.inset-0 .border-b').first()
    await expect(topBar.getByText('v3 → v4')).toBeVisible()
  })
})

// ─── SECTION 2: Top bar shows version context ─────────────────────

test.describe('Top bar version context', () => {
  test('edit mode (no changes) shows version transition in top bar', async ({ page }) => {
    await enterEditMode(page)
    const topBar = page.locator('.fixed.inset-0 .border-b').first()
    await expect(topBar.getByText('v3 → v4')).toBeVisible()
  })

  test('edit mode (with changes) shows unsaved indicator + version transition', async ({ page }) => {
    await enterEditMode(page)
    // Make a change to trigger dirty state
    await page.locator('textarea[placeholder*="Describe what this skill"]').fill('Modified description')
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    await expect(page.getByText('v3 → v4')).toBeVisible()
  })
})

// ─── SECTION 3: Save button shows version ─────────────────────────

test.describe('Save button label', () => {
  test('edit mode save button says "Save as v4"', async ({ page }) => {
    await enterEditMode(page)
    await expect(page.getByRole('button', { name: 'Save as v4' })).toBeVisible()
  })

  test('create mode save button says "Create Skill"', async ({ page }) => {
    await page.goto(NEW_SKILL_URL)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: 'Create Skill' })).toBeVisible()
  })
})

// ─── SECTION 4: Save confirmation flow (edit mode) ────────────────

test.describe('Save confirmation flow', () => {
  test('clicking "Save as v4" shows confirmation popup with version transition', async ({ page }) => {
    await enterEditMode(page)
    await page.getByRole('button', { name: 'Save as v4' }).click()
    // Popup dialog should appear with version info
    // Shows the v3 → v4 visual transition
    await expect(page.locator('.bg-card').getByText('v3', { exact: true })).toBeVisible()
    await expect(page.locator('.bg-card').getByText('v4', { exact: true })).toBeVisible()
    // Shows the skill name
    await expect(page.locator('.bg-card').getByText('react-component-patterns')).toBeVisible()
    // Has Save and Cancel buttons
    await expect(page.locator('.bg-card').getByRole('button', { name: /Save v4/ })).toBeVisible()
    await expect(page.locator('.bg-card').getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('cancel in confirmation popup dismisses it', async ({ page }) => {
    await enterEditMode(page)
    await page.getByRole('button', { name: 'Save as v4' }).click()
    await expect(page.locator('.bg-card').getByText('v4', { exact: true })).toBeVisible()
    // Click Cancel in the popup
    await page.locator('.bg-card').getByRole('button', { name: 'Cancel' }).click()
    // Popup should disappear
    await expect(page.getByText('Save as version 4?')).not.toBeVisible()
    // Original save button still visible
    await expect(page.getByRole('button', { name: 'Save as v4' })).toBeVisible()
  })

  test('confirm save triggers save and shows version toast', async ({ page }) => {
    await enterEditMode(page)
    // Make a change
    await page.locator('textarea[placeholder*="Describe what this skill"]').fill('Updated description')
    await page.getByRole('button', { name: 'Save as v4' }).click()
    await page.locator('.bg-card').getByRole('button', { name: /Save v4/ }).click()
    // Toast should show with version
    await expect(page.getByText('Saved as v4')).toBeVisible({ timeout: 5000 })
  })
})

// ─── SECTION 5: Create mode has no confirmation ───────────────────

test.describe('Create mode — no confirmation', () => {
  test('create mode saves directly without confirmation bar', async ({ page }) => {
    await page.goto(NEW_SKILL_URL)
    await page.waitForLoadState('networkidle')
    // Fill required fields
    await page.locator('input[placeholder="skill-name"]').fill('e2e-test-skill')
    await page.locator('textarea[placeholder*="Describe what this skill"]').fill('Test description')
    // Click Create Skill
    await page.getByRole('button', { name: 'Create Skill' }).click()
    // No confirmation popup should appear
    await expect(page.getByText('New version of')).not.toBeVisible()
  })
})

// ─── SECTION 6: Version increments after save ─────────────────────

test.describe('Version increment after save', () => {
  test('after saving, re-entering edit shows incremented version', async ({ page }) => {
    await page.goto('/skills/api-error-handling')
    await page.waitForLoadState('networkidle')
    // Enter edit mode
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.fixed.inset-0')).toBeVisible()
    // Should show v1 → v2
    await expect(page.getByText('v1 → v2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save as v2' })).toBeVisible()
    // Make a change and save
    await page.locator('textarea[placeholder*="Describe what this skill"]').fill('Updated API error handling')
    await page.getByRole('button', { name: 'Save as v2' }).click()
    await page.locator('.bg-card').getByRole('button', { name: /Save v2/ }).click()
    await expect(page.getByText('Saved as v2')).toBeVisible({ timeout: 5000 })
    // Wait for view mode transition
    await page.waitForTimeout(2000)
    // Re-enter edit mode
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.fixed.inset-0')).toBeVisible()
    // Now should show v2 → v3
    await expect(page.getByText('v2 → v3')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save as v3' })).toBeVisible()
  })
})

// ─── SECTION 7: Header version badge ──────────────────────────────

test.describe('Header version badge', () => {
  test('skill detail header shows version badge', async ({ page }) => {
    await page.goto(SKILL_URL)
    await page.waitForLoadState('networkidle')
    // The header shows a version badge with "v3"
    await expect(page.locator('text=v3').first()).toBeVisible()
  })
})

// ─── SECTION 8: Discard button still works ────────────────────────

test.describe('Discard button in versioned footer', () => {
  test('discard button visible when dirty in edit mode', async ({ page }) => {
    await enterEditMode(page)
    // Make a change
    await page.locator('textarea[placeholder*="Describe what this skill"]').fill('Changed')
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible()
  })
})
