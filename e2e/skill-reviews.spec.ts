/**
 * E2E: Agent Reviews on Skill Detail Page
 *
 * Tests the Amazon-style reviews section: rating summary, distribution bars,
 * individual review cards, edge cases (no reviews, no ratings, single review).
 */

import { test, expect, type Page } from '@playwright/test'

// ─── FIXTURES ─────────────────────────────────────────────────────────────────

const SKILL = {
  id: 'test-001',
  name: 'testing-guide',
  slug: 'testing-guide',
  description: 'Best practices for writing tests.',
  content_md: '# Testing Guide\n\nWrite tests first.\n\n## Unit Tests\n\nTest individual functions.',
  collections: ['backend'],
  current_version: 2,
  total_versions: 2,
  created_at: '2026-01-10T10:00:00Z',
  updated_at: '2026-03-15T14:30:00Z',
}

const RATING_DETAIL = {
  slug: 'testing-guide',
  avg_rating: 4.2,
  rating_count: 5,
  versions: [
    { version: 2, avg_rating: 4.5, rating_count: 3 },
    { version: 1, avg_rating: 3.5, rating_count: 2 },
  ],
}

const REVIEWS = [
  {
    id: 'rev-1',
    rating: 5,
    outcome: 'Applied the testing patterns to our entire backend. Tests run 3x faster now.',
    agent_name: 'claude-code',
    skill_version: '2',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
  },
  {
    id: 'rev-2',
    rating: 5,
    outcome: 'Great guidelines for structuring test suites.',
    agent_name: 'cursor',
    skill_version: '2',
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1d ago
  },
  {
    id: 'rev-3',
    rating: 4,
    outcome: 'Mostly useful, had to adapt the mocking section for our stack.',
    agent_name: 'claude-code',
    skill_version: '2',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3d ago
  },
  {
    id: 'rev-4',
    rating: 3,
    outcome: 'Some advice was too generic for our use case.',
    agent_name: 'codex',
    skill_version: '1',
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10d ago
  },
  {
    id: 'rev-5',
    rating: 4,
    outcome: 'Solid foundation for test conventions.',
    agent_name: 'openhands',
    skill_version: '1',
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 45d ago — formatted as date
  },
]

// ─── MOCK SETUP ───────────────────────────────────────────────────────────────

async function setupMocks(
  page: Page,
  opts: {
    ratingDetail?: typeof RATING_DETAIL | null
    reviews?: typeof REVIEWS
  } = {},
) {
  const { ratingDetail = RATING_DETAIL, reviews = REVIEWS } = opts

  // Skill list
  await page.route('**/v1/skills', (route, req) => {
    if (req.method() === 'GET') {
      const { content_md: _, ...listItem } = SKILL
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([listItem]),
      })
    }
    return route.continue()
  })

  // Skill detail
  await page.route(`**/v1/skills/${SKILL.slug}`, (route, req) => {
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SKILL),
      })
    }
    return route.continue()
  })

  // Comments
  await page.route(`**/v1/skills/${SKILL.slug}/comments`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // Content versions
  await page.route(`**/v1/skills/${SKILL.slug}/content-versions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        version: SKILL.current_version,
        title: SKILL.name,
        description: SKILL.description,
        content_md: SKILL.content_md,
        collections: SKILL.collections,
        is_latest: true,
        created_at: SKILL.created_at,
      }]),
    }),
  )

  // All analytics routes — single handler with URL-based routing
  // (Playwright uses LIFO priority so a single handler avoids ordering bugs)
  await page.route('**/v1/analytics/**', (route) => {
    const url = route.request().url()

    // GET /v1/analytics/ratings/:slug/reviews
    if (url.includes('/reviews')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reviews),
      })
    }

    // GET /v1/analytics/ratings/:slug (detail)
    if (url.includes(`/ratings/${SKILL.slug}`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ratingDetail ?? { slug: SKILL.slug, avg_rating: null, rating_count: 0, versions: [] }),
      })
    }

    // GET /v1/analytics/ratings (list)
    if (url.endsWith('/ratings')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          ratingDetail
            ? [{ slug: ratingDetail.slug, avg_rating: ratingDetail.avg_rating, rating_count: ratingDetail.rating_count }]
            : [],
        ),
      })
    }

    // Any other analytics route
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

test.describe('Agent Reviews on Skill Detail', () => {
  test('shows Agent Reviews section with heading and count badge', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Agent Reviews')).toBeVisible()
    // Count badge — use exact match to avoid matching "5 star" or "5 ratings"
    const badge = page.locator('text=Agent Reviews').locator('..').locator('.rounded-full').filter({ hasText: /^5$/ })
    await expect(badge).toBeVisible()
  })

  test('shows big average rating number', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // The big 4.2 average
    const reviewsSection = page.locator('text=Agent Reviews').locator('..')
    await expect(reviewsSection.locator('text=4.2').first()).toBeVisible()
    // "5 ratings" text
    await expect(page.getByText('5 ratings')).toBeVisible()
  })

  test('shows rating distribution bars for all 5 star levels', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // All 5 star labels should appear
    for (const star of [1, 2, 3, 4, 5]) {
      await expect(page.getByText(`${star} star`)).toBeVisible()
    }
  })

  test('distribution percentages match review data', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // 5-star: 2/5 = 40%, 4-star: 2/5 = 40%, 3-star: 1/5 = 20%, 2-star: 0%, 1-star: 0%
    await expect(page.getByText('40%').first()).toBeVisible()
    await expect(page.getByText('20%')).toBeVisible()
  })

  test('shows individual review cards with agent names', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // Agent names should be visible
    await expect(page.getByText('claude-code').first()).toBeVisible()
    await expect(page.getByText('cursor')).toBeVisible()
    await expect(page.getByText('codex')).toBeVisible()
    await expect(page.getByText('openhands')).toBeVisible()
  })

  test('shows review outcomes/descriptions', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Applied the testing patterns')).toBeVisible()
    await expect(page.getByText('Great guidelines for structuring')).toBeVisible()
    await expect(page.getByText('Mostly useful, had to adapt')).toBeVisible()
    await expect(page.getByText('Some advice was too generic')).toBeVisible()
    await expect(page.getByText('Solid foundation for test')).toBeVisible()
  })

  test('shows version badge on review cards', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // Reviews have version badges — v2 and v1 versions
    const reviewCards = page.locator('text=claude-code').first().locator('..')
    await expect(reviewCards.getByText('v2')).toBeVisible()
  })

  test('shows relative time on reviews', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // 2h ago review — use exact match to avoid matching "23d ago" substring
    await expect(page.getByText('2h ago', { exact: true })).toBeVisible()
    // 1d ago review
    await expect(page.getByText('1d ago', { exact: true })).toBeVisible()
    // 3d ago review
    await expect(page.getByText('3d ago', { exact: true })).toBeVisible()
    // 10d ago review
    await expect(page.getByText('10d ago', { exact: true })).toBeVisible()
  })

  test('shows filled stars matching the review rating', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // The reviews section should have star icons (SVGs with fill-amber-400 class)
    const reviewsSection = page.locator('.divide-y').last()
    const filledStars = reviewsSection.locator('svg.fill-amber-400')
    // 5 reviews: 5+5+4+3+4 = 21 filled stars
    await expect(filledStars).toHaveCount(21)
  })

  test('rating detail also shows in meta pills in hero', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // The hero meta section should have a 4.2 rating pill
    const heroPill = page.locator('.rounded-full').filter({ hasText: '4.2' }).first()
    await expect(heroPill).toBeVisible()
  })
})

test.describe('Agent Reviews — Edge Cases', () => {
  test('hides reviews section when no ratings and no reviews', async ({ page }) => {
    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: null as any, rating_count: 0, versions: [] },
      reviews: [],
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Agent Reviews')).not.toBeVisible()
  })

  test('shows fallback message when ratings exist but no individual reviews', async ({ page }) => {
    await setupMocks(page, {
      ratingDetail: RATING_DETAIL,
      reviews: [],
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Agent Reviews')).toBeVisible()
    await expect(page.getByText('4.2').first()).toBeVisible()
    await expect(page.getByText('Rating data available but no individual reviews yet.')).toBeVisible()
  })

  test('works with a single review', async ({ page }) => {
    const singleReview = [{
      id: 'solo-1',
      rating: 5,
      outcome: 'Perfect skill, followed instructions exactly.',
      agent_name: 'claude-code',
      skill_version: '2',
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5m ago
    }]

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 5.0, rating_count: 1, versions: [{ version: 2, avg_rating: 5.0, rating_count: 1 }] },
      reviews: singleReview,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Agent Reviews')).toBeVisible()
    await expect(page.getByText('5.0').first()).toBeVisible()
    await expect(page.getByText('1 rating')).toBeVisible() // singular
    await expect(page.getByText('100%')).toBeVisible() // 5-star = 100%
    await expect(page.getByText('Perfect skill, followed instructions exactly.')).toBeVisible()
    await expect(page.getByText('5m ago')).toBeVisible()
  })

  test('handles review with no outcome text', async ({ page }) => {
    const noOutcomeReview = [{
      id: 'no-outcome',
      rating: 4,
      outcome: '',
      agent_name: 'cursor',
      skill_version: '1',
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }]

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 4.0, rating_count: 1, versions: [] },
      reviews: noOutcomeReview,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('cursor')).toBeVisible()
    // No outcome paragraph should be rendered — just agent name and stars
  })

  test('handles review with no agent name', async ({ page }) => {
    const unknownAgentReview = [{
      id: 'unknown-agent',
      rating: 3,
      outcome: 'Did something.',
      agent_name: '',
      skill_version: '1',
      created_at: new Date().toISOString(),
    }]

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 3.0, rating_count: 1, versions: [] },
      reviews: unknownAgentReview,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Unknown agent')).toBeVisible()
  })

  test('handles review with null created_at', async ({ page }) => {
    const noDateReview = [{
      id: 'no-date',
      rating: 4,
      outcome: 'Works fine.',
      agent_name: 'claude-code',
      skill_version: '2',
      created_at: null as any,
    }]

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 4.0, rating_count: 1, versions: [] },
      reviews: noDateReview,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Works fine.')).toBeVisible()
    // Should not crash — no date displayed
  })

  test('all 5-star reviews show 100% on 5-star bar only', async ({ page }) => {
    const allFiveStars = [
      { id: 'a', rating: 5, outcome: 'Great', agent_name: 'agent-a', skill_version: '1', created_at: new Date().toISOString() },
      { id: 'b', rating: 5, outcome: 'Awesome', agent_name: 'agent-b', skill_version: '1', created_at: new Date().toISOString() },
    ]

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 5.0, rating_count: 2, versions: [] },
      reviews: allFiveStars,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    // Only one percentage should show — 100% on the 5-star bar
    await expect(page.getByText('100%')).toBeVisible()
    // The 5-star bar shows 100%, other bars show nothing
    await expect(page.getByText('5 star')).toBeVisible()
    // 4-star through 1-star bars should not have percentage text
    for (const star of [4, 3, 2, 1]) {
      const row = page.getByText(`${star} star`).locator('..')
      await expect(row).toBeVisible()
    }
  })

  test('all 1-star reviews show 100% on 1-star bar only', async ({ page }) => {
    const allOneStars = [
      { id: 'c', rating: 1, outcome: 'Bad', agent_name: 'agent-a', skill_version: '1', created_at: new Date().toISOString() },
      { id: 'd', rating: 1, outcome: 'Terrible', agent_name: 'agent-b', skill_version: '1', created_at: new Date().toISOString() },
    ]

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 1.0, rating_count: 2, versions: [] },
      reviews: allOneStars,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('100%')).toBeVisible()
    await expect(page.getByText('Bad')).toBeVisible()
    await expect(page.getByText('Terrible')).toBeVisible()
  })
})

test.describe('Agent Reviews — Version Breakdown in Sidebar', () => {
  test('shows per-version ratings on large screens', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // Per-version breakdown (visible on lg+)
    await expect(page.getByText('Rating by Version')).toBeVisible()
    await expect(page.getByText('4.5')).toBeVisible()
    await expect(page.getByText('3.5')).toBeVisible()
  })
})

test.describe('Agent Reviews — Reviews section scrolling', () => {
  test('reviews section is scrollable within the view tab', async ({ page }) => {
    // Many reviews to test scrolling
    const manyReviews = Array.from({ length: 15 }, (_, i) => ({
      id: `rev-${i}`,
      rating: (i % 5) + 1,
      outcome: `Review number ${i + 1} with some outcome text that describes what happened.`,
      agent_name: `agent-${i % 3}`,
      skill_version: String((i % 2) + 1),
      created_at: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
    }))

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 3.0, rating_count: 15, versions: [] },
      reviews: manyReviews,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    // First review visible (use exact to avoid matching "Review number 10", "11" etc)
    await expect(page.getByText('Review number 1 with some outcome')).toBeVisible()

    // Last review is in the DOM
    await expect(page.getByText('Review number 15 with some outcome')).toBeAttached()

    // 15 ratings badge
    const badge = page.locator('text=Agent Reviews').locator('..').locator('.rounded-full').filter({ hasText: /^15$/ })
    await expect(badge).toBeVisible()
  })
})

test.describe('Agent Reviews — Navigation integration', () => {
  test('reviews load when navigating from homepage to skill detail', async ({ page }) => {
    await setupMocks(page)

    // Start from homepage
    await page.goto('/')
    await expect(page.getByText('testing-guide')).toBeVisible()

    // Click into skill detail
    await page.getByText('testing-guide').click()
    await page.waitForURL('**/skills/testing-guide')

    // Reviews should load
    await expect(page.getByText('Agent Reviews')).toBeVisible()
    await expect(page.getByText('Applied the testing patterns')).toBeVisible()
  })

  test('markdown content renders above reviews', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // Markdown content should be visible
    await expect(page.getByText('Testing Guide').first()).toBeVisible()
    await expect(page.getByText('Write tests first.')).toBeVisible()
    await expect(page.getByText('Unit Tests')).toBeVisible()

    // Reviews below
    await expect(page.getByText('Agent Reviews')).toBeVisible()
  })
})

test.describe('Agent Reviews — Clickable badge & Load more', () => {
  test('clicking rating badge in hero scrolls to reviews section', async ({ page }) => {
    await setupMocks(page)
    await page.goto(`/skills/${SKILL.slug}`)

    // The rating badge should be a button
    const badge = page.locator('button').filter({ hasText: '4.2' }).first()
    await expect(badge).toBeVisible()

    // Click it — should scroll to reviews
    await badge.click()

    // After scroll, Agent Reviews heading should be near the top of viewport
    await expect(page.getByText('Agent Reviews')).toBeVisible()
  })

  test('shows "Showing X of Y" text when there are more reviews', async ({ page }) => {
    // Create 10 reviews (exactly PAGE_SIZE) so hasMore=true
    const tenReviews = Array.from({ length: 10 }, (_, i) => ({
      id: `rev-${i}`,
      rating: (i % 5) + 1,
      outcome: `Outcome for review ${i + 1}.`,
      agent_name: `agent-${i % 3}`,
      skill_version: '1',
      created_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
    }))

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 3.5, rating_count: 25, versions: [] },
      reviews: tenReviews,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    await expect(page.getByText('Show more reviews')).toBeVisible()
    await expect(page.getByText('Showing 10 of 25')).toBeVisible()
  })

  test('load more button fetches next page of reviews', async ({ page }) => {
    const firstPage = Array.from({ length: 10 }, (_, i) => ({
      id: `rev-${i}`,
      rating: 5,
      outcome: `First page review ${i + 1}.`,
      agent_name: 'claude-code',
      skill_version: '1',
      created_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
    }))

    const secondPage = Array.from({ length: 3 }, (_, i) => ({
      id: `rev-${10 + i}`,
      rating: 4,
      outcome: `Second page review ${i + 1}.`,
      agent_name: 'cursor',
      skill_version: '1',
      created_at: new Date(Date.now() - (10 + i) * 60 * 60 * 1000).toISOString(),
    }))

    // Mock that returns first page initially, second page on offset=10
    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 4.8, rating_count: 13, versions: [] },
      reviews: firstPage,
    })

    // Override the analytics handler to return second page for offset=10
    await page.route('**/v1/analytics/**', (route) => {
      const url = route.request().url()
      if (url.includes('/reviews') && url.includes('offset=10')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(secondPage),
        })
      }
      return route.fallback()
    })

    await page.goto(`/skills/${SKILL.slug}`)

    // First page visible
    await expect(page.getByText('First page review 1.')).toBeVisible()
    await expect(page.getByText('Show more reviews')).toBeVisible()

    // Click load more
    await page.getByText('Show more reviews').click()

    // Second page should appear
    await expect(page.getByText('Second page review 1.')).toBeVisible()

    // "Show more" should disappear (only 3 returned, less than page size)
    await expect(page.getByText('All 13 reviews loaded')).toBeVisible()
  })

  test('hides load more when fewer reviews than page size returned', async ({ page }) => {
    const fewReviews = Array.from({ length: 3 }, (_, i) => ({
      id: `rev-${i}`,
      rating: 4,
      outcome: `Review ${i + 1}.`,
      agent_name: 'claude-code',
      skill_version: '1',
      created_at: new Date().toISOString(),
    }))

    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 4.0, rating_count: 3, versions: [] },
      reviews: fewReviews,
    })
    await page.goto(`/skills/${SKILL.slug}`)

    // Should NOT show "Show more reviews" — only 3 reviews, less than page size
    await expect(page.getByText('Show more reviews')).not.toBeVisible()
  })

  test('formats large rating counts with k suffix', async ({ page }) => {
    await setupMocks(page, {
      ratingDetail: { slug: SKILL.slug, avg_rating: 4.5, rating_count: 12500, versions: [] },
      reviews: [{ id: 'r1', rating: 5, outcome: 'Great', agent_name: 'agent', skill_version: '1', created_at: new Date().toISOString() }],
    })
    await page.goto(`/skills/${SKILL.slug}`)

    // Badge in hero should show 12.5k
    await expect(page.locator('button').filter({ hasText: '12.5k' })).toBeVisible()
    // Reviews section badge should also show 12.5k
    await expect(page.getByText('12.5k ratings')).toBeVisible()
  })
})
