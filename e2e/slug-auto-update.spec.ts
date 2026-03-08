import { test, expect, type Page } from '@playwright/test'

// ─── FIXTURES ────────────────────────────────────────────────────────

const SEED_SKILLS = [
  {
    slug: 'api-reviewer',
    title: 'api-reviewer',
    description: 'Reviews API designs for best practices.',
    content_md: '# API Reviewer\n\nReviews API designs.',
    tags: ['api', 'review'],
    collections: ['Dev Tools'],
    current_version: 2,
    created_at: '2026-02-10T10:00:00Z',
    updated_at: '2026-02-20T14:30:00Z',
    comments: [],
  },
  {
    slug: 'code-formatter',
    title: 'code-formatter',
    description: 'Formats code according to style guides.',
    content_md: '# Code Formatter\n\nFormats code.',
    tags: ['formatting'],
    collections: [],
    current_version: 1,
    created_at: '2026-02-08T10:00:00Z',
    updated_at: '2026-02-19T09:00:00Z',
    comments: [],
  },
]

// ─── HELPERS ─────────────────────────────────────────────────────────

/** Mock all /v1/** API calls. Supports slug rename via PATCH. */
async function mockApi(page: Page, skills: typeof SEED_SKILLS = []) {
  const apiList = skills.map(s => ({
    name: s.title, slug: s.slug, description: s.description,
    tags: s.tags, collections: s.collections, currentVersion: s.current_version,
  }))

  // Track renames — when a PATCH changes name, update slug in our mock state
  const slugMap = new Map(skills.map(s => [s.slug, { ...s }]))

  await page.route('**/v1/**', (route, request) => {
    const url = new URL(request.url())
    const path = url.pathname

    if (request.method() === 'GET' && path === '/v1/skills') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiList) })
    }

    if (request.method() === 'GET' && path === '/v1/tags') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }

    if (request.method() === 'GET' && /^\/v1\/skills\/[^/]+$/.test(path)) {
      const slug = path.split('/').pop()!
      const skill = slugMap.get(slug)
      if (skill) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          id: slug, name: skill.title, slug: skill.slug, description: skill.description,
          content_md: skill.content_md, tags: skill.tags, collections: skill.collections,
          current_version: skill.current_version, created_at: skill.created_at, updated_at: skill.updated_at,
        })})
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"SKILL_NOT_FOUND"}}' })
    }

    if (request.method() === 'GET' && /\/content-versions$/.test(path)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    if (request.method() === 'GET' && /\/comments$/.test(path)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }

    // PATCH /v1/skills/:slug — the key endpoint for rename testing
    if (request.method() === 'PATCH' && /^\/v1\/skills\/[^/]+$/.test(path)) {
      const oldSlug = path.split('/').pop()!
      const skill = slugMap.get(oldSlug)
      const now = new Date().toISOString()
      try {
        const body = JSON.parse(request.postData() || '{}')
        const newName = body.name ?? skill?.title ?? oldSlug
        // Derive new slug from name (same logic as backend _slugify)
        const newSlug = newName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

        const updated = {
          id: skill?.slug || oldSlug,
          name: newName,
          slug: newSlug || oldSlug,
          description: body.description ?? skill?.description ?? '',
          content_md: body.content_md ?? skill?.content_md ?? '',
          tags: body.tags ?? skill?.tags ?? [],
          collections: body.collections ?? skill?.collections ?? [],
          current_version: (skill?.current_version || 0) + 1,
          created_at: skill?.created_at || now,
          updated_at: now,
        }

        // Update mock state
        if (newSlug && newSlug !== oldSlug) {
          slugMap.delete(oldSlug)
          slugMap.set(newSlug, { ...SEED_SKILLS[0], ...updated, title: newName, slug: newSlug })
        }

        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
      } catch { /* fall through */ }
    }

    // POST /v1/skills — create
    if (request.method() === 'POST' && path === '/v1/skills') {
      try {
        const body = JSON.parse(request.postData() || '{}')
        const now = new Date().toISOString()
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          id: body.slug || 'new', name: body.name, slug: body.slug,
          description: body.description || '', content_md: body.content_md || '',
          tags: body.tags || [], collections: body.collections || [],
          current_version: 1, created_at: now, updated_at: now,
        })})
      } catch { /* fall through */ }
    }

    // DELETE
    if (request.method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function seedAndNavigate(page: Page) {
  await mockApi(page, SEED_SKILLS)
  await page.goto('/')
  await page.evaluate((skills) => {
    localStorage.setItem('skillnote:skills', JSON.stringify(skills))
  }, SEED_SKILLS)
}

/** Click a button that may be unstable due to React re-renders */
async function clickUnstableButton(page: Page, name: string) {
  // Wait for re-renders to settle, then force-click
  await page.waitForTimeout(2000)
  await page.evaluate((buttonName) => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const btn = buttons.find(b => b.textContent?.trim() === buttonName)
    if (btn) btn.click()
    else throw new Error(`Button "${buttonName}" not found`)
  }, name)
}

async function getStoredSkills(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('skillnote:skills')
    return raw ? JSON.parse(raw) : []
  })
}

// ─── TESTS: Slug auto-update on rename ──────────────────────────────

test.describe('Slug auto-update — Rename via edit', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndNavigate(page)
  })

  test('renaming a skill updates the URL to new slug', async ({ page }) => {
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')
    // Enter edit mode (use JS click to avoid detach during React re-renders)
    await clickUnstableButton(page, 'Edit Skill')
    await expect(page.locator('.fixed.inset-0')).toBeVisible()

    // Clear and type new name
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('')
    await nameInput.fill('code-reviewer')

    // Save
    await page.getByRole('button', { name: /Save/ }).click()
    // If there's a confirmation dialog, confirm it
    const confirmBtn = page.locator('.bg-card').getByRole('button', { name: /Save/ })
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.click()
    }

    // URL should update to new slug
    await page.waitForURL('**/skills/code-reviewer', { timeout: 5000 })
    expect(page.url()).toContain('/skills/code-reviewer')
  })

  test('localStorage updates slug after rename', async ({ page }) => {
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Edit Skill' }).click()
    await expect(page.locator('.fixed.inset-0')).toBeVisible()

    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('')
    await nameInput.fill('renamed-skill')

    await page.getByRole('button', { name: /Save/ }).click()
    const confirmBtn = page.locator('.bg-card').getByRole('button', { name: /Save/ })
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.click()
    }

    await page.waitForTimeout(2000)

    const skills = await getStoredSkills(page)
    const slugs = skills.map((s: any) => s.slug)
    expect(slugs).toContain('renamed-skill')
    expect(slugs).not.toContain('api-reviewer')
  })

  test('old slug returns not found after rename', async ({ page }) => {
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Edit Skill' }).click()
    await expect(page.locator('.fixed.inset-0')).toBeVisible()

    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('')
    await nameInput.fill('new-name')

    await page.getByRole('button', { name: /Save/ }).click()
    const confirmBtn = page.locator('.bg-card').getByRole('button', { name: /Save/ })
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.click()
    }

    await page.waitForTimeout(2000)

    // Navigate to old slug
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')

    // Should show "not found" or empty state
    await expect(page.getByText('not found', { exact: false })).toBeVisible({ timeout: 5000 })
  })
})

// ─── TESTS: Slack-style name input ──────────────────────────────────

test.describe('Slack-style name input — New Skill page', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/skills/new')
    await page.waitForLoadState('networkidle')
  })

  test('spaces are converted to hyphens as you type', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('my new skill')
    await expect(nameInput).toHaveValue('my-new-skill')
  })

  test('uppercase is converted to lowercase', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('MySkill')
    await expect(nameInput).toHaveValue('myskill')
  })

  test('special characters are stripped', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('my@skill!')
    await expect(nameInput).toHaveValue('myskill')
  })

  test('mixed input normalizes correctly', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('API Reviewer v2!')
    await expect(nameInput).toHaveValue('api-reviewer-v2')
  })

  test('consecutive spaces become single hyphen', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('a   b   c')
    await expect(nameInput).toHaveValue('a-b-c')
  })

  test('pasting uppercase name normalizes it', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    // Simulate paste by filling directly
    await nameInput.fill('CODE REVIEWER')
    await expect(nameInput).toHaveValue('code-reviewer')
  })
})

test.describe('Slack-style name input — Edit mode', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndNavigate(page)
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')
    await clickUnstableButton(page, 'Edit Skill')
    await expect(page.locator('.fixed.inset-0')).toBeVisible()
  })

  test('typing space in edit mode inserts hyphen', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('')
    await nameInput.fill('my new name')
    await expect(nameInput).toHaveValue('my-new-name')
  })

  test('typing uppercase in edit mode lowercases it', async ({ page }) => {
    const nameInput = page.locator('input[placeholder="skill-name"]')
    await nameInput.fill('')
    await nameInput.fill('NewName')
    await expect(nameInput).toHaveValue('newname')
  })
})

// ─── TESTS: Import flow → Review & Create ───────────────────────────

test.describe('Import flow — Review before create', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('import modal shows "Review & Create" instead of "Import"', async ({ page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await expect(page.getByText('Import Skills')).toBeVisible()

    // Upload a file
    const content = `---\nname: test-skill\ndescription: A test skill.\n---\n\n# Test Skill\n\nContent here.`
    const filePath = '/tmp/skillnote-e2e-slug/test-skill.md'
    await page.evaluate((p) => {
      // Use the filesystem mock — write via test helper
    }, filePath)

    // Create file via Node.js context
    const fs = require('fs')
    const path = require('path')
    const dir = '/tmp/skillnote-e2e-slug'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'test-skill.md'), content)

    await page.locator('input[type=file]').setInputFiles(path.join(dir, 'test-skill.md'))
    await page.waitForTimeout(500)

    // Should show "Review & Create" button, not "Import N skills"
    await expect(page.getByRole('button', { name: 'Review & Create' })).toBeVisible()
  })

  test('Review & Create navigates to /skills/new with prefilled data', async ({ page }) => {
    await page.getByRole('button', { name: 'Import' }).click()

    const fs = require('fs')
    const path = require('path')
    const dir = '/tmp/skillnote-e2e-slug'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const content = `---\nname: imported-skill\ndescription: An imported skill.\n---\n\n# Imported\n\nBody content.`
    fs.writeFileSync(path.join(dir, 'imported.md'), content)

    await page.locator('input[type=file]').setInputFiles(path.join(dir, 'imported.md'))
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'Review & Create' }).click()

    // Should navigate to /skills/new with query params
    await page.waitForURL('**/skills/new**', { timeout: 5000 })
    expect(page.url()).toContain('/skills/new')
    expect(page.url()).toContain('name=imported-skill')
  })

  test('prefilled name is editable on /skills/new', async ({ page }) => {
    // Navigate directly with prefilled params
    await page.goto('/skills/new?name=imported-skill&description=Test+description')
    await page.waitForLoadState('networkidle')

    const nameInput = page.locator('input[placeholder="skill-name"]')
    await expect(nameInput).toHaveValue('imported-skill')

    // Should be editable
    await nameInput.fill('')
    await nameInput.fill('better-name')
    await expect(nameInput).toHaveValue('better-name')
  })

  test('import shows validation error for invalid names', async ({ page }) => {
    await page.getByRole('button', { name: 'Import' }).click()

    const fs = require('fs')
    const path = require('path')
    const dir = '/tmp/skillnote-e2e-slug'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // Reserved name — will fail validation after normalization
    const content = `---\nname: anthropic\ndescription: Bad name.\n---\n\n# Anthropic\n\nContent.`
    fs.writeFileSync(path.join(dir, 'invalid.md'), content)

    await page.locator('input[type=file]').setInputFiles(path.join(dir, 'invalid.md'))
    await page.waitForTimeout(500)

    // File auto-expands for single file — should show validation error
    const errorText = page.locator('.text-destructive')
    await expect(errorText.first()).toBeVisible()
  })

  test('import shows duplicate warning for existing skill name', async ({ page }) => {
    // Seed an existing skill
    await page.evaluate((skills) => {
      localStorage.setItem('skillnote:skills', JSON.stringify(skills))
    }, SEED_SKILLS)
    await page.reload({ waitUntil: 'networkidle' })

    await page.getByRole('button', { name: 'Import' }).click()

    const fs = require('fs')
    const path = require('path')
    const dir = '/tmp/skillnote-e2e-slug'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // Same name as existing skill
    const content = `---\nname: api-reviewer\ndescription: Duplicate skill.\n---\n\n# Duplicate\n\nContent.`
    fs.writeFileSync(path.join(dir, 'duplicate.md'), content)

    await page.locator('input[type=file]').setInputFiles(path.join(dir, 'duplicate.md'))
    await page.waitForTimeout(500)

    // Should show duplicate warning
    await expect(page.getByText('already exists', { exact: false }).first()).toBeVisible()
  })
})

// ─── TESTS: Delete calls backend ────────────────────────────────────

test.describe('Delete skill — backend integration', () => {
  test('delete calls backend API before removing from localStorage', async ({ page }) => {
    let deleteCalledWith: string | null = null
    const deletedSlugs = new Set<string>()

    await page.route('**/v1/**', (route, request) => {
      const url = new URL(request.url())
      const path = url.pathname

      if (request.method() === 'DELETE' && /^\/v1\/skills\/[^/]+$/.test(path)) {
        deleteCalledWith = path.split('/').pop()!
        deletedSlugs.add(deleteCalledWith)
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }

      if (request.method() === 'GET' && path === '/v1/skills') {
        const remaining = SEED_SKILLS.filter(s => !deletedSlugs.has(s.slug))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
          remaining.map(s => ({ name: s.title, slug: s.slug, description: s.description, tags: s.tags, collections: s.collections, currentVersion: s.current_version }))
        )})
      }

      if (request.method() === 'GET' && /^\/v1\/skills\/[^/]+$/.test(path)) {
        const slug = path.split('/').pop()!
        if (deletedSlugs.has(slug)) {
          return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"SKILL_NOT_FOUND"}}' })
        }
        const skill = SEED_SKILLS.find(s => s.slug === slug)
        if (skill) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            id: slug, name: skill.title, slug: skill.slug, description: skill.description,
            content_md: skill.content_md, tags: skill.tags, collections: skill.collections,
            current_version: skill.current_version, created_at: skill.created_at, updated_at: skill.updated_at,
          })})
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{}}' })
      }

      if (request.method() === 'GET' && /\/comments$/.test(path)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      if (request.method() === 'GET' && path === '/v1/tags') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }

      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/')
    await page.evaluate((skills) => {
      localStorage.setItem('skillnote:skills', JSON.stringify(skills))
    }, SEED_SKILLS)
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')
    // Open more menu (use JS click to avoid detach during React re-renders)
    await page.waitForTimeout(2000)
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="More options"]') as HTMLButtonElement
      if (btn) btn.click()
      else throw new Error('More options button not found')
    })
    await page.waitForTimeout(300)
    await page.getByText('Delete Skill').click()
    await page.waitForTimeout(300)

    // Confirm delete
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.waitForTimeout(2000)

    // Verify API was called
    expect(deleteCalledWith).toBe('api-reviewer')
    // Wait for sync to settle, then verify skill is gone from localStorage
    await page.waitForTimeout(1000)
    const skills = await getStoredSkills(page)
    const slugs = skills.map((s: any) => s.slug)
    expect(slugs).not.toContain('api-reviewer')
  })

  test('delete shows error toast when backend fails', async ({ page }) => {
    await page.route('**/v1/**', (route, request) => {
      const url = new URL(request.url())
      const path = url.pathname

      // Fail the DELETE call
      if (request.method() === 'DELETE') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal error"}' })
      }

      if (request.method() === 'GET' && path === '/v1/skills') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
          SEED_SKILLS.map(s => ({ name: s.title, slug: s.slug, description: s.description, tags: s.tags, collections: s.collections, currentVersion: s.current_version }))
        )})
      }

      if (request.method() === 'GET' && /^\/v1\/skills\/[^/]+$/.test(path)) {
        const slug = path.split('/').pop()!
        const skill = SEED_SKILLS.find(s => s.slug === slug)
        if (skill) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            id: slug, name: skill.title, slug: skill.slug, description: skill.description,
            content_md: skill.content_md, tags: skill.tags, collections: skill.collections,
            current_version: skill.current_version, created_at: skill.created_at, updated_at: skill.updated_at,
          })})
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{}}' })
      }

      if (request.method() === 'GET' && /\/comments$/.test(path)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      if (request.method() === 'GET' && path === '/v1/tags') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }

      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/')
    await page.evaluate((skills) => {
      localStorage.setItem('skillnote:skills', JSON.stringify(skills))
    }, SEED_SKILLS)
    await page.goto('/skills/api-reviewer')
    await page.waitForLoadState('networkidle')
    // Open more menu (use JS click to avoid detach during React re-renders)
    await page.waitForTimeout(2000)
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="More options"]') as HTMLButtonElement
      if (btn) btn.click()
      else throw new Error('More options button not found')
    })
    await page.waitForTimeout(300)
    await page.getByText('Delete Skill').click()
    await page.waitForTimeout(300)

    // Confirm delete
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.waitForTimeout(2000)

    // Should show error toast
    await expect(page.getByText('Failed to delete', { exact: false })).toBeVisible({ timeout: 5000 })

    // Skill should still be in localStorage (not removed)
    const skills = await getStoredSkills(page)
    const slugs = skills.map((s: any) => s.slug)
    expect(slugs).toContain('api-reviewer')
  })
})

// ─── TESTS: New Skill modal — Slack-style input ─────────────────────

test.describe('New Skill Modal — Slack-style name input', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('new skill modal normalizes name input', async ({ page }) => {
    // Open new skill modal (the + button or "New Skill" in sidebar)
    const newBtn = page.locator('a, button').filter({ hasText: 'New Skill' }).first()
    if (await newBtn.isVisible()) {
      await newBtn.click()
    }

    // If it navigates to /skills/new, test there
    if (page.url().includes('/skills/new')) {
      const nameInput = page.locator('input[placeholder="skill-name"]')
      await nameInput.fill('API Reviewer v2')
      await expect(nameInput).toHaveValue('api-reviewer-v2')
    }
  })
})
