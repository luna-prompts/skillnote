/**
 * Round 8 — Settings + Collections + Skill rename audit + architectural fix.
 *
 * L1 (sidebar Collections count = collections-with-skills only) — debatable
 *     UX; not fixed. Skipped.
 * L2 (body H1 desync on rename) — fixed in `saveSkillEdit`; tested below via
 *     a route mock + intercept of the outgoing PATCH body.
 * D (commitSkills centralization) — refactor only; correctness validated by
 *     the existing R5/R6/R7 e2e regressions (sidebar count, analytics
 *     registeredSlugs) all still passing. No new test needed here — the
 *     existing tests cover every code path that mutates localStorage.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

test.describe('R8 — saveSkillEdit auto-rewrites body H1 on rename', () => {
  test('renaming a skill rewrites the auto-generated H1 in the body', async ({ page }) => {
    const now = new Date().toISOString()
    const oldSlug = 'r8-auto-h1-from'
    const newSlug = 'r8-auto-h1-to'

    let patchBodyContent: string | null = null

    await page.route('**/v1/skills', (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            slug: oldSlug,
            name: oldSlug,
            description: 'fixture',
            collections: ['conventions'],
            currentVersion: 1,
            import_source_id: null,
            forked_from_source: false,
            source_path: null,
            origin: null,
          },
        ]),
      }),
    )
    await page.route(`**/v1/skills/${oldSlug}`, (r: Route) => {
      if (r.request().method() === 'PATCH') {
        const body = JSON.parse(r.request().postData() ?? '{}')
        patchBodyContent = body.content_md ?? null
        // Mock the rename response — backend renames slug.
        return r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            slug: newSlug,
            name: newSlug,
            description: body.description,
            content_md: body.content_md,
            collections: body.collections ?? ['conventions'],
            current_version: 2,
            created_at: now,
            updated_at: now,
            extra_frontmatter: null,
            import_source_id: null,
            forked_from_source: false,
            source_path: null,
            origin: null,
          }),
        })
      }
      // GET: full skill detail with the auto-generated H1.
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slug: oldSlug,
          name: oldSlug,
          description: 'fixture',
          content_md: `# ${oldSlug}\n\nBody text.`,
          collections: ['conventions'],
          current_version: 1,
          created_at: now,
          updated_at: now,
          extra_frontmatter: null,
          import_source_id: null,
          forked_from_source: false,
          source_path: null,
          origin: null,
        }),
      })
    })
    await page.route(`**/v1/skills/${oldSlug}/comments`, (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route(`**/v1/skills/${oldSlug}/rating`, (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    await page.route(`**/v1/skills/${oldSlug}/reviews**`, (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    // Also the renamed slug — used after redirect.
    await page.route(`**/v1/skills/${newSlug}`, (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slug: newSlug,
          name: newSlug,
          description: 'fixture',
          content_md: `# ${newSlug}\n\nBody text.`,
          collections: ['conventions'],
          current_version: 2,
          created_at: now,
          updated_at: now,
          extra_frontmatter: null,
          import_source_id: null,
          forked_from_source: false,
          source_path: null,
          origin: null,
        }),
      }),
    )
    await page.route(`**/v1/skills/${newSlug}/comments`, (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route(`**/v1/skills/${newSlug}/rating`, (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    await page.route(`**/v1/skills/${newSlug}/reviews**`, (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto(`/skills/${oldSlug}`)
    await page.getByRole('button', { name: /Edit Skill/i }).click()

    // Wait for the edit panel to render with the name field.
    const nameInput = page.getByRole('textbox', { name: 'skill-name' })
    await expect(nameInput).toHaveValue(oldSlug)
    await nameInput.fill(newSlug)
    await page.getByRole('button', { name: /Save as v2/i }).click()

    // Wait for the PATCH to fly. waitForRequest is the right primitive —
    // the prior `waitForFunction(() => true, …)` was a disguised sleep
    // (reviewer-flagged Major).
    const patchPromise = page.waitForRequest(
      (req) => req.url().includes(`/v1/skills/${oldSlug}`) && req.method() === 'PATCH',
      { timeout: 10_000 },
    )
    // Confirm modal — click the inner Save v2.
    await page.getByRole('button', { name: /^Save v2$/i }).click()
    await patchPromise

    // The auto-rewrite should have replaced "# r8-auto-h1-from" with
    // "# r8-auto-h1-to" before sending PATCH to the backend, AND preserved
    // the body text after the heading (so we're not just wiping the file).
    expect(patchBodyContent).toContain(`# ${newSlug}`)
    expect(patchBodyContent).toContain('Body text.')
    expect(patchBodyContent).not.toContain(`# ${oldSlug}`)
  })
})
