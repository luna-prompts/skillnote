import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ─── FIXTURES ────────────────────────────────────────────────────────

const SKILL_MD = `---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance.
---

# Skill Creator

A skill for creating new skills and iteratively improving them.

## Features
- Draft skills from scratch
- Run evaluations
- Optimize descriptions
`

const SKILL_NO_NAME_MD = `---
title: My Custom Title
description: A skill without a name field.
---

# Heading Title

Some content here.
`

const SKILL_MINIMAL_MD = `# Bare Skill

This skill has no frontmatter at all.
Just raw markdown content.
`

const SKILL_WITH_TAGS_MD = `---
name: tagged-skill
description: A skill that already has tags in frontmatter.
tags: [react, typescript]
---

# Tagged Skill

Already has tags defined in frontmatter.
`

const SEED_SKILLS = [
  {
    slug: 'existing-skill',
    title: 'existing-skill',
    description: 'An existing skill for testing.',
    content_md: '# Existing Skill\n\nSome content.',
    tags: ['testing', 'e2e'],
    collections: ['QA'],
    current_version: 2,
    created_at: '2026-02-10T10:00:00Z',
    updated_at: '2026-02-20T14:30:00Z',
    comments: [],
  },
]

// ─── HELPERS ─────────────────────────────────────────────────────────

const TMP_DIR = '/tmp/skillnote-e2e'

function writeTestFile(name: string, content: string): string {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const filePath = path.join(TMP_DIR, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

/** Mock all /v1/** API calls so syncSkillsFromApi() doesn't interfere with localStorage-based tests */
async function mockApi(page: Page, skills: typeof SEED_SKILLS = []) {
  const apiList = skills.map(s => ({
    name: s.title, slug: s.slug, description: s.description,
    tags: s.tags, collections: s.collections, currentVersion: s.current_version,
  }))

  // Intercept all /v1/ API calls to prevent real backend interaction
  await page.route('**/v1/**', (route, request) => {
    const url = new URL(request.url())
    const path = url.pathname

    // GET /v1/skills (list)
    if (request.method() === 'GET' && path === '/v1/skills') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiList) })
    }

    // GET /v1/skills/:slug
    if (request.method() === 'GET' && /^\/v1\/skills\/[^/]+$/.test(path)) {
      const slug = path.split('/').pop()!
      const skill = skills.find(s => s.slug === slug)
      if (skill) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          id: slug, name: skill.title, slug: skill.slug, description: skill.description,
          content_md: skill.content_md, tags: skill.tags, collections: skill.collections,
          current_version: skill.current_version, created_at: skill.created_at, updated_at: skill.updated_at,
        })})
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"SKILL_NOT_FOUND","message":"Skill not found"}}' })
    }

    // GET /v1/skills/:slug/content-versions
    if (request.method() === 'GET' && /\/content-versions$/.test(path)) {
      const slug = path.split('/')[3]
      const skill = skills.find(s => s.slug === slug)
      if (skill && skill.current_version > 0) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
          version: skill.current_version, title: skill.title, description: skill.description,
          content_md: skill.content_md, tags: skill.tags, collections: skill.collections,
          is_latest: true, created_at: skill.created_at || new Date().toISOString(),
        }])})
      }
      // Return 404 for unknown skills so the localStorage fallback triggers
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"SKILL_NOT_FOUND","message":"Skill not found"}}' })
    }

    // GET /v1/skills/:slug/comments
    if (request.method() === 'GET' && /\/comments$/.test(path)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }

    // GET /v1/tags
    if (request.method() === 'GET' && path === '/v1/tags') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }

    // POST /v1/skills (create) — return the created skill
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

    // PATCH /v1/skills/:slug (update) — return success
    if (request.method() === 'PATCH' && /^\/v1\/skills\/[^/]+$/.test(path)) {
      const slug = path.split('/').pop()!
      const skill = skills.find(s => s.slug === slug)
      const now = new Date().toISOString()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: slug, name: skill?.title || slug, slug,
        description: skill?.description || '', content_md: skill?.content_md || '',
        tags: skill?.tags || [], collections: skill?.collections || [],
        current_version: (skill?.current_version || 0) + 1, total_versions: (skill?.current_version || 0) + 1, created_at: skill?.created_at || now, updated_at: now,
      })})
    }

    // DELETE — return success
    if (request.method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }

    // Default: return empty success for other endpoints
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function clearStorage(page: Page) {
  await mockApi(page)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
}

async function seedStorage(page: Page) {
  await mockApi(page, SEED_SKILLS)
  await page.goto('/')
  await page.evaluate((skills) => {
    localStorage.setItem('skillnote:skills', JSON.stringify(skills))
  }, SEED_SKILLS)
}

async function getStoredSkills(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('skillnote:skills')
    return raw ? JSON.parse(raw) : []
  })
}

async function openImportModal(page: Page) {
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.getByText('Import Skills')).toBeVisible()
}

async function uploadFile(page: Page, filePath: string) {
  await page.locator('input[type=file]').setInputFiles(filePath)
  await page.waitForTimeout(500)
}

// ─── TESTS ───────────────────────────────────────────────────────────

test.describe('Import Modal — Open / Close', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('import button is visible on home page', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Import' })).toBeVisible()
  })

  test('clicking Import opens the modal', async ({ page }) => {
    await openImportModal(page)
    await expect(page.getByText('Drop .md or .zip files here')).toBeVisible()
    await expect(page.getByText('click to browse')).toBeVisible()
  })

  test('clicking X closes the modal', async ({ page }) => {
    await openImportModal(page)
    // The close button has aria-label="Close" on the modal header
    await page.locator('.fixed.inset-0.z-50 button[aria-label="Close"]').click()
    await expect(page.getByText('Import Skills')).not.toBeVisible()
  })

  test('clicking Cancel closes the modal', async ({ page }) => {
    await openImportModal(page)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Import Skills')).not.toBeVisible()
  })

  test('clicking backdrop closes the modal', async ({ page }) => {
    await openImportModal(page)
    // Click the backdrop (the outer fixed overlay)
    await page.locator('.fixed.inset-0.z-50').click({ position: { x: 10, y: 10 } })
    await expect(page.getByText('Import Skills')).not.toBeVisible()
  })
})

// ─── FILE UPLOAD & PARSING ───────────────────────────────────────────

test.describe('Import Modal — File Upload & Parsing', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openImportModal(page)
  })

  test('uploading a SKILL.md shows parsed file with name from frontmatter', async ({ page }) => {
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)

    // Title should be the frontmatter name field
    await expect(page.getByText('skill-creator')).toBeVisible()
    // File count indicator
    await expect(page.getByText('1 file ready')).toBeVisible()
    // Review & Create button should be visible for single file
    await expect(page.getByRole('button', { name: 'Review & Create' })).toBeVisible()
  })

  test('file with title frontmatter uses title as name', async ({ page }) => {
    const filePath = writeTestFile('custom.md', SKILL_NO_NAME_MD)
    await uploadFile(page, filePath)

    await expect(page.getByText('My Custom Title')).toBeVisible()
  })

  test('file with no frontmatter uses H1 as name', async ({ page }) => {
    const filePath = writeTestFile('bare.md', SKILL_MINIMAL_MD)
    await uploadFile(page, filePath)

    await expect(page.getByText('Bare Skill')).toBeVisible()
  })

  test('file with frontmatter name shows in file list', async ({ page }) => {
    const filePath = writeTestFile('tagged.md', SKILL_WITH_TAGS_MD)
    await uploadFile(page, filePath)

    // Skill name should be visible in the file list
    await expect(page.getByText('tagged-skill')).toBeVisible()
  })

  test('remove button removes file from list', async ({ page }) => {
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)

    await expect(page.getByText('1 file ready')).toBeVisible()
    await page.getByLabel('Remove').click()
    await expect(page.getByText('1 file ready')).not.toBeVisible()
    // Review & Create button should no longer be visible
    await expect(page.getByRole('button', { name: 'Review & Create' })).not.toBeVisible()
  })

  test('uploading multiple files shows count', async ({ page }) => {
    const file1 = writeTestFile('skill1.md', SKILL_MD)
    const file2 = writeTestFile('skill2.md', SKILL_MINIMAL_MD)
    await page.locator('input[type=file]').setInputFiles([file1, file2])
    await page.waitForTimeout(500)

    await expect(page.getByText('2 files ready')).toBeVisible()
    // Multiple files show individual review buttons
    await expect(page.getByText('skill-creator').first()).toBeVisible()
    await expect(page.getByText('Bare Skill').first()).toBeVisible()
  })
})

// ─── COLLECTION EDITING ────────────────────────────────────────────

test.describe('Import Modal — Collection Editing', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
  })

  test('collection input is auto-expanded for single file', async ({ page }) => {
    await expect(page.locator('input[placeholder="Add to collection..."]')).toBeVisible()
  })

  test('can add a collection', async ({ page }) => {
    const colInput = page.locator('input[placeholder="Add to collection..."]')
    await colInput.click()
    await colInput.fill('AI Tools')
    await colInput.press('Enter')
    await page.waitForTimeout(300)

    // Collection chip should appear
    const colChip = page.locator('span').filter({ hasText: 'ai tools' }).filter({ has: page.locator('button') })
    await expect(colChip.first()).toBeVisible()
  })

  test('can remove a collection by clicking X', async ({ page }) => {
    const colInput = page.locator('input[placeholder="Add to collection..."]')
    await colInput.fill('removeme')
    await colInput.press('Enter')
    await page.waitForTimeout(300)

    // Find the collection chip
    const colSection = page.locator('label:has-text("Collection")').locator('..')
    const chip = colSection.locator('span').filter({ hasText: 'removeme' }).first()
    await expect(chip).toBeVisible()
    await chip.locator('button').click()
    await page.waitForTimeout(300)

    // Chip should be gone
    await expect(colSection.locator('span').filter({ hasText: 'removeme' })).not.toBeVisible()
  })

  test('collection input shows suggestions from existing skills', async ({ page }) => {
    // Seed a skill with collections, close modal, reload to pick up seeds, then re-open
    await page.locator('.fixed.inset-0.z-50 button[aria-label="Close"]').click()
    await page.evaluate((skills) => {
      localStorage.setItem('skillnote:skills', JSON.stringify(skills))
    }, SEED_SKILLS)
    await page.unroute('**/v1/**')
    await mockApi(page, SEED_SKILLS)
    await page.reload({ waitUntil: 'networkidle' })

    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)

    const colInput = page.locator('input[placeholder="Add to collection..."]')
    await colInput.click()
    await page.waitForTimeout(500)

    // Existing collections should appear as dropdown suggestions
    const dropdown = page.locator('.absolute.left-0.right-0')
    await expect(dropdown.getByText('QA')).toBeVisible()
  })

  test('collapsing and expanding file row toggles collection input', async ({ page }) => {
    // Collection input should be visible (auto-expanded)
    await expect(page.locator('input[placeholder="Add to collection..."]')).toBeVisible()

    // Click file row to collapse
    await page.locator('.cursor-pointer').filter({ hasText: 'skill-creator' }).click()
    await page.waitForTimeout(200)
    await expect(page.locator('input[placeholder="Add to collection..."]')).not.toBeVisible()

    // Click again to expand
    await page.locator('.cursor-pointer').filter({ hasText: 'skill-creator' }).click()
    await page.waitForTimeout(200)
    await expect(page.locator('input[placeholder="Add to collection..."]')).toBeVisible()
  })
})

// ─── REVIEW & CREATE FLOW ───────────────────────────────────────────

test.describe('Import Modal — Review & Create Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('Review & Create navigates to /skills/new with prefilled data', async ({ page }) => {
    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
    await page.getByRole('button', { name: 'Review & Create' }).click()

    // Should navigate to /skills/new with query params
    await page.waitForURL('**/skills/new**', { timeout: 5000 })
    expect(page.url()).toContain('/skills/new')
    expect(page.url()).toContain('name=skill-creator')
  })

  test('prefilled name appears in create form', async ({ page }) => {
    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
    await page.getByRole('button', { name: 'Review & Create' }).click()
    await page.waitForURL('**/skills/new**', { timeout: 5000 })
    await page.waitForLoadState('networkidle')

    const nameInput = page.locator('input[placeholder="skill-name"]')
    await expect(nameInput).toHaveValue('skill-creator')
  })

  test('prefilled description appears in create form', async ({ page }) => {
    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
    await page.getByRole('button', { name: 'Review & Create' }).click()
    await page.waitForURL('**/skills/new**', { timeout: 5000 })
    await page.waitForLoadState('networkidle')

    const descInput = page.locator('textarea[placeholder*="Describe"]')
    await expect(descInput).toContainText('Create new skills')
  })

  test('Review & Create with collection passes collection param', async ({ page }) => {
    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)

    // Add a collection before review
    const colInput = page.locator('input[placeholder="Add to collection..."]')
    await colInput.fill('Tools')
    await colInput.press('Enter')
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'Review & Create' }).click()
    await page.waitForURL('**/skills/new**', { timeout: 5000 })
    expect(page.url()).toContain('collections=tools')
  })

  test('modal closes after Review & Create', async ({ page }) => {
    await openImportModal(page)
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
    await page.getByRole('button', { name: 'Review & Create' }).click()
    await page.waitForURL('**/skills/new**', { timeout: 5000 })

    // Modal should be closed
    await expect(page.getByText('Import Skills')).not.toBeVisible()
  })
})

// ─── SKILL DETAIL FROM SEEDED DATA ──────────────────────────────────

test.describe('Skill Detail — From Seeded Data', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('seeded skill appears as clickable link on home page', async ({ page }) => {
    const link = page.locator('a[href="/skills/existing-skill"]')
    await expect(link).toBeVisible()
  })

  test('clicking skill navigates to detail page', async ({ page }) => {
    await page.locator('a[href="/skills/existing-skill"]').click()
    await page.waitForURL('**/skills/existing-skill')
    await page.waitForLoadState('networkidle')

    expect(page.url()).toContain('/skills/existing-skill')
    await expect(page.getByText('existing-skill').first()).toBeVisible()
  })

  test('detail page shows correct metadata', async ({ page }) => {
    await page.goto('/skills/existing-skill')
    await page.waitForLoadState('networkidle')

    // Name
    await expect(page.getByText('existing-skill').first()).toBeVisible()
    // Description
    await expect(page.getByText('An existing skill for testing')).toBeVisible()
    // Version badge
    await expect(page.getByText('v2').first()).toBeVisible()
  })

  test('detail page renders markdown content', async ({ page }) => {
    await page.goto('/skills/existing-skill')
    await page.waitForLoadState('networkidle')

    // H1 from markdown body
    await expect(page.getByRole('heading', { name: 'Existing Skill' })).toBeVisible()
    await expect(page.getByText('Some content')).toBeVisible()
  })

  test('detail page has Edit Skill, Versions, Export buttons', async ({ page }) => {
    await page.goto('/skills/existing-skill')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    await expect(page.getByRole('button', { name: 'Edit Skill' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  })

  test('versions page shows version info for seeded skill', async ({ page }) => {
    await page.goto('/skills/existing-skill/versions')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Current: v2')).toBeVisible()
    await expect(page.getByText('Latest')).toBeVisible()
  })
})

// ─── HOME PAGE — FILTER SIDEBAR ──────────────────────────────────────

test.describe('Home Page — Filter Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('filter sidebar shows seeded collections', async ({ page }) => {
    // The sidebar filter panel only shows collections (not tags)
    await expect(page.locator('aside').getByText('QA')).toBeVisible()
  })

  test('filter sidebar shows seeded collection', async ({ page }) => {
    // The seed data has collection "QA"
    await expect(page.locator('aside').getByText('QA')).toBeVisible()
  })

  test('tag count shows correct number', async ({ page }) => {
    // Each tag should show count of 1
    await expect(page.locator('aside').getByText('1').first()).toBeVisible()
  })
})

// ─── HOME PAGE — SEARCH ─────────────────────────────────────────────

test.describe('Home Page — Search', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('search input is visible', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible()
  })

  test('searching filters skills by title', async ({ page }) => {
    await page.locator('input[placeholder*="Search"]').fill('existing')
    await page.waitForTimeout(300)

    await expect(page.getByText('existing-skill')).toBeVisible()
  })

  test('searching with no results shows empty state', async ({ page }) => {
    await page.locator('input[placeholder*="Search"]').fill('nonexistent-xyz')
    await page.waitForTimeout(300)

    await expect(page.getByText('No skills found')).toBeVisible()
  })

  test('clearing search shows all skills again', async ({ page }) => {
    await page.locator('input[placeholder*="Search"]').fill('nonexistent-xyz')
    await page.waitForTimeout(300)
    await expect(page.getByText('No skills found')).toBeVisible()

    await page.locator('input[placeholder*="Search"]').clear()
    await page.waitForTimeout(300)
    await expect(page.getByText('existing-skill')).toBeVisible()
  })
})

// ─── HOME PAGE — VIEW TOGGLE ────────────────────────────────────────

test.describe('Home Page — View Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('default view is list', async ({ page }) => {
    // List view shows skill in a row layout
    await expect(page.locator('a[href="/skills/existing-skill"]')).toBeVisible()
  })

  test('can toggle to grid view', async ({ page }) => {
    // Click the grid view button
    await page.locator('button[aria-label="Grid view"]').click()
    await page.waitForTimeout(300)

    // Grid view shows cards in a grid layout
    await expect(page.locator('.grid')).toBeVisible()
  })
})

// ─── SKILL CREATION ─────────────────────────────────────────────────

test.describe('New Skill — Creation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('New Skill button navigates to creation page', async ({ page }) => {
    await page.locator('a, button').filter({ hasText: 'New Skill' }).first().click()
    await page.waitForURL('**/skills/new')
    expect(page.url()).toContain('/skills/new')
  })

  test('creation page has required form fields', async ({ page }) => {
    await page.goto('/skills/new')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('input[placeholder="skill-name"]')).toBeVisible()
    await expect(page.locator('textarea[placeholder*="Describe"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Skill' })).toBeVisible()
  })

  test('can create a skill with name and description', async ({ page }) => {
    await page.goto('/skills/new')
    await page.waitForLoadState('networkidle')

    await page.locator('input[placeholder="skill-name"]').fill('test-new-skill')
    await page.locator('textarea[placeholder*="Describe"]').fill('A newly created test skill for E2E testing')
    await page.getByRole('button', { name: 'Create Skill' }).click()
    await page.waitForTimeout(2000)

    // Should navigate to the new skill's detail page
    expect(page.url()).toContain('/skills/test-new-skill')
  })
})

// ─── SKILL DELETION ─────────────────────────────────────────────────

test.describe('Skill Detail — Delete Flow', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page)
    await page.goto('/skills/existing-skill')
    await page.waitForLoadState('networkidle')
  })

  test('more menu has delete option', async ({ page }) => {
    // Use JS click to avoid detach during React re-renders
    await page.waitForTimeout(2000)
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="More options"]') as HTMLButtonElement
      if (btn) btn.click()
      else throw new Error('More options button not found')
    })
    await page.waitForTimeout(300)

    await expect(page.getByText('Delete Skill')).toBeVisible()
  })
})

// ─── MARKDOWN PARSING EDGE CASES ─────────────────────────────────────

test.describe('Import — Markdown Parsing Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openImportModal(page)
  })

  test('frontmatter name is used as skill title', async ({ page }) => {
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)

    // Should use "name" field value directly
    await expect(page.getByText('skill-creator')).toBeVisible()
  })

  test('frontmatter title field is used when present', async ({ page }) => {
    const filePath = writeTestFile('custom.md', SKILL_NO_NAME_MD)
    await uploadFile(page, filePath)

    await expect(page.getByText('My Custom Title')).toBeVisible()
  })

  test('H1 heading is used when no frontmatter name/title', async ({ page }) => {
    const filePath = writeTestFile('bare.md', SKILL_MINIMAL_MD)
    await uploadFile(page, filePath)

    await expect(page.getByText('Bare Skill')).toBeVisible()
  })

  test('frontmatter description is passed to create page', async ({ page }) => {
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
    await page.getByRole('button', { name: 'Review & Create' }).click()
    await page.waitForURL('**/skills/new**', { timeout: 5000 })

    // Description should be in the URL params
    expect(page.url()).toContain('description=')
  })

  test('frontmatter content is passed to create page', async ({ page }) => {
    const filePath = writeTestFile('SKILL.md', SKILL_MD)
    await uploadFile(page, filePath)
    await page.getByRole('button', { name: 'Review & Create' }).click()
    await page.waitForURL('**/skills/new**', { timeout: 5000 })

    // Content should be in the URL params
    expect(page.url()).toContain('content=')
  })
})

// ─── NAVIGATION INTEGRATION ─────────────────────────────────────────

test.describe('Navigation — Sidebar Links', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('sidebar Skills link navigates to home', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    // Target visible desktop sidebar link (hidden nav has same text)
    await page.locator('a[href="/"]').filter({ hasText: 'Skills' }).and(page.locator(':visible')).first().click()
    await page.waitForURL(/\/$/)
    expect(page.url()).toMatch(/localhost:3000\/?$/)
  })

  test('sidebar Collections link navigates to collections page', async ({ page }) => {
    await page.locator('a[href="/collections"]').and(page.locator(':visible')).first().click()
    await page.waitForURL('**/collections')
    expect(page.url()).toContain('/collections')
  })

  // Tags link removed — sidebar no longer has a Tags page link

  test('sidebar Settings link navigates to settings page', async ({ page }) => {
    await page.locator('a[href="/settings"]').and(page.locator(':visible')).first().click()
    await page.waitForURL('**/settings')
    expect(page.url()).toContain('/settings')
  })
})
