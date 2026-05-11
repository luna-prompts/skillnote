/**
 * E2E: PWA manifest
 *
 * Verifies that:
 *  - The home page exposes a <link rel="manifest"> tag
 *  - The manifest URL responds with parseable JSON
 *  - The response carries an acceptable MIME type
 *  - The required PWA fields are populated correctly
 */

import { test, expect } from '@playwright/test'

const REQUIRED_FIELDS = [
  'name',
  'short_name',
  'description',
  'start_url',
  'display',
  'background_color',
  'theme_color',
  'icons',
] as const

test.describe('PWA manifest', () => {
  test('home page exposes a manifest link and the manifest is valid', async ({ page, request, baseURL }) => {
    await page.goto('/')

    // 1. The <link rel="manifest"> tag is present on the page.
    const manifestLink = page.locator('link[rel="manifest"]')
    await expect(manifestLink).toHaveCount(1)

    const href = await manifestLink.getAttribute('href')
    expect(href, 'manifest link should have an href').not.toBeNull()
    expect(href).toBeTruthy()

    // 2. Resolve absolute URL and fetch it.
    const manifestUrl = new URL(href as string, baseURL ?? page.url()).toString()
    const response = await request.get(manifestUrl)
    expect(response.ok(), `manifest fetch should succeed (got ${response.status()})`).toBe(true)

    // 3. MIME type must be one of the acceptable values.
    const contentType = (response.headers()['content-type'] ?? '').toLowerCase()
    const acceptable = ['application/manifest+json', 'application/json']
    expect(
      acceptable.some((m) => contentType.includes(m)),
      `expected MIME ${acceptable.join(' or ')}, got "${contentType}"`,
    ).toBe(true)

    // 4. Body parses as JSON and contains required fields.
    const body = await response.json()
    for (const field of REQUIRED_FIELDS) {
      expect(body, `manifest should include "${field}"`).toHaveProperty(field)
    }

    expect(body.name).toBe('SkillNote')
    expect(body.short_name).toBe('SkillNote')
    expect(body.start_url).toBe('/')
    expect(body.display).toBe('standalone')
    expect(Array.isArray(body.icons)).toBe(true)
    expect(body.icons.length).toBeGreaterThan(0)
  })
})
